import type { Backend, CreationOptions, FileSystemMetadata, InodeLike } from '@zenfs/core';
import { Async, constants, Errno, ErrnoError, FileSystem, Index, InMemory, PreloadFile, Stats } from '@zenfs/core';
import { basename, dirname, join } from '@zenfs/core/vfs/path.js';
import { convertException, type ConvertException } from './utils.js';

export interface WebAccessOptions {
	handle: FileSystemDirectoryHandle;
}

function isResizable(buffer: ArrayBufferLike): boolean {
	if (buffer instanceof ArrayBuffer) return buffer.resizable;

	if (buffer instanceof SharedArrayBuffer) return buffer.growable;

	return false;
}

type HKindToType<T extends FileSystemHandleKind> = T extends 'directory'
	? FileSystemDirectoryHandle
	: T extends 'file'
		? FileSystemFileHandle
		: FileSystemHandle;

/**
 * Since `FileSystemHandle.kind` doesn't have correct type support
 */
function isKind<const T extends FileSystemHandleKind>(handle: FileSystemHandle, kind: T): handle is HKindToType<T> {
	return handle.kind == kind;
}

export class WebAccessFS extends Async(FileSystem) {
	protected index = new Index();

	protected _handles = new Map<string, FileSystemHandle>();

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
			// Not really, but we don't support opening directories so this prevent the VFS from trying
			features: ['setid'],
		};
	}

	public async sync(path: string, data?: Uint8Array, stats?: Partial<Readonly<InodeLike>>): Promise<void> {
		this.index.get(path)!.update(stats);
		if (data) await this.write(path, data, 0);
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		const handle = await this.getHandle(oldPath, 'rename');
		if (isKind(handle, 'directory')) {
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
		if (!isKind(handle, 'file')) {
			throw new ErrnoError(Errno.ENOTSUP, 'Not a file or directory handle', oldPath, 'rename');
		}
		const oldFile = await handle.getFile().catch((ex: ConvertException) => {
			throw convertException(ex, oldPath, 'rename');
		});
		const destFolder = await this.getHandle(dirname(newPath), 'rename');

		if (!isKind(destFolder, 'directory')) throw ErrnoError.With('ENOTDIR', dirname(newPath), 'rename');

		const newFile = await destFolder.getFileHandle(basename(newPath), { create: true }).catch((ex: ConvertException) => {
			throw convertException(ex, newPath, 'rename');
		});
		const writable = await newFile.createWritable();
		await writable.write(await oldFile.arrayBuffer());

		await writable.close();
		await this.unlink(oldPath);
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		const handle = await this.getHandle(path, 'write');

		if (!isKind(handle, 'file')) throw ErrnoError.With('EISDIR', path, 'write');

		const file = await handle.getFile();
		const data = await file.arrayBuffer();

		buffer.set(new Uint8Array(data, offset, end - offset));
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		if (isResizable(buffer.buffer)) {
			throw new ErrnoError(Errno.EINVAL, 'Resizable buffers can not be written', path, 'write');
		}

		const handle = await this.getHandle(path, 'write');

		if (!isKind(handle, 'file')) throw ErrnoError.With('EISDIR', path, 'write');

		const writable = await handle.createWritable();

		try {
			await writable.seek(offset);
		} catch {
			await writable.write({ type: 'seek', position: offset });
		}
		await writable.write(buffer);
		await writable.close();
	}

	/**
	 * Do not use!
	 * @deprecated @internal @hidden
	 */
	public async writeFile(path: string, data: Uint8Array): Promise<void> {
		return this.write(path, data, 0);
	}

	public async createFile(path: string, flag: string): Promise<PreloadFile<this>> {
		const handle = await this.getHandle(dirname(path), 'createFile');

		if (!isKind(handle, 'directory')) throw ErrnoError.With('ENOTDIR', dirname(path), 'createFile');

		const base = basename(path);

		for await (const key of handle.keys()) {
			if (key == base) throw ErrnoError.With('EEXIST', path, 'createFile');
		}

		await handle.getFileHandle(base, { create: true });
		return this.openFile(path, flag);
	}

	public async stat(path: string): Promise<Stats> {
		const handle = await this.getHandle(path, 'stat');

		if (isKind(handle, 'directory')) {
			return new Stats({ mode: 0o777 | constants.S_IFDIR, size: 4096 });
		}
		if (isKind(handle, 'file')) {
			const { lastModified, size } = await handle.getFile();
			return new Stats({ mode: 0o777 | constants.S_IFREG, size, mtimeMs: lastModified });
		}
		throw new ErrnoError(Errno.EBADE, 'Handle is not a directory or file', path, 'stat');
	}

	public async openFile(path: string, flag: string): Promise<PreloadFile<this>> {
		const handle = await this.getHandle(path, 'openFile');

		if (!isKind(handle, 'file')) throw ErrnoError.With('EISDIR', path, 'openFile');

		const file = await handle.getFile().catch((ex: ConvertException) => {
			throw convertException(ex, path, 'openFile');
		});
		const data = new Uint8Array(await file.arrayBuffer());
		const stats = new Stats({ mode: 0o777 | constants.S_IFREG, size: file.size, mtimeMs: file.lastModified });
		return new PreloadFile(this, path, flag, stats, data);
	}

	public async unlink(path: string): Promise<void> {
		const handle = await this.getHandle(dirname(path), 'unlink');
		if (!isKind(handle, 'directory')) {
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

	public async mkdir(path: string, mode?: number, options?: CreationOptions): Promise<void> {
		if (await this.exists(path)) {
			throw ErrnoError.With('EEXIST', path, 'mkdir');
		}

		const handle = await this.getHandle(dirname(path), 'mkdir');
		if (!isKind(handle, 'directory')) {
			throw ErrnoError.With('ENOTDIR', path, 'mkdir');
		}
		await handle.getDirectoryHandle(basename(path), { create: true });
	}

	public async readdir(path: string): Promise<string[]> {
		const handle = await this.getHandle(path, 'readdir');
		if (!isKind(handle, 'directory')) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}

		const entries = [];
		for await (const k of handle.keys()) {
			entries.push(k);
		}
		return entries;
	}

	protected async getHandle(path: string, syscall: string): Promise<FileSystemHandle> {
		if (this._handles.has(path)) {
			return this._handles.get(path)!;
		}

		let walked = '/';

		for (const part of path.split('/').slice(1)) {
			const handle = this._handles.get(walked);
			if (!handle) throw ErrnoError.With('ENOENT', walked, syscall);
			if (!isKind(handle, 'directory')) throw ErrnoError.With('ENOTDIR', walked, syscall);
			walked = join(walked, part);

			try {
				const child = await handle.getDirectoryHandle(part);
				this._handles.set(walked, child);
			} catch (_ex: unknown) {
				const ex = _ex as DOMException;

				switch (ex.name) {
					case 'TypeMismatchError':
						try {
							return await handle.getFileHandle(part);
						} catch (ex: any) {
							throw convertException(ex, walked, syscall);
						}
					case 'TypeError':
						throw new ErrnoError(Errno.ENOENT, ex.message, walked, syscall);
					default:
						throw convertException(ex, walked, syscall);
				}
			}
		}

		return this._handles.get(path)!;
	}
}

const _WebAccess = {
	name: 'WebAccess',

	options: {
		handle: { type: 'object', required: true },
	},

	create(options: WebAccessOptions) {
		return new WebAccessFS(options.handle);
	},
} as const satisfies Backend<WebAccessFS, WebAccessOptions>;
type _WebAccess = typeof _WebAccess;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WebAccess extends _WebAccess {}
export const WebAccess: WebAccess = _WebAccess;
