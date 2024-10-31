import type { Backend, Ino, SharedConfig, Store } from '@zenfs/core';
import { Async, AsyncTransaction, ErrnoError, InMemory, StoreFS } from '@zenfs/core';
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
 * @hidden
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

	public async keys(): Promise<Iterable<Ino>> {
		return (await wrap(this._idb.getAllKeys())).filter(k => typeof k == 'string').map(k => BigInt(k));
	}

	public get(key: Ino): Promise<Uint8Array> {
		return wrap(this._idb.get(key.toString()));
	}

	public async set(key: Ino, data: Uint8Array): Promise<void> {
		await wrap(this._idb.put(data, key.toString()));
	}

	public remove(key: Ino): Promise<void> {
		return wrap(this._idb.delete(key.toString()));
	}

	public async commit(): Promise<void> {
		if (this.done) {
			return;
		}
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.done = true;
		this.tx.oncomplete = () => resolve();
		this.tx.onerror = () => reject(convertException(this.tx.error!));
		this.tx.commit();
		return promise;
	}

	public async abort(): Promise<void> {
		if (this.done) {
			return;
		}
		this.done = true;
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
		const db: IDBDatabase = req.result;
		// This should never happen; we're at version 1. Why does another database exist?
		if (db.objectStoreNames.contains(name)) {
			db.deleteObjectStore(name);
		}
		db.createObjectStore(name);
	};

	const result = await wrap(req);
	return result;
}

export class IndexedDBStore implements Store {
	public constructor(protected db: IDBDatabase) {}

	public sync(): Promise<void> {
		throw ErrnoError.With('ENOSYS', undefined, 'IndexedDBStore.sync');
	}

	public get name(): string {
		return this.db.name;
	}

	public clear(): Promise<void> {
		return wrap(this.db.transaction(this.name, 'readwrite').objectStore(this.name).clear());
	}

	public clearSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'IndexedDBStore.clearSync');
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
		storeName: {
			type: 'string',
			required: false,
			description: 'The name of this file system. You can have multiple IndexedDB file systems operating at once, but each must have a different name.',
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

	async create(options: IndexedDBOptions & Partial<SharedConfig>) {
		const db = await createDB(options.storeName || 'zenfs', options.idbFactory);
		const store = new IndexedDBStore(db);
		const fs = new (Async(StoreFS))(store);
		if (!options?.disableAsyncCache) {
			fs._sync = InMemory.create({ name: 'idb-cache' });
		}
		return fs;
	},
} as const satisfies Backend<StoreFS, IndexedDBOptions>;
type _IndexedDB = typeof _IndexedDB;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IndexedDB extends _IndexedDB {}
export const IndexedDB: IndexedDB = _IndexedDB;
