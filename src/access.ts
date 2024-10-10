import type { Backend, FileSystemMetadata } from '@zenfs/core';
import { Async, Errno, ErrnoError, FileSystem, InMemory, PreloadFile, Stats } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/emulation/constants.js';
import { basename, dirname, join } from '@zenfs/core/emulation/path.js';
import { convertException, type ConvertException } from './utils.js';

declare global {
	interface FileSystemDirectoryHandle {
		[Symbol.iterator](): IterableIterator<[string, FileSystemHandle]>;
		entries(): IterableIterator<[string, FileSystemHandle]>;
		keys(): IterableIterator<string>;
		values(): IterableIterator<FileSystemHandle>;
	}
}

export interface WebAccessOptions {
	handle: FileSystemDirectoryHandle;
}

export class WebAccessFS extends Async(FileSystem) {
	private _handles: Map<string, FileSystemHandle> = new Map();

	/**
	 * @hidden
	 */
	_sync: FileSystem = InMemory.create({ name: 'accessfs-cache' });

	public constructor(handle: FileSystemDirectoryHandle) {
		super();
		this._handles.set('/', handle);
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'WebAccess',
			noResizableBuffers: true,
		};
	}

	public async sync(path: string, data: Uint8Array, stats: Stats): Promise<void> {
		const currentStats = await this.stat(path);
		if (stats.mtime !== currentStats.mtime) {
			await this.writeFile(path, data);
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
			await writable.write(await oldFile.arrayBuffer());

			await writable.close();
			await this.unlink(oldPath);
		} catch (ex) {
			throw convertException(ex as ConvertException, oldPath, 'rename');
		}
	}

	public async writeFile(path: string, data: Uint8Array): Promise<void> {
		if (data.buffer.resizable) {
			throw new ErrnoError(Errno.EINVAL, 'Resizable buffers can not be written', path, 'write');
		}

		const handle = await this.getHandle(dirname(path));
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			return;
		}

		const file = await handle.getFileHandle(basename(path), { create: true });
		const writable = await file.createWritable();
		await writable.write(data);
		await writable.close();
	}

	public async createFile(path: string, flag: string): Promise<PreloadFile<this>> {
		await this.writeFile(path, new Uint8Array());
		return this.openFile(path, flag);
	}

	public async stat(path: string): Promise<Stats> {
		const handle = await this.getHandle(path);
		if (!handle) {
			throw ErrnoError.With('ENOENT', path, 'stat');
		}
		if (handle instanceof FileSystemDirectoryHandle) {
			return new Stats({ mode: 0o777 | S_IFDIR, size: 4096 });
		}
		if (handle instanceof FileSystemFileHandle) {
			const { lastModified, size } = await handle.getFile();
			return new Stats({ mode: 0o777 | S_IFREG, size, mtimeMs: lastModified });
		}
		throw new ErrnoError(Errno.EBADE, 'Handle is not a directory or file', path, 'stat');
	}

	public async openFile(path: string, flag: string): Promise<PreloadFile<this>> {
		const handle = await this.getHandle(path);
		if (!(handle instanceof FileSystemFileHandle)) {
			throw ErrnoError.With('EISDIR', path, 'openFile');
		}
		try {
			const file = await handle.getFile();
			const data = new Uint8Array(await file.arrayBuffer());
			const stats = new Stats({ mode: 0o777 | S_IFREG, size: file.size, mtimeMs: file.lastModified });
			return new PreloadFile(this, path, flag, stats, data);
		} catch (ex) {
			throw convertException(ex as ConvertException, path, 'openFile');
		}
	}

	public async unlink(path: string): Promise<void> {
		const handle = await this.getHandle(dirname(path));
		if (handle instanceof FileSystemDirectoryHandle) {
			try {
				await handle.removeEntry(basename(path), { recursive: true });
			} catch (ex) {
				throw convertException(ex as ConvertException, path, 'unlink');
			}
		}
	}

	public async link(srcpath: string): Promise<void> {
		throw ErrnoError.With('ENOSYS', srcpath, 'WebAccessFS.link');
	}

	public async rmdir(path: string): Promise<void> {
		return this.unlink(path);
	}

	public async mkdir(path: string): Promise<void> {
		const existingHandle = await this.getHandle(path);
		if (existingHandle) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}

		const handle = await this.getHandle(dirname(path));
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ErrnoError.With('ENOTDIR', path, 'mkdir');
		}
		await handle.getDirectoryHandle(basename(path), { create: true });
	}

	public async readdir(path: string): Promise<string[]> {
		const handle = await this.getHandle(path);
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}

		return Array.from(handle.keys());
	}

	protected async getHandle(path: string): Promise<FileSystemHandle> {
		if (this._handles.has(path)) {
			return this._handles.get(path)!;
		}

		let walked = '/';

		for (const part of path.split('/').slice(1)) {
			const handle = this._handles.get(walked);
			if (!(handle instanceof FileSystemDirectoryHandle)) {
				throw ErrnoError.With('ENOTDIR', walked, 'getHandle');
			}
			walked = join(walked, part);

			try {
				const dirHandle = await handle.getDirectoryHandle(part);
				this._handles.set(walked, dirHandle);
			} catch (_ex) {
				const ex = _ex as DOMException;
				if (ex.name == 'TypeMismatchError') {
					try {
						const fileHandle = await handle.getFileHandle(part);
						this._handles.set(walked, fileHandle);
					} catch (ex) {
						convertException(ex as ConvertException, walked, 'getHandle');
					}
				}

				if (ex.name === 'TypeError') {
					throw new ErrnoError(Errno.ENOENT, ex.message, walked, 'getHandle');
				}

				convertException(ex, walked, 'getHandle');
			}
		}

		return this._handles.get(path)!;
	}
}

const _WebAccess = {
	name: 'WebAccess',

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

	create(options: WebAccessOptions) {
		return new WebAccessFS(options.handle);
	},
} as const satisfies Backend<WebAccessFS, WebAccessOptions>;
type _WebAccess = typeof _WebAccess;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface WebAccess extends _WebAccess {}
export const WebAccess: WebAccess = _WebAccess;
