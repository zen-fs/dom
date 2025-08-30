/*
Ponyfill of the File System Access web API.
This is a re-write of `file-system-access` by Alexandru Ciucă (@use-strict)
*/
/// <reference lib="dom.asynciterable" />

function isCommand<const T extends WriteCommandType = WriteCommandType>(chunk: unknown, type: T): chunk is WriteParams & { type: T } {
	return typeof chunk === 'object' && chunk != null && 'type' in chunk && chunk.type == type;
}

class Sink implements UnderlyingSink<FileSystemWriteChunkType> {
	protected position: number = 0;

	constructor(
		private handle: FileHandle,
		{ keepExistingData }: FileSystemCreateWritableOptions
	) {}

	async write(chunk: FileSystemWriteChunkType) {
		if (isCommand(chunk, 'seek')) {
			if (!Number.isInteger(chunk.position) || chunk.position! < 0) throw new DOMException('', 'SyntaxError');
			this.position = chunk.position!;
			return;
		}

		if (isCommand(chunk, 'truncate')) {
			if (!Number.isInteger(chunk.size) || chunk.size! < 0) throw new DOMException('', 'SyntaxError');
			const props = { lastModified: Date.now(), type: this.handle.file.type };
			if (chunk.size! < this.handle.file.size) {
				// cutting down
				this.handle.file = new File([this.handle.file.slice(0, chunk.size!)], this.handle.file.name, props);
			} else if (chunk.size! > this.handle.file.size) {
				// extending
				this.handle.file = new File([this.handle.file, new Uint8Array(chunk.size! - this.handle.file.size)], this.handle.file.name, props);
			}
			if (this.position > this.handle.file.size) this.position = this.handle.file.size;
			return;
		}

		if (isCommand(chunk, 'write')) {
			if (typeof chunk.position === 'number' && chunk.position >= 0) {
				this.position = chunk.position;
				if (this.handle.file.size < chunk.position) {
					// Pad with empty data if seeking past the current size
					this.handle.file = new File([this.handle.file, new Uint8Array(chunk.position - this.handle.file.size)], this.handle.file.name);
				}
			}
			if (!('data' in chunk)) throw new DOMException('', 'SyntaxError');
			chunk = chunk.data!;
		}

		chunk = new Blob([chunk as Exclude<FileSystemWriteChunkType, WriteParams>]);

		// Calculate the head and tail fragments
		const head = this.handle.file.slice(0, this.position);
		const tail = this.handle.file.slice(this.position + chunk.size);

		// Add padding if necessary
		const padding = Math.max(this.position - head.size, 0);
		this.handle.file = new File([head, new Uint8Array(padding), chunk, tail], this.handle.file.name);
		this.position += chunk.size;
	}

	async close() {}
}

class WritableFileStream extends WritableStream<FileSystemWriteChunkType> implements FileSystemWritableFileStream {
	private writer: WritableStreamDefaultWriter<FileSystemWriteChunkType>;

	constructor(
		protected readonly handle: FileHandle,
		protected readonly options: FileSystemCreateWritableOptions
	) {
		super(new Sink(handle, options));
		this.writer = this.getWriter();
	}

	public seek(position: number) {
		return this.write({ type: 'seek', position });
	}

	public truncate(size: number) {
		return this.write({ type: 'truncate', size });
	}

	public async write(data: FileSystemWriteChunkType) {
		await this.writer.ready;
		await this.writer.write(data);
	}

	public async close(): Promise<void> {
		await this.writer.close();
		this.writer.releaseLock();
	}
}

abstract class Handle implements globalThis.FileSystemHandle {
	public [Symbol.toStringTag]() {
		return 'FileSystemHandle';
	}

	_parent?: DirectoryHandle;

	public abstract readonly kind: FileSystemHandleKind;

	public constructor(public readonly name: string) {}

	public async queryPermission(): Promise<PermissionState> {
		return 'granted';
	}

	public async requestPermission(): Promise<PermissionState> {
		return 'granted';
	}

	public async isSameEntry(other: globalThis.FileSystemHandle) {
		if (this === other) return true;
		if (this.kind !== other.kind) return false;
		if (!other) return false;
		return false; // PLACEHOLDER
		// Return if locators match
	}

	public abstract remove(options?: FileSystemRemoveOptions): Promise<void>;
}

type HandleWithKind<T extends FileSystemHandleKind> = T extends 'directory' ? DirectoryHandle : FileHandle;

function is<const T extends FileSystemHandleKind>(handle: Handle, kind: T): handle is HandleWithKind<T> {
	return handle.kind == kind;
}

interface FileSystemReadWriteOptions {
	at: number;
}

class SyncAccessHandle {
	protected state: 'open' | 'closed' = 'open';

	constructor(protected readonly file: FileHandle) {}

	read(buffer: AllowSharedBufferSource, options?: FileSystemReadWriteOptions): number {
		return 0;
	}
	write(buffer: AllowSharedBufferSource, options?: FileSystemReadWriteOptions): number {
		return 0;
	}
	truncate(newSize: number): void {}
	getSize(): number {
		return 0;
	}
	flush(): void {}
	close(): void {}
}

class FileHandle extends Handle implements FileSystemFileHandle {
	public [Symbol.toStringTag]() {
		return 'FileSystemFileHandle';
	}

	public readonly kind = 'file';

	constructor(
		name: string,
		public file: File
	) {
		super(name);
	}

	public async getFile(): Promise<File> {
		if (!this.file) throw new DOMException('', 'NotFoundError');
		return this.file;
	}

	public async createWritable(options: FileSystemCreateWritableOptions = {}) {
		if (!this.file) throw new DOMException('', 'NotFoundError');
		return new WritableFileStream(this, options);
	}

	public async createSyncAccessHandle(): Promise<SyncAccessHandle> {
		return new SyncAccessHandle(this);
	}

	public async remove(): Promise<void> {
		this._parent?._data.delete(this.name);
	}
}

type GetOptions<T extends FileSystemHandleKind> = T extends 'directory' ? FileSystemGetDirectoryOptions : FileSystemGetFileOptions;

class DirectoryHandle extends Handle implements FileSystemDirectoryHandle {
	public [Symbol.toStringTag]() {
		return 'FileSystemDirectoryHandle';
	}

	public readonly kind = 'directory';

	/**
	 *
	 * @internal
	 */
	_data = new Map<string, FileHandle | DirectoryHandle>();

	protected _get<T extends FileSystemHandleKind>(kind: T, name: string, options: GetOptions<T>): HandleWithKind<T> {
		if (name === '') throw new TypeError('Name can not be an empty string.');
		if (name === '.' || name === '..' || name.includes('/')) throw new TypeError('Name contains invalid characters.');

		const entry = this._data.get(name);

		if (entry && !is(entry, kind)) throw new DOMException('', 'TypeMismatchError');

		if (entry) return entry;

		if (!options.create) throw new DOMException('', 'NotFoundError');

		const handle = kind === 'directory' ? new DirectoryHandle(name) : new FileHandle(name, new File([], name));

		handle._parent = this;
		this._data.set(name, handle);
		return handle as HandleWithKind<T>;
	}

	public async getFileHandle(name: string, options: FileSystemGetFileOptions = {}): Promise<FileHandle> {
		return this._get('file', name, options);
	}

	public async getDirectoryHandle(name: string, options: FileSystemGetDirectoryOptions = {}): Promise<DirectoryHandle> {
		return this._get('directory', name, options);
	}

	public async removeEntry(name: string, options: FileSystemRemoveOptions = {}): Promise<void> {
		if (name === '') throw new TypeError('Name can not be an empty string.');
		if (name === '.' || name === '..' || name.includes('/')) throw new TypeError('Name contains invalid characters.');
		const entry = this._data.get(name);
		if (!entry) throw new DOMException('', 'NotFoundError');
		await entry.remove(options);
	}

	public async resolve(possibleDescendant: globalThis.FileSystemHandle): Promise<string[] | null> {
		if (await possibleDescendant.isSameEntry(this)) {
			return [];
		}

		const stack: [entry: DirectoryHandle, path: string[]][] = [[this, []]];

		while (stack.length) {
			const [current, path] = stack.pop()!;

			for (const [name, entry] of current._data.entries()) {
				if (entry === possibleDescendant) return [...path, name];

				if (entry.kind != 'directory') continue;

				stack.push([entry, [...path, name]]);
			}
		}

		return null;
	}

	public async remove(options?: FileSystemRemoveOptions): Promise<void> {
		if (this._data.size && !options?.recursive) throw new DOMException('', 'InvalidModificationError');

		for (const entry of this._data.values()) {
			await entry.remove({ recursive: true });
		}

		this._data.clear();
		this._parent?._data.delete(this.name);
	}

	public async *entries(): AsyncGenerator<[string, FileHandle | DirectoryHandle]> {
		for (const entry of this._data.entries()) {
			yield entry;
		}
	}

	public async *keys(): AsyncGenerator<string> {
		for (const key of this._data.keys()) {
			yield key;
		}
	}

	public async *values(): AsyncGenerator<FileHandle | DirectoryHandle> {
		for (const value of this._data.values()) {
			yield value;
		}
	}

	public [Symbol.asyncIterator](): AsyncGenerator<[string, FileHandle | DirectoryHandle]> {
		return this.entries();
	}
}

export {
	Handle as FileSystemHandle,
	FileHandle as FileSystemFileHandle,
	DirectoryHandle as FileSystemDirectoryHandle,
	WritableFileStream as FileSystemWritableFileStream,
};

export const handle = new DirectoryHandle('');
