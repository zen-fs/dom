import { basename, dirname, join } from '@browserfs/core/emulation/path.js';
import { ApiError, ErrorCode } from '@browserfs/core/ApiError.js';
import { FileFlag, PreloadFile } from '@browserfs/core/file.js';
import { AsyncFileSystem, FileSystemMetadata } from '@browserfs/core/filesystem.js';
import { Stats, FileType } from '@browserfs/core/stats.js';
import type { Backend } from '@browserfs/core/backends/backend.js';
import type { Cred } from '@browserfs/core/cred.js';

declare global {
	interface FileSystemDirectoryHandle {
		[Symbol.iterator](): IterableIterator<[string, FileSystemHandle]>;
		entries(): IterableIterator<[string, FileSystemHandle]>;
		keys(): IterableIterator<string>;
		values(): IterableIterator<FileSystemHandle>;
	}
}

interface FileSystemAccessOptions {
	handle: FileSystemDirectoryHandle;
}

const handleError = (path = '', error: Error) => {
	if (error.name === 'NotFoundError') {
		throw ApiError.ENOENT(path);
	}

	throw error as ApiError;
};

export class FileSystemAccessFile extends PreloadFile<FileSystemAccessFileSystem> {
	constructor(_fs: FileSystemAccessFileSystem, _path: string, _flag: FileFlag, _stat: Stats, contents?: Uint8Array) {
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

export class FileSystemAccessFileSystem extends AsyncFileSystem {
	private _handles: Map<string, FileSystemHandle> = new Map();

	public async ready(): Promise<this> {
		return this;
	}

	public constructor({ handle }: FileSystemAccessOptions) {
		super();
		this._handles.set('/', handle);
	}

	public get metadata(): FileSystemMetadata {
		return {
			...super.metadata,
			name: FileSystemAccessFileSystem.Name,
		};
	}

	public async sync(p: string, data: Uint8Array, stats: Stats): Promise<void> {
		const currentStats = await this.stat(p);
		if (stats.mtime !== currentStats!.mtime) {
			await this.writeFile(p, data, FileFlag.FromString('w'), currentStats!.mode);
		}
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		try {
			const handle = await this.getHandle(oldPath);
			if (handle instanceof FileSystemDirectoryHandle) {
				const files = await this.readdir(oldPath);

				await this.mkdir(newPath, 0o77);
				if (files.length === 0) {
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
			handleError(oldPath, err);
		}
	}

	public async writeFile(fname: string, data: Uint8Array, flag: FileFlag, mode: number): Promise<void> {
		const handle = await this.getHandle(dirname(fname));
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			return;
		}

		const file = await handle.getFileHandle(basename(fname), { create: true });
		const writable = await file.createWritable();
		await writable.write(data);
		await writable.close();
	}

	public async createFile(p: string, flag: FileFlag, mode: number): Promise<FileSystemAccessFile> {
		await this.writeFile(p, new Uint8Array(), flag, mode);
		return this.openFile(p, flag);
	}

	public async stat(path: string): Promise<Stats> {
		const handle = await this.getHandle(path);
		if (!handle) {
			throw ApiError.OnPath(ErrorCode.ENOENT, path);
		}
		if (handle instanceof FileSystemDirectoryHandle) {
			return new Stats(FileType.DIRECTORY, 4096);
		}
		if (handle instanceof FileSystemFileHandle) {
			const { lastModified, size } = await handle.getFile();
			return new Stats(FileType.FILE, size, undefined, undefined, lastModified);
		}
	}

	public async openFile(path: string, flags: FileFlag): Promise<FileSystemAccessFile> {
		const handle = await this.getHandle(path);
		if (handle instanceof FileSystemFileHandle) {
			const file = await handle.getFile();
			const buffer = await file.arrayBuffer();
			return this.newFile(path, flags, buffer, file.size, file.lastModified);
		}
	}

	public async unlink(path: string): Promise<void> {
		const handle = await this.getHandle(dirname(path));
		if (handle instanceof FileSystemDirectoryHandle) {
			try {
				await handle.removeEntry(basename(path), { recursive: true });
			} catch (e) {
				handleError(path, e);
			}
		}
	}

	public async link(srcpath: string, dstpath: string, cred: Cred): Promise<void> {
		throw new ApiError(ErrorCode.ENOTSUP);
	}

	public async rmdir(path: string): Promise<void> {
		return this.unlink(path);
	}

	public async mkdir(p: string, mode: number): Promise<void> {
		const existingHandle = await this.getHandle(p);
		if (existingHandle) {
			throw ApiError.EEXIST(p);
		}

		const handle = await this.getHandle(dirname(p));
		if (handle instanceof FileSystemDirectoryHandle) {
			await handle.getDirectoryHandle(basename(p), { create: true });
		}
	}

	public async readdir(path: string): Promise<string[]> {
		const handle = await this.getHandle(path);
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ApiError.ENOTDIR(path);
		}
		const _keys: string[] = [];
		for await (const key of handle.keys()) {
			_keys.push(join(path, key));
		}
		return _keys;
	}

	private newFile(path: string, flag: FileFlag, data: ArrayBuffer, size?: number, lastModified?: number): FileSystemAccessFile {
		return new FileSystemAccessFile(this, path, flag, new Stats(FileType.FILE, size || 0, undefined, undefined, lastModified || new Date().getTime()), new Uint8Array(data));
	}

	private async getHandle(path: string): Promise<FileSystemHandle> {
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
				return await continueWalk(await handle.getDirectoryHandle(pathPart));
			} catch (error) {
				if (error.name === 'TypeMismatchError') {
					try {
						return await continueWalk(await handle.getFileHandle(pathPart));
					} catch (err) {
						handleError(walkingPath, err);
					}
				} else if (error.message === 'Name is not allowed.') {
					throw new ApiError(ErrorCode.ENOENT, error.message, walkingPath);
				} else {
					handleError(walkingPath, error);
				}
			}
		};

		await getHandleParts(pathParts);
	}
}

export const FileSystemAccess: Backend = {
	name: 'FileSystemAccess',

	options: {},

	isAvailable(): boolean {
		return typeof FileSystemHandle === 'function';
	},

	create(options: FileSystemAccessOptions) {
		return new FileSystemAccessFileSystem(options);
	},
};
