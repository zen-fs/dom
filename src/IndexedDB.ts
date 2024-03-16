import { AsyncROTransaction, AsyncRWTransaction, AsyncStore, AsyncStoreFS } from '@browserfs/core/backends/AsyncStore.js';
import { ApiError, ErrorCode } from '@browserfs/core/ApiError.js';
import type { Backend } from '@browserfs/core/backends/backend.js';
import type { Ino } from '@browserfs/core/inode.js';

/**
 * Converts a DOMException or a DOMError from an IndexedDB event into a
 * standardized BrowserFS API error.
 * @hidden
 */
function convertError(e: { name: string }, message: string = e.toString()): ApiError {
	switch (e.name) {
		case 'NotFoundError':
			return new ApiError(ErrorCode.ENOENT, message);
		case 'QuotaExceededError':
			return new ApiError(ErrorCode.ENOSPC, message);
		default:
			// The rest do not seem to map cleanly to standard error codes.
			return new ApiError(ErrorCode.EIO, message);
	}
}

/**
 * @hidden
 */
export class IndexedDBROTransaction implements AsyncROTransaction {
	constructor(public tx: IDBTransaction, public store: IDBObjectStore) {}

	public get(key: Ino): Promise<Uint8Array> {
		return new Promise((resolve, reject) => {
			try {
				const req: IDBRequest = this.store.get(key.toString());
				req.onerror = e => {
					e.preventDefault();
					reject(new ApiError(ErrorCode.EIO));
				};
				req.onsuccess = () => {
					// IDB returns the value 'undefined' when you try to get keys that
					// don't exist. The caller expects this behavior.
					const result = req.result;
					if (result === undefined) {
						resolve(result);
					} else {
						// IDB data is stored as an ArrayUint8Array
						resolve(Uint8Array.from(result));
					}
				};
			} catch (e) {
				reject(convertError(e));
			}
		});
	}
}

/**
 * @hidden
 */
export class IndexedDBRWTransaction extends IndexedDBROTransaction implements AsyncRWTransaction, AsyncROTransaction {
	constructor(tx: IDBTransaction, store: IDBObjectStore) {
		super(tx, store);
	}

	/**
	 * @todo return false when add has a key conflict (no error)
	 */
	public put(key: Ino, data: Uint8Array, overwrite: boolean): Promise<boolean> {
		return new Promise((resolve, reject) => {
			try {
				const req: IDBRequest = overwrite ? this.store.put(data, key.toString()) : this.store.add(data, key.toString());
				req.onerror = e => {
					e.preventDefault();
					reject(new ApiError(ErrorCode.EIO));
				};
				req.onsuccess = () => resolve(true);
			} catch (e) {
				reject(convertError(e));
			}
		});
	}

	public remove(key: Ino): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const req: IDBRequest = this.store.delete(key.toString());
				req.onerror = e => {
					e.preventDefault();
					reject(new ApiError(ErrorCode.EIO));
				};
				req.onsuccess = () => resolve;
			} catch (e) {
				reject(convertError(e));
			}
		});
	}

	public commit(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	public async abort(): Promise<void> {
		try {
			this.tx.abort();
		} catch (e) {
			throw convertError(e);
		}
	}
}

export class IndexedDBStore implements AsyncStore {
	public static create(storeName: string, indexedDB: IDBFactory): Promise<IndexedDBStore> {
		return new Promise((resolve, reject) => {
			const req: IDBOpenDBRequest = indexedDB.open(storeName, 1);

			req.onupgradeneeded = () => {
				const db: IDBDatabase = req.result;
				// This should never happen; we're at version 1. Why does another database exist?
				if (db.objectStoreNames.contains(storeName)) {
					db.deleteObjectStore(storeName);
				}
				db.createObjectStore(storeName);
			};

			req.onsuccess = () => resolve(new IndexedDBStore(req.result, storeName));

			req.onerror = e => {
				e.preventDefault();
				reject(new ApiError(ErrorCode.EACCES));
			};
		});
	}

	constructor(protected db: IDBDatabase, protected storeName: string) {}

	public get name(): string {
		return IndexedDB.name + ':' + this.storeName;
	}

	public clear(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const req: IDBRequest = this.db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).clear();
				req.onsuccess = () => setTimeout(resolve, 0);
				req.onerror = e => {
					e.preventDefault();
					reject(new ApiError(ErrorCode.EIO));
				};
			} catch (e) {
				reject(convertError(e));
			}
		});
	}

	public beginTransaction(type: 'readonly'): AsyncROTransaction;
	public beginTransaction(type: 'readwrite'): AsyncRWTransaction;
	public beginTransaction(type: 'readonly' | 'readwrite' = 'readonly'): AsyncROTransaction {
		const tx = this.db.transaction(this.storeName, type),
			objectStore = tx.objectStore(this.storeName);
		if (type === 'readwrite') {
			return new IndexedDBRWTransaction(tx, objectStore);
		}

		if (type === 'readonly') {
			return new IndexedDBROTransaction(tx, objectStore);
		}

		throw new ApiError(ErrorCode.EINVAL, 'Invalid transaction type.');
	}
}

/**
 * Configuration options for the IndexedDB file system.
 */
export interface IndexedDBOptions {
	/**
	 * The name of this file system. You can have multiple IndexedDB file systems operating at once, but each must have a different name.
	 */
	storeName?: string;

	/**
	 * The size of the inode cache. Defaults to 100. A size of 0 or below disables caching.
	 */
	cacheSize?: number;

	/**
	 * The IDBFactory to use. Defaults to `globalThis.indexedDB`.
	 */
	idbFactory?: IDBFactory;
}

/**
 * A file system that uses the IndexedDB key value file system.
 */

export const IndexedDB: Backend = {
	name: 'IndexedDB',

	options: {
		storeName: {
			type: 'string',
			required: false,
			description: 'The name of this file system. You can have multiple IndexedDB file systems operating at once, but each must have a different name.',
		},
		cacheSize: {
			type: 'number',
			required: false,
			description: 'The size of the inode cache. Defaults to 100. A size of 0 or below disables caching.',
		},
		idbFactory: {
			type: 'object',
			required: false,
			description: 'The IDBFactory to use. Defaults to globalThis.indexedDB.',
		},
	},

	isAvailable(idbFactory: IDBFactory = globalThis.indexedDB): boolean {
		try {
			if (!(idbFactory instanceof IDBFactory)) {
				return false;
			}
			const req = idbFactory.open('__browserfs_test');
			if (!req) {
				return false;
			}
			req.onsuccess = () => idbFactory.deleteDatabase('__browserfs_test');
		} catch (e) {
			return false;
		}
	},

	create({ cacheSize = 100, storeName = 'browserfs', idbFactory = globalThis.indexedDB }: IndexedDBOptions) {
		const store = IndexedDBStore.create(storeName, idbFactory);
		const fs = new AsyncStoreFS({ cacheSize, store });
		return fs;
	},
};
