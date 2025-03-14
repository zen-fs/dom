import type { Backend, SharedConfig, Store } from '@zenfs/core';
import { AsyncTransaction, StoreFS, log } from '@zenfs/core';
import type * as cache from 'utilium/cache.js';
import { convertException } from './utils.js';

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
 * @internal @hidden
 */
export class IndexedDBTransaction extends AsyncTransaction<IndexedDBStore> {
	private _idb: IDBObjectStore;

	public constructor(
		public tx: IDBTransaction,
		public store: IndexedDBStore
	) {
		super(store);
		this._idb = tx.objectStore(store.name);
	}

	public async keys(): Promise<Iterable<number>> {
		return (await wrap(this._idb.getAllKeys())).filter(k => typeof k == 'string').map(k => Number(k));
	}

	public async get(id: number): Promise<Uint8Array | undefined> {
		const data: Uint8Array | undefined = await wrap(this._idb.get(id.toString()));
		if (data) this._cached(id, { size: data.byteLength })!.add(data, 0);
		return data;
	}

	public async set(id: number, data: Uint8Array): Promise<void> {
		this._cached(id, { size: data.byteLength })!.add(data, 0);
		await wrap(this._idb.put(data, id.toString()));
	}

	public remove(id: number): Promise<void> {
		this.store.cache.delete(id);
		return wrap(this._idb.delete(id.toString()));
	}

	public async commit(): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.tx.oncomplete = () => resolve();
		this.tx.onerror = () => reject(convertException(this.tx.error!));
		this.tx.commit();
		return promise;
	}

	public async abort(): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.tx.onabort = () => resolve();
		this.tx.onerror = () => reject(convertException(this.tx.error!));
		this.tx.abort();
		return promise;
	}
}

async function createDB(name: string, indexedDB: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
	const req: IDBOpenDBRequest = indexedDB.open(name);

	req.onupgradeneeded = () => {
		const db = req.result;
		// This should never happen; we're at version 1. Why does another database exist?
		if (db.objectStoreNames.contains(name)) {
			log.warn('Found unexpected object store: ' + name);
			db.deleteObjectStore(name);
		}
		db.createObjectStore(name);
	};

	return await wrap(req);
}

export class IndexedDBStore implements Store {
	cache = new Map<number, cache.Resource<number>>();

	public constructor(protected db: IDBDatabase) {}

	public sync(): Promise<void> {
		return Promise.resolve();
	}

	public get name(): string {
		return this.db.name;
	}

	public transaction(): IndexedDBTransaction {
		const tx = this.db.transaction(this.name, 'readwrite');
		return new IndexedDBTransaction(tx, this);
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
	 * The IDBFactory to use. Defaults to `globalThis.indexedDB`.
	 */
	idbFactory?: IDBFactory;
}

/**
 * A file system that uses the IndexedDB key value file system.
 */

const _IndexedDB = {
	name: 'IndexedDB',

	options: {
		storeName: { type: 'string', required: false },
		idbFactory: { type: 'object', required: false },
	},

	async isAvailable({ idbFactory = globalThis.indexedDB }: IndexedDBOptions): Promise<boolean> {
		try {
			if (!(idbFactory instanceof IDBFactory)) return false;

			const req = idbFactory.open('__zenfs_test');
			await wrap(req);
			return true;
		} catch {
			return false;
		} finally {
			idbFactory?.deleteDatabase('__zenfs_test');
		}
	},

	async create(options: IndexedDBOptions & Partial<SharedConfig>): Promise<StoreFS<IndexedDBStore>> {
		const db = await createDB(options.storeName || 'zenfs', options.idbFactory);
		const store = new IndexedDBStore(db);
		const fs = new StoreFS(store);
		if (options?.disableAsyncCache) {
			log.notice('Async preloading disabled for IndexedDB');
			return fs;
		}
		const tx = store.transaction();
		for (const id of await tx.keys()) {
			await tx.get(id); // Adds to cache
		}
		return fs;
	},
} as const satisfies Backend<StoreFS<IndexedDBStore>, IndexedDBOptions>;
type _IndexedDB = typeof _IndexedDB;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IndexedDB extends _IndexedDB {}
export const IndexedDB: IndexedDB = _IndexedDB;
