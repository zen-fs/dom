import type { Store } from '@zenfs/core/backends/store/store.js';
import { AsyncTransaction } from '@zenfs/core/backends/store/store.js';
import type { Backend, Ino } from '@zenfs/core';
import { Async, ErrnoError, StoreFS } from '@zenfs/core';
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
export class IndexedDBTransaction extends AsyncTransaction {
	constructor(
		public tx: IDBTransaction,
		public store: IDBObjectStore
	) {
		super();
	}

	public get(key: Ino): Promise<Uint8Array> {
		return wrap(this.store.get(key.toString()));
	}

	public async set(key: Ino, data: Uint8Array): Promise<void> {
		await wrap(this.store.put(data, key.toString()));
	}

	public remove(key: Ino): Promise<void> {
		return wrap(this.store.delete(key.toString()));
	}

	public async commit(): Promise<void> {
		this.tx.commit();
	}

	public async abort(): Promise<void> {
		try {
			this.tx.abort();
		} catch (e) {
			throw convertException(e as ConvertException);
		}
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
		throw new Error('Method not implemented.');
	}

	public get name(): string {
		return IndexedDB.name + ':' + this.db.name;
	}

	public clear(): Promise<void> {
		return wrap(this.db.transaction(this.db.name, 'readwrite').objectStore(this.db.name).clear());
	}

	public clearSync(): void {
		throw ErrnoError.With('ENOSYS', undefined, 'IndexedDBStore.clearSync');
	}

	public transaction(): IndexedDBTransaction {
		const tx = this.db.transaction(this.db.name, 'readwrite');
		return new IndexedDBTransaction(tx, tx.objectStore(this.db.name));
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

export const IndexedDB = {
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

	async create(options: IndexedDBOptions) {
		const db = await createDB(options.storeName || 'zenfs', options.idbFactory);
		const store = new IndexedDBStore(db);
		const fs = new (Async(StoreFS) as typeof StoreFS)(store);
		return fs;
	},
} as const satisfies Backend<StoreFS, IndexedDBOptions>;
