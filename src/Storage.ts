import type { Backend, Ino, SimpleSyncStore, Store } from '@zenfs/core';
import { ErrnoError, Errno, SimpleTransaction, StoreFS, decodeRaw, encodeRaw } from '@zenfs/core';

/**
 * A synchronous key-value store backed by Storage.
 */
export class WebStorageStore implements Store, SimpleSyncStore {
	public get name(): string {
		return WebStorage.name;
	}

	public constructor(protected storage: Storage) {}

	public clear(): void {
		this.storage.clear();
	}

	public clearSync(): void {
		this.storage.clear();
	}

	public async sync(): Promise<void> {}

	public transaction(): SimpleTransaction {
		// No need to differentiate.
		return new SimpleTransaction(this);
	}

	public get(key: Ino): Uint8Array | undefined {
		const data = this.storage.getItem(key.toString());
		if (typeof data != 'string') {
			return;
		}

		return encodeRaw(data);
	}

	public set(key: Ino, data: Uint8Array): void {
		try {
			this.storage.setItem(key.toString(), decodeRaw(data));
		} catch (e) {
			throw new ErrnoError(Errno.ENOSPC, 'Storage is full.');
		}
	}

	public delete(key: Ino): void {
		try {
			this.storage.removeItem(key.toString());
		} catch (e) {
			throw new ErrnoError(Errno.EIO, 'Unable to delete key ' + key + ': ' + e);
		}
	}
}

/**
 * Options to pass to the StorageFileSystem
 */
export interface WebStorageOptions {
	/**
	 * The Storage to use. Defaults to globalThis.localStorage.
	 */
	storage?: Storage;
}

/**
 * A synchronous file system backed by a `Storage` (e.g. localStorage).
 */
const _WebStorage = {
	name: 'WebStorage',

	options: {
		storage: {
			type: 'object',
			required: false,
			description: 'The Storage to use. Defaults to globalThis.localStorage.',
		},
	},

	isAvailable(storage: Storage = globalThis.localStorage): boolean {
		return storage instanceof globalThis.Storage;
	},

	create({ storage = globalThis.localStorage }: WebStorageOptions) {
		return new StoreFS(new WebStorageStore(storage));
	},
} as const satisfies Backend<StoreFS, WebStorageOptions>;
type _WebStorage = typeof _WebStorage;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface WebStorage extends _WebStorage {}
export const WebStorage: WebStorage = _WebStorage;
