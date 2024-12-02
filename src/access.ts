import type { Backend, FileSystemMetadata } from '@zenfs/core';
import { Async, Errno, ErrnoError, FileSystem, InMemory, PreloadFile, Stats } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/emulation/constants.js';
import { basename, dirname, join } from '@zenfs/core/emulation/path.js';
import { convertException, type ConvertException } from './utils.js';

export interface WebAccessOptions {
	handle: FileSystemDirectoryHandle;
}

function isResizable(buffer: ArrayBufferLike): boolean {
	if (buffer instanceof ArrayBuffer) return buffer.resizable;

	if (buffer instanceof SharedArrayBuffer) return buffer.growable;

	return false;
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

	public async sync(path: string, data: Uint8Array): Promise<void> {
		await this.writeFile(path, data);
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		const handle = await this.getHandle(oldPath);
		if (handle instanceof FileSystemDirectoryHandle) {
			const files = await this.readdir(oldPath);

			await this.mkdir(newPath);
			if (!files.length) {
				await this.unlink(oldPath);
				return;
			}

			for (const file of files) {
				await this.rename(join(oldPath, file), join(newPath, file));
				await this.unlink(oldPath);
			}

			return;
		}
		if (!(handle instanceof FileSystemFileHandle)) {
			throw new ErrnoError(Errno.ENOTSUP, 'Not a file or directory handle', oldPath, 'rename');
		}
		const oldFile = await handle.getFile().catch((ex: ConvertException) => {
				throw convertException(ex, oldPath, 'rename');
			}),
			destFolder = await this.getHandle(dirname(newPath));
		if (!(destFolder instanceof FileSystemDirectoryHandle)) {
			return;
		}
		const newFile = await destFolder.getFileHandle(basename(newPath), { create: true }).catch((ex: ConvertException) => {
			throw convertException(ex, newPath, 'rename');
		});
		const writable = await newFile.createWritable();
		await writable.write(await oldFile.arrayBuffer());

		await writable.close();
		await this.unlink(oldPath);
	}

	public async writeFile(path: string, data: Uint8Array): Promise<void> {
		if (isResizable(data.buffer)) {
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
		const file = await handle.getFile().catch((ex: ConvertException) => {
			throw convertException(ex, path, 'openFile');
		});
		const data = new Uint8Array(await file.arrayBuffer());
		const stats = new Stats({ mode: 0o777 | S_IFREG, size: file.size, mtimeMs: file.lastModified });
		return new PreloadFile(this, path, flag, stats, data);
	}

	public async unlink(path: string): Promise<void> {
		const handle = await this.getHandle(dirname(path));
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ErrnoError.With('ENOTDIR', dirname(path), 'unlink');
		}
		await handle.removeEntry(basename(path), { recursive: true }).catch((ex: ConvertException) => {
			throw convertException(ex, path, 'unlink');
		});
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async link(srcpath: string): Promise<void> {
		return;
	}

	public async rmdir(path: string): Promise<void> {
		return this.unlink(path);
	}

	public async mkdir(path: string): Promise<void> {
		const existingHandle = await this.getHandle(path).catch((ex: ErrnoError) => {
			if (ex.code != 'ENOENT') {
				throw ex;
			}
		});
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

		const entries = [];
		for await (const k of handle.keys()) {
			entries.push(k);
		}
		return entries;
	}

	protected async getHandle(path: string): Promise<FileSystemHandle | undefined> {
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

			const child = await handle.getDirectoryHandle(part).catch((ex: DOMException) => {
				switch (ex.name) {
					case 'TypeMismatchError':
						return handle.getFileHandle(part).catch((ex: ConvertException) => {
							//throw convertException(ex, walked, 'getHandle');
						});
					case 'TypeError':
						throw new ErrnoError(Errno.ENOENT, ex.message, walked, 'getHandle');
					default:
						throw convertException(ex, walked, 'getHandle');
				}
			});
			if (child) this._handles.set(walked, child);
		}

		return this._handles.get(path)!;
	}
}

const _WebAccess = {
	name: 'WebAccess',

	options: {
		handle: { type: 'object', required: true },
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
export interface WebAccess extends _WebAccess {}
export const WebAccess: WebAccess = _WebAccess;
