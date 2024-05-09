import type { Backend, Ino, SimpleSyncStore, SyncStore } from '@zenfs/core';
import { ErrnoError, Errno, SimpleSyncTransaction, SyncStoreFS, decode, encode } from '@zenfs/core';

/**
 * A synchronous key-value store backed by Storage.
 */
export class WebStorageStore implements SyncStore, SimpleSyncStore {
	public get name(): string {
		return WebStorage.name;
	}

	constructor(protected _storage: Storage) {}

	public clear(): void {
		this._storage.clear();
	}

	public beginTransaction(): SimpleSyncTransaction {
		// No need to differentiate.
		return new SimpleSyncTransaction(this);
	}

	public get(key: Ino): Uint8Array | undefined {
		const data = this._storage.getItem(key.toString());
		if (typeof data != 'string') {
			return;
		}

		return encode(data);
	}

	public put(key: Ino, data: Uint8Array, overwrite: boolean): boolean {
		try {
			if (!overwrite && this._storage.getItem(key.toString()) !== null) {
				// Don't want to overwrite the key!
				return false;
			}
			this._storage.setItem(key.toString(), decode(data));
			return true;
		} catch (e) {
			throw new ErrnoError(Errno.ENOSPC, 'Storage is full.');
		}
	}

	public remove(key: Ino): void {
		try {
			this._storage.removeItem(key.toString());
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
export const WebStorage = {
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
		return new SyncStoreFS({ store: new WebStorageStore(storage) });
	},
} as const satisfies Backend<SyncStoreFS, WebStorageOptions>;
