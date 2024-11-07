import type { Backend, FileSystemMetadata, StatsLike } from '@zenfs/core';
import { Async, Errno, ErrnoError, FileSystem, InMemory, Inode, PreloadFile, Stats } from '@zenfs/core';
import { S_IFDIR, S_IFREG } from '@zenfs/core/emulation/constants.js';
import { basename, dirname, join } from '@zenfs/core/path';
import { serialize } from 'utilium';
import { convertException, type ConvertException } from './utils.js';

export interface WebAccessOptions {
	handle: FileSystemDirectoryHandle;
}

const metadataPrefix = '/.zenfs_metadata';

export class WebAccessFS extends Async(FileSystem) {
	protected _handles: Map<string, FileSystemHandle> = new Map();

	private metadataHandle!: FileSystemDirectoryHandle;

	public async ready(): Promise<void> {
		// create the metadata directory if it doesn't exist
		this.metadataHandle = await this.rootHandle.getDirectoryHandle(metadataPrefix.slice(1), { create: true });
		await super.ready();
	}

	/**
	 * @hidden
	 */
	_sync: FileSystem = InMemory.create({ name: 'accessfs-cache' });

	public constructor(protected rootHandle: FileSystemDirectoryHandle) {
		super();
		this._handles.set('/', rootHandle);
	}

	public metadata(): FileSystemMetadata {
		return {
			...super.metadata(),
			name: 'WebAccess',
			noResizableBuffers: true,
		};
	}

	protected async _write(path: string, data: Uint8Array): Promise<void> {
		if (data.buffer.resizable) {
			const newData = new Uint8Array(new ArrayBuffer(data.byteLength));
			newData.set(data);
			data = newData;
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

	protected async _writeMetadata(path: string, metadata: StatsLike): Promise<void> {
		console.log('write metadata', path);
		const inode = new Inode();
		Object.assign(inode, metadata);
		const md = await this.metadataHandle.getFileHandle(path.replaceAll('/', '\\'), { create: true });
		console.log('\tgot handle');
		const writable = await md.createWritable();
		console.log('\tgot writable');
		const data = serialize(inode);
		console.log(`\twriting metadata (${data.byteLength} bytes)`);
		await writable.write(data);
		await writable.close();
	}

	protected async _getMetadata(path: string): Promise<Inode | undefined> {
		console.log('get metadata', path);
		const md = await this.metadataHandle.getFileHandle(path.replaceAll('/', '\\')).catch(() => {});
		if (!md) {
			return;
		}
		const buffer = await (await md.getFile()).arrayBuffer();
		if (buffer.byteLength != 58) {
			await this._deleteMetadata(path);
			return;
		}
		return new Inode(buffer);
	}

	protected async _deleteMetadata(path: string): Promise<void> {
		await this.metadataHandle.removeEntry(path.replaceAll('/', '\\')).catch(() => {});
	}

	public async sync(path: string, data: Uint8Array, stats: Stats): Promise<void> {
		await this._writeMetadata(path, stats);
		await this._write(path, data);
	}

	public async rename(oldPath: string, newPath: string): Promise<void> {
		if (oldPath.startsWith(metadataPrefix) || newPath.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'writeFile');
		}
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

	public async createFile(path: string, flag: string, mode: number): Promise<PreloadFile<this>> {
		if (path.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'createFile');
		}
		console.trace('createFile', path, flag, mode);
		await this._writeMetadata(path, new Stats({ mode }));
		await this._write(path, new Uint8Array());

		this._sync.createFileSync(path, flag, mode);
		return this.openFile(path, flag);
	}

	public override statSync(path: string): Stats {
		const _ = this._sync.statSync(path);
		console.log('statSync', path, !!_);
		return _;
	}

	public async stat(path: string): Promise<Stats> {
		if (path.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'stat');
		}
		console.log('stat', path);
		const handle = await this.getHandle(path);
		if (!handle) {
			throw ErrnoError.With('ENOENT', path, 'stat');
		}
		const inode = await this._getMetadata(path);
		if (handle instanceof FileSystemDirectoryHandle) {
			return new Stats(inode || { mode: 0o777 | S_IFDIR, size: 4096 });
		}
		if (handle instanceof FileSystemFileHandle) {
			const { lastModified, size } = await handle.getFile();
			return new Stats(inode || { mode: 0o777 | S_IFREG, size, mtimeMs: lastModified });
		}
		throw new ErrnoError(Errno.EBADE, 'Handle is not a directory or file', path, 'stat');
	}

	public async openFile(path: string, flag: string): Promise<PreloadFile<this>> {
		if (path.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'openFile');
		}
		const handle = await this.getHandle(path);
		if (!(handle instanceof FileSystemFileHandle)) {
			throw ErrnoError.With('EISDIR', path, 'openFile');
		}
		const file = await handle.getFile().catch((ex: ConvertException) => {
			throw convertException(ex, path, 'openFile');
		});
		console.log('openFile', path, flag, !!file);
		const inode = await this._getMetadata(path);
		console.log('\tgot metadata');
		const stats = new Stats(inode || { mode: 0o777 | S_IFREG, size: file.size, mtimeMs: file.lastModified });
		return new PreloadFile(this, path, flag, stats, new Uint8Array(await file.arrayBuffer()));
	}

	public async unlink(path: string): Promise<void> {
		if (path.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'unlink');
		}
		const handle = await this.getHandle(dirname(path));
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ErrnoError.With('ENOTDIR', dirname(path), 'unlink');
		}
		await handle.removeEntry(basename(path), { recursive: true }).catch((ex: ConvertException) => {
			throw convertException(ex, path, 'unlink');
		});
		await this._deleteMetadata(path);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async link(): Promise<void> {
		return;
	}

	public async rmdir(path: string): Promise<void> {
		return this.unlink(path);
	}

	public async mkdir(path: string): Promise<void> {
		if (path.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'mkdir');
		}
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
		if (path.startsWith(metadataPrefix)) {
			throw ErrnoError.With('EPERM', metadataPrefix, 'readdir');
		}
		const handle = await this.getHandle(path);
		if (!(handle instanceof FileSystemDirectoryHandle)) {
			throw ErrnoError.With('ENOTDIR', path, 'readdir');
		}

		const entries = [];
		for await (const k of handle.keys()) {
			if (path == '/' && k == metadataPrefix.slice(1)) continue;
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
						console.log('getHandle TypeError');
						throw new ErrnoError(Errno.ENOENT, ex.message, walked, 'getHandle');
					default:
					//						throw convertException(ex, walked, 'getHandle');
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
