import type { Backend, CreationOptions, File, FileSystemMetadata, InodeLike, Stats } from '@zenfs/core';
import { _throw, Async, constants, Errno, ErrnoError, FileSystem, Index, InMemory, Inode, LazyFile } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/vfs/constants.js';
import { basename, dirname, join } from '@zenfs/core/vfs/path.js';
import { convertException } from './utils.js';

export interface WebAccessOptions {
	handle: FileSystemDirectoryHandle;
	metadata?: string;
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
	 * Loads all of the handles.
	 * @internal @hidden
	 */
	async _loadHandles(path: string, handle: FileSystemDirectoryHandle) {
		for await (const [key, child] of handle.entries()) {
			const p = join(path, key);
			this._handles.set(p, child);
			if (isKind(child, 'directory')) await this._loadHandles(p, child);
		}
	}

	/**
	 * Loads metadata
	 * @internal @hidden
	 */
	async _loadMetadata(metadataPath?: string): Promise<void> {
		if (metadataPath) {
			const handle = this.get('file', metadataPath);
			const file = await handle.getFile();
			const raw = await file.text();
			const data = JSON.parse(raw);
			this.index.fromJSON(data);
			return;
		}

		for (const [path, handle] of this._handles) {
			if (isKind(handle, 'file')) {
				const { lastModified, size } = await handle.getFile();
				this.index.set(path, new Inode({ mode: 0o777 | constants.S_IFREG, size, mtimeMs: lastModified }));
				continue;
			}

			if (!isKind(handle, 'directory')) throw new ErrnoError(Errno.EIO, 'Invalid handle', path);

			this.index.set(path, new Inode({ mode: 0o777 | constants.S_IFDIR, size: 0 }));
		}
	}

	/**
	 * @hidden
	 */
	_sync: FileSystem = InMemory.create({ name: 'accessfs-cache' });

	public constructor(
		handle: FileSystemDirectoryHandle,
		/**
		 * Disables index optimizations,
		 * like using the index for `readdir`
		 */
		private readonly disableIndexOptimizations: boolean = false
	) {
		super();
		this._handles.set('/', handle);
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'WebAccess',
			noResizableBuffers: true,
			features: ['setid'],
		};
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		if (oldPath == newPath) return;
		if (newPath.startsWith(oldPath + '/')) throw ErrnoError.With('EBUSY', oldPath, 'rename');

		const handle = this.get(null, oldPath, 'rename');
		if (isKind(handle, 'directory')) {
			const files = await this.readdir(oldPath);
			const stats = await this.stat(oldPath);

			await this.mkdir(newPath, stats.mode, stats);

			for (const file of files) await this.rename(join(oldPath, file), join(newPath, file));

			await this.rmdir(oldPath);

			return;
		}

		if (!isKind(handle, 'file')) {
			throw new ErrnoError(Errno.ENOTSUP, 'Not a file or directory handle', oldPath, 'rename');
		}

		const oldFile = await handle.getFile().catch(ex => _throw(convertException(ex, oldPath, 'rename')));

		const destFolder = this.get('directory', dirname(newPath), 'rename');

		const newFile = await destFolder
			.getFileHandle(basename(newPath), { create: true })
			.catch((ex: DOMException) =>
				_throw(ex.name == 'TypeMismatchError' ? ErrnoError.With('EISDIR', newPath, 'rename') : convertException(ex, newPath, 'rename'))
			);

		const writable = await newFile.createWritable();
		await writable.write(await oldFile.arrayBuffer());
		await writable.close();
		await this.unlink(oldPath);
		this._handles.set(newPath, newFile);
	}

	public async unlink(path: string): Promise<void> {
		if (path == '/') throw ErrnoError.With('EBUSY', '/', 'unlink');
		const handle = this.get('directory', dirname(path), 'unlink');
		await handle.removeEntry(basename(path), { recursive: true }).catch(ex => _throw(convertException(ex, path, 'unlink')));
		this.index.delete(path);
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		if (end <= offset) return;
		const handle = this.get('file', path, 'write');

		const file = await handle.getFile();
		const data = await file.arrayBuffer();

		if (data.byteLength < end - offset) throw ErrnoError.With('ENODATA', path, 'read');

		buffer.set(new Uint8Array(data, offset, end - offset));
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		const inode = this.index.get(path);
		if (!inode) throw ErrnoError.With('ENOENT', path, 'write');

		if (isResizable(buffer.buffer)) {
			throw new ErrnoError(Errno.EINVAL, 'Resizable buffers can not be written', path, 'write');
		}

		const handle = this.get('file', path, 'write');
		const writable = await handle.createWritable();

		try {
			await writable.seek(offset);
		} catch {
			await writable.write({ type: 'seek', position: offset });
		}
		await writable.write(buffer);
		await writable.close();

		const { size, lastModified } = await handle.getFile();
		inode.update({ size, mtimeMs: lastModified });
		this.index.set(path, inode);
	}

	/**
	 * Do not use!
	 * @deprecated @internal @hidden
	 */
	public async writeFile(path: string, data: Uint8Array): Promise<void> {
		return this.write(path, data, 0);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async stat(path: string): Promise<Stats> {
		const inode = this.index.get(path);
		if (!inode) throw ErrnoError.With('ENOENT', path, 'stat');
		return inode.toStats();
	}

	public async createFile(path: string, flag: string, mode: number, options: CreationOptions): Promise<File> {
		const handle = this.get('directory', dirname(path), 'createFile');

		if (this.index.has(path)) throw ErrnoError.With('EEXIST', path, 'createFile');

		const file = await handle.getFileHandle(basename(path), { create: true });

		// Race condition bypass
		const inode = this.index.get(path) ?? new Inode({ ...options, mode: mode | S_IFREG });
		this.index.set(path, inode);
		this._handles.set(path, file);

		return new LazyFile(this, path, flag, inode);
	}

	public async openFile(path: string, flag: string): Promise<File> {
		const inode = this.index.get(path);
		if (!inode) throw ErrnoError.With('ENOENT', path, 'stat');

		return new LazyFile(this, path, flag, inode.toStats());
	}

	/**
	 * @todo Implement
	 */
	public async link(srcpath: string): Promise<void> {
		return;
	}

	public async sync(path: string, data?: Uint8Array, stats?: Readonly<Partial<InodeLike>>): Promise<void> {
		const inode = this.index.get(path) ?? new Inode();
		inode.update(stats);

		this.index.set(path, inode);

		if (!data) return;
		const handle = this.get('file', path, 'write');
		const writable = await handle.createWritable();

		try {
			await writable.seek(0);
		} catch {
			await writable.write({ type: 'seek', position: 0 });
		}
		await writable.write(data);
		await writable.close();
	}

	public async rmdir(path: string): Promise<void> {
		if ((await this.readdir(path)).length) throw ErrnoError.With('ENOTEMPTY', path, 'rmdir');
		if (path == '/') throw ErrnoError.With('EBUSY', '/', 'rmdir');
		const handle = this.get('directory', dirname(path), 'rmdir');
		await handle.removeEntry(basename(path), { recursive: true }).catch(ex => _throw(convertException(ex, path, 'rmdir')));
		this.index.delete(path);
	}

	public async mkdir(path: string, mode: number, options: CreationOptions): Promise<void> {
		if (this.index.has(path)) throw ErrnoError.With('EEXIST', path, 'mkdir');

		const handle = this.get('directory', dirname(path), 'mkdir');

		const dir = await handle.getDirectoryHandle(basename(path), { create: true });
		this._handles.set(path, dir);

		this.index.set(path, new Inode({ ...options, mode: mode | S_IFDIR }));
	}

	public async readdir(path: string): Promise<string[]> {
		if (!this.disableIndexOptimizations) {
			if (!this.index.has(path)) throw ErrnoError.With('ENOENT', path, 'readdir');
			const entries = this.index.directoryEntries(path);
			if (!entries) throw ErrnoError.With('ENOTDIR', path, 'readdir');
			return Object.keys(entries);
		}

		const handle = this.get('directory', path, 'readdir');

		const entries = [];
		for await (const k of handle.keys()) {
			entries.push(k);
		}
		return entries;
	}

	protected get<const T extends FileSystemHandleKind | null>(
		kind: T = null as T,
		path: string,
		syscall?: string
	): T extends FileSystemHandleKind ? HKindToType<T> : FileSystemHandle {
		const handle = this._handles.get(path);
		if (!handle) throw ErrnoError.With('ENODATA', path, syscall);

		if (kind && !isKind(handle, kind)) throw ErrnoError.With(kind == 'directory' ? 'ENOTDIR' : 'EISDIR', path, syscall);

		return handle as T extends FileSystemHandleKind ? HKindToType<T> : FileSystemHandle;
	}
}

const _WebAccess = {
	name: 'WebAccess',

	options: {
		handle: { type: 'object', required: true },
		metadata: { type: 'string', required: false },
	},

	async create(options: WebAccessOptions) {
		const fs = new WebAccessFS(options.handle);
		await fs._loadHandles('/', options.handle);
		await fs._loadMetadata(options.metadata);
		return fs;
	},
} as const satisfies Backend<WebAccessFS, WebAccessOptions>;
type _WebAccess = typeof _WebAccess;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WebAccess extends _WebAccess {}
export const WebAccess: WebAccess = _WebAccess;
