/*
Ponyfill of the File System Access web API.
This is a re-write of `file-system-access` by Alexandru Ciucă (@use-strict)
*/

function isCommand<const T extends WriteCommandType = WriteCommandType>(chunk: unknown, type: T): chunk is WriteParams & { type: T } {
	return typeof chunk === 'object' && chunk != null && 'type' in chunk && chunk.type == type;
}

class Sink implements UnderlyingSink<FileSystemWriteChunkType> {
	protected file: File;
	protected position: number = 0;

	constructor(
		private handle: FileHandle,
		{ keepExistingData }: FileSystemCreateWritableOptions
	) {
		this.file = keepExistingData ? handle.file : new File([], handle.file.name, handle.file);
	}

	async write(chunk: FileSystemWriteChunkType) {
		if (!this.handle.file) throw new DOMException('', 'NotFoundError');

		if (isCommand(chunk, 'seek')) {
			if (!Number.isInteger(chunk.position) || chunk.position! < 0) throw new DOMException('', 'SyntaxError');
			if (this.file.size < chunk.position!) throw new DOMException('seeking position failed.', 'InvalidStateError');

			this.position = chunk.position!;
			return;
		}

		if (isCommand(chunk, 'truncate')) {
			if (!Number.isInteger(chunk.size) || chunk.size! < 0) throw new DOMException('', 'SyntaxError');
			const parts = [chunk.size! < this.file.size ? this.file.slice(0, chunk.size!) : this.file, new Uint8Array(chunk.size! - this.file.size)];
			this.file = new File(parts, this.file.name, this.file);
			if (this.position > this.file.size) this.position = this.file.size;
			return;
		}

		if (isCommand(chunk, 'write')) {
			if (typeof chunk.position === 'number' && chunk.position >= 0) {
				this.position = chunk.position;
				if (this.file.size < chunk.position) {
					this.file = new File([this.file, new ArrayBuffer(chunk.position - this.file.size)], this.file.name, this.file);
				}
			}
			if (!('data' in chunk)) {
				throw new DOMException('', 'SyntaxError');
			}
			chunk = chunk.data!;
		}

		chunk = new Blob([chunk as Exclude<FileSystemWriteChunkType, WriteParams>]);

		// Calc the head and tail fragments
		const head = this.file.slice(0, this.position);
		const tail = this.file.slice(this.position + chunk.size);

		// Calc the padding
		let padding = this.position - head.size;
		if (padding < 0) padding = 0;
		this.file = new File([head, new Uint8Array(padding), chunk, tail], this.file.name);

		this.position += chunk.size;
	}

	async close() {
		if (!this.handle.file) throw new DOMException('', 'NotFoundError');
		this.handle.file = this.file;
		this.file = this.position = null!;
	}
}

class WritableFileStream extends WritableStream<FileSystemWriteChunkType> implements FileSystemWritableFileStream {
	constructor(
		protected readonly handle: FileHandle,
		protected readonly options: FileSystemCreateWritableOptions
	) {
		super(new Sink(handle, options));
	}

	public seek(position: number) {
		return this.write({ type: 'seek', position });
	}

	public truncate(size: number) {
		return this.write({ type: 'truncate', size });
	}

	public async write(data: FileSystemWriteChunkType) {
		const writer = this.getWriter();
		await writer.write(data);
		writer.releaseLock();
	}
}

abstract class Handle implements globalThis.FileSystemHandle {
	public [Symbol.toStringTag]() {
		return 'FileSystemHandle';
	}

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

	public async remove(): Promise<void> {}
}

type GetOptions<T extends FileSystemHandleKind> = T extends 'directory' ? FileSystemGetDirectoryOptions : FileSystemGetFileOptions;

class DirectoryHandle extends Handle implements FileSystemDirectoryHandle {
	public [Symbol.toStringTag]() {
		return 'FileSystemDirectoryHandle';
	}

	_parent?: DirectoryHandle;

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

		const handle = (kind == 'directory' ? new DirectoryHandle(name) : new FileHandle(name, new File([], name))) as HandleWithKind<T>;

		this._data.set(name, handle);
		return handle;
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
		entry.remove(options);
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

				stack.push([entry as DirectoryHandle, [...path, name]]);
			}
		}

		return null;
	}

	public async remove(options?: FileSystemRemoveOptions): Promise<void> {
		if (this._data.size && !options?.recursive) throw new DOMException('', 'InvalidModificationError');

		for (const entry of this._data.values()) {
			entry.remove({ recursive: true });
		}

		this._data.clear();
		this._parent?._data.delete(this.name);
	}

	public async entries() {
		return this._data.entries();
	}

	public async keys() {
		return this._data.keys();
	}

	public async values() {
		return this._data.values();
	}

	public [Symbol.asyncIterator]() {
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
