import type { Backend, FileSystemMetadata } from '@zenfs/core';
import { ApiError, Async, ErrorCode, FileSystem, FileType, PreloadFile, Stats } from '@zenfs/core';
import { basename, dirname, join } from '@zenfs/core/emulation/path.js';

declare global {
	interface FileSystemDirectoryHandle {
		[Symbol.iterator](): IterableIterator<[string, FileSystemHandle]>;
		entries(): IterableIterator<[string, FileSystemHandle]>;
		keys(): IterableIterator<string>;
		values(): IterableIterator<FileSystemHandle>;
	}
}

export interface FileSystemAccessOptions {
	handle: FileSystemDirectoryHandle;
}

const handleError = (path = '', syscall: string, error: Error) => {
	if (error.name === 'NotFoundError') {
		throw ApiError.With('ENOENT', path, syscall);
	}

	throw error as ApiError;
};

export class FileSystemAccessFile extends PreloadFile<FileSystemAccessFS> {
	constructor(_fs: FileSystemAccessFS, _path: string, _flag: string, _stat: Stats, contents?: Uint8Array) {
		super(_fs, _path, _flag, _stat, contents);
	}

	public syncSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public async sync(): Promise<void> {
		if (this.isDirty()) {
			await this.fs.sync(this.path, this.buffer, this.stats);
			this.resetDirty();
		}
	}

	public async close(): Promise<void> {
		await this.sync();
	}

	public closeSync(): void {
		throw new ApiError(ErrorCode.ENOTSUP);
	}
}

export class FileSystemAccessFS extends Async(FileSystem) {
	private _handles: Map<string, FileSystemHandle> = new Map();

	public async ready(): Promise<this> {
		return this;
	}

	public constructor({ handle }: FileSystemAccessOptions) {
		super();
		this._handles.set('/', handle);
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'FileSystemAccess',
		};
	}

	public async sync(p: string, data: Uint8Array, stats: Stats): Promise<void> {
		const currentStats = await this.stat(p);
		if (stats.mtime !== currentStats!.mtime) {
			await this.writeFile(p, data);
		}
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		try {
			const handle = await this.getHandle(oldPath);
			if (handle instanceof FileSystemDirectoryHandle) {
				const files = await this.readdir(oldPath);

				await this.mkdir(newPath);
				if (files.length == 0) {
					await this.unlink(oldPath);
				} else {
					for (const file of files) {
						await this.rename(join(oldPath, file), join(newPath, file));
						await this.unlink(oldPath);
					}
				}
			}
			if (!(handle instanceof FileSystemFileHandle)) {
				return;
			}
			const oldFile = await handle.getFile(),
				destFolder = await this.getHandle(dirname(newPath));
			if (!(destFolder instanceof FileSystemDirectoryHandle)) {
				return;
			}
			const newFile = await destFolder.getFileHandle(basename(newPath), { create: true });
			const writable = await newFile.createWritable();
			const buffer = await oldFile.arrayBuffer();
			await writable.write(buffer);

			writable.close();
			await this.unlink(oldPath);
		} catch (err) {
			handleError(oldPath, 'rename', err);
		}
	}

	public async writeFile(fname: string, data: Uint8Array): Promise<void> {
		const handle = await this.getHandle(dirname(fname));
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			return;
		}

		const file = await handle.getFileHandle(basename(fname), { create: true });
		const writable = await file.createWritable();
		await writable.write(data);
		await writable.close();
	}

	public async createFile(path: string, flag: string): Promise<FileSystemAccessFile> {
		await this.writeFile(path, new Uint8Array());
		return this.openFile(path, flag);
	}

	public async stat(path: string): Promise<Stats> {
		const handle = await this.getHandle(path);
		if (!handle) {
			throw ApiError.With('ENOENT', path, 'stat');
		}
		if (handle instanceof FileSystemDirectoryHandle) {
			return new Stats({ mode: 0o777 | FileType.DIRECTORY, size: 4096 });
		}
		if (handle instanceof FileSystemFileHandle) {
			const { lastModified, size } = await handle.getFile();
			return new Stats({ mode: 0o777 | FileType.FILE, size, mtimeMs: lastModified });
		}
	}

	public async openFile(path: string, flag: string): Promise<FileSystemAccessFile> {
		const handle = await this.getHandle(path);
		if (handle instanceof FileSystemFileHandle) {
			const file = await handle.getFile();
			const data = new Uint8Array(await file.arrayBuffer());
			const stats = new Stats({ mode: 0o777 | FileType.FILE, size: file.size, mtimeMs: file.lastModified });
			return new FileSystemAccessFile(this, path, flag, stats, data);
		}
	}

	public async unlink(path: string): Promise<void> {
		const handle = await this.getHandle(dirname(path));
		if (handle instanceof FileSystemDirectoryHandle) {
			try {
				await handle.removeEntry(basename(path), { recursive: true });
			} catch (e) {
				handleError(path, 'unlink', e);
			}
		}
	}

	public async link(): Promise<void> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public async rmdir(path: string): Promise<void> {
		return this.unlink(path);
	}

	public async mkdir(path: string): Promise<void> {
		const existingHandle = await this.getHandle(path);
		if (existingHandle) {
			throw ApiError.With('EEXIST', path, 'mkdir');
		}

		const handle = await this.getHandle(dirname(path));
		if (handle instanceof FileSystemDirectoryHandle) {
			await handle.getDirectoryHandle(basename(path), { create: true });
		}
	}

	public async readdir(path: string): Promise<string[]> {
		const handle = await this.getHandle(path);
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ApiError.With('ENOTDIR', path, 'readdir');
		}
		const _keys: string[] = [];
		for await (const key of handle.keys()) {
			_keys.push(join(path, key));
		}
		return _keys;
	}

	protected async getHandle(path: string): Promise<FileSystemHandle> {
		if (this._handles.has(path)) {
			return this._handles.get(path);
		}

		let walkedPath = '/';
		const [, ...pathParts] = path.split('/');
		const getHandleParts = async ([pathPart, ...remainingPathParts]: string[]) => {
			const walkingPath = join(walkedPath, pathPart);
			const continueWalk = (handle: FileSystemHandle) => {
				walkedPath = walkingPath;
				this._handles.set(walkedPath, handle);

				if (remainingPathParts.length === 0) {
					return this._handles.get(path);
				}

				getHandleParts(remainingPathParts);
			};
			const handle = this._handles.get(walkedPath) as FileSystemDirectoryHandle;

			try {
				return continueWalk(await handle.getDirectoryHandle(pathPart));
			} catch (error) {
				if (error.name === 'TypeMismatchError') {
					try {
						return continueWalk(await handle.getFileHandle(pathPart));
					} catch (err) {
						handleError(walkingPath, 'getHandle', err);
					}
				} else if (error.message === 'Name is not allowed.') {
					throw new ApiError(ErrorCode.ENOENT, error.message, walkingPath);
				} else {
					handleError(walkingPath, 'getHandle', error);
				}
			}
		};

		return await getHandleParts(pathParts);
	}
}

export const FileSystemAccess: Backend = {
	name: 'FileSystemAccess',

	options: {
		handle: {
			type: 'object',
			required: true,
			description: 'The directory handle to use for the root',
		},
	},

	isAvailable(): boolean {
		return typeof FileSystemHandle == 'function';
	},

	create(options: FileSystemAccessOptions) {
		return new FileSystemAccessFS(options);
	},
};
