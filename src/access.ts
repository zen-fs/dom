import type { Backend, CreationOptions, FileSystem, InodeLike } from '@zenfs/core';
import { Async, constants, IndexFS, InMemory, Inode } from '@zenfs/core';
import { basename, dirname, join } from '@zenfs/core/path.js';
import { S_IFDIR, S_IFMT } from '@zenfs/core/vfs/constants.js';
import { log, withErrno } from 'kerium';
import { alert } from 'kerium/log';
import { _throw } from 'utilium';
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

export class WebAccessFS extends Async(IndexFS) {
	/**
	 * Used to speed up handle lookups.
	 * Without this, every lookup would be O(n) on the path length.
	 * With the cache, these become O(1) operations.
	 */
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
			const handle = await this.get('file', metadataPath);
			const file = await handle.getFile();
			const raw = await file.text();
			const data = JSON.parse(raw);
			this.index.fromJSON(data);
			return;
		}

		for (const [path, handle] of this._handles) {
			if (isKind(handle, 'file')) {
				const { lastModified, size } = await handle.getFile();
				this.index.set(path, new Inode({ mode: 0o644 | constants.S_IFREG, size, mtimeMs: lastModified }));
				continue;
			}

			if (!isKind(handle, 'directory')) throw withErrno('EIO', 'Invalid handle');

			this.index.set(path, new Inode({ mode: 0o777 | constants.S_IFDIR, size: 0 }));
		}
	}

	/**
	 * @hidden
	 */
	_sync: FileSystem = InMemory.create({ label: 'accessfs-cache' });

	public constructor(handle: FileSystemDirectoryHandle) {
		super(0x77656261, 'webaccessfs');
		this.attributes.set('no_buffer_resize', true);
		this._handles.set('/', handle);
	}

	protected async remove(path: string): Promise<void> {
		const handle = await this.get('directory', dirname(path));
		await handle.removeEntry(basename(path), { recursive: true }).catch(ex => _throw(convertException(ex, path)));
	}

	protected removeSync(): void {
		throw log.crit(withErrno('ENOSYS'));
	}

	public async read(path: string, buffer: Uint8Array, offset: number, end: number): Promise<void> {
		if (end <= offset) return;
		const handle = await this.get('file', path);

		const file = await handle.getFile();
		const data = await file.arrayBuffer();

		if (data.byteLength < end - offset)
			throw alert(
				withErrno(
					'EIO',
					`Unexpected mismatch in file data size. This should not happen.\n\t\tTried to read ${end - offset} bytes but the file is ${data.byteLength} bytes.`
				)
			);

		buffer.set(new Uint8Array(data, offset, end - offset));
	}

	public async write(path: string, buffer: Uint8Array, offset: number): Promise<void> {
		if (isResizable(buffer.buffer)) {
			const newBuffer = new Uint8Array(new ArrayBuffer(buffer.byteLength), buffer.byteOffset, buffer.byteLength);
			newBuffer.set(buffer);
			buffer = newBuffer;
		}

		const inode = this.index.get(path);
		if (!inode) throw withErrno('ENOENT');

		const isDir = (inode.mode & S_IFMT) == S_IFDIR;

		let handle: FileSystemFileHandle | FileSystemDirectoryHandle;
		try {
			handle = await this.get(isDir ? 'directory' : 'file', path);
		} catch {
			const parent = await this.get('directory', dirname(path));
			handle = await parent[isDir ? 'getDirectoryHandle' : 'getFileHandle'](basename(path), { create: true }).catch((ex: DOMException) =>
				_throw(convertException(ex, path))
			);
			this._handles.set(path, handle);
		}

		if (isDir) return;

		if (isKind(handle, 'directory')) {
			log.crit(withErrno('EIO', 'Mismatch in entry kind on write'));
			return;
		}

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

	public async mkdir(path: string, options: CreationOptions): Promise<InodeLike> {
		const inode = await super.mkdir(path, options);
		const handle = await this.get('directory', dirname(path));
		const dir = await handle.getDirectoryHandle(basename(path), { create: true }).catch((ex: DOMException) => _throw(convertException(ex, path)));
		this._handles.set(path, dir);
		return inode;
	}

	/**
	 * @todo Consider supporting synchronous stuff with `FileSystemFileHandle.createSyncAccessHandle()`
	 */
	protected async get<const T extends FileSystemHandleKind | null>(
		kind: T = null as T,
		path: string
	): Promise<T extends FileSystemHandleKind ? HKindToType<T> : FileSystemHandle> {
		const handle = this._handles.get(path);
		if (!handle) throw withErrno('ENODATA');

		if (kind && !isKind(handle, kind)) throw withErrno(kind == 'directory' ? 'ENOTDIR' : 'EISDIR');

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
