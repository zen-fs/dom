import type { AsyncStore, AsyncStoreOptions, AsyncTransaction, Backend, Ino } from '@zenfs/core';
import { AsyncStoreFS } from '@zenfs/core';
import { convertException, type ConvertException } from './utils.js';

function wrap<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = e => {
			e.preventDefault();
			reject(convertException(request.error!));
		};
	});
}

/**
 * @hidden
 */
export class IndexedDBTransaction implements AsyncTransaction {
	constructor(
		public tx: IDBTransaction,
		public store: IDBObjectStore
	) {}

	public get(key: Ino): Promise<Uint8Array> {
		return wrap<Uint8Array>(this.store.get(key.toString()));
	}

	/**
	 * @todo return false when add has a key conflict (no error)
	 */
	public async put(key: Ino, data: Uint8Array, overwrite: boolean): Promise<boolean> {
		await wrap(this.store[overwrite ? 'put' : 'add'](data, key.toString()));
		return true;
	}

	public remove(key: Ino): Promise<void> {
		return wrap(this.store.delete(key.toString()));
	}

	public async commit(): Promise<void> {
		return;
	}

	public async abort(): Promise<void> {
		try {
			this.tx.abort();
		} catch (e) {
			throw convertException(e as ConvertException);
		}
	}
}

export class IndexedDBStore implements AsyncStore {
	public static async create(storeName: string, indexedDB: IDBFactory = globalThis.indexedDB): Promise<IndexedDBStore> {
		const req: IDBOpenDBRequest = indexedDB.open(storeName, 1);

		req.onupgradeneeded = () => {
			const db: IDBDatabase = req.result;
			// This should never happen; we're at version 1. Why does another database exist?
			if (db.objectStoreNames.contains(storeName)) {
				db.deleteObjectStore(storeName);
			}
			db.createObjectStore(storeName);
		};

		const result = await wrap(req);
		return new IndexedDBStore(result, storeName);
	}

	constructor(
		protected db: IDBDatabase,
		protected storeName: string
	) {}

	public get name(): string {
		return IndexedDB.name + ':' + this.storeName;
	}

	public clear(): Promise<void> {
		return wrap(this.db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).clear());
	}

	public beginTransaction(): IndexedDBTransaction {
		const tx = this.db.transaction(this.storeName, 'readwrite');
		return new IndexedDBTransaction(tx, tx.objectStore(this.storeName));
	}
}

/**
 * Configuration options for the IndexedDB file system.
 */
export interface IndexedDBOptions extends Omit<AsyncStoreOptions, 'store'> {
	/**
	 * The name of this file system. You can have multiple IndexedDB file systems operating at once, but each must have a different name.
	 */
	storeName?: string;

	/**
	 * The IDBFactory to use. Defaults to `globalThis.indexedDB`.
	 */
	idbFactory?: IDBFactory;
}

/**
 * A file system that uses the IndexedDB key value file system.
 */

export const IndexedDB = {
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

	async isAvailable(idbFactory: IDBFactory = globalThis.indexedDB): Promise<boolean> {
		try {
			if (!(idbFactory instanceof IDBFactory)) {
				return false;
			}
			const req = idbFactory.open('__zenfs_test');
			await wrap(req);
			idbFactory.deleteDatabase('__zenfs_test');
			return true;
		} catch (e) {
			idbFactory.deleteDatabase('__zenfs_test');
			return false;
		}
	},

	create(options: IndexedDBOptions) {
		const store = IndexedDBStore.create(options.storeName || 'zenfs', options.idbFactory);
		const fs = new AsyncStoreFS({ ...options, store });
		return fs;
	},
} as const satisfies Backend;
