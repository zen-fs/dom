// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Backend, SharedConfig, Store } from '@zenfs/core';
import { StoreFS, Transaction } from '@zenfs/core';
import { log } from 'kerium';
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
export class IndexedDBTransaction extends Transaction<IndexedDBStore> {
	private _idb: IDBObjectStore;

	protected asyncDone: Promise<unknown> = Promise.resolve();

	/**
	 * Run a asynchronous operation from a sync context. Not magic and subject to (race) conditions.
	 * @internal
	 */
	protected async(promise: Promise<unknown>): void {
		this.asyncDone = this.asyncDone.then(() => promise);
	}

	public constructor(
		public tx: IDBTransaction,
		public store: IndexedDBStore
	) {
		super(store);
		this._idb = tx.objectStore(store.name);
	}

	public async keys(): Promise<Iterable<number>> {
		return (await wrap(this._idb.getAllKeys())).map(Number);
	}

	public async get(id: number): Promise<Uint8Array | undefined> {
		const data: Uint8Array | undefined = await wrap(this._idb.get(id));
		if (data) this.store.cache.set(id, new Uint8Array(data));
		return data;
	}

	public getSync(id: number, offset: number, end?: number): Uint8Array | undefined {
		if (!this.store.cache.has(id)) return;
		const data = new Uint8Array(this.store.cache.get(id)!);
		end ??= data.byteLength;
		return data.subarray(offset, end);
	}

	public async set(id: number, data: Uint8Array): Promise<void> {
		this.store.cache.set(id, new Uint8Array(data));
		await wrap(this._idb.put(data, id));
	}

	public setSync(id: number, data: Uint8Array): void {
		this.async(this.set(id, data));
	}

	public remove(id: number): Promise<void> {
		this.store.cache.delete(id);
		return wrap(this._idb.delete(id));
	}

	public removeSync(id: number): void {
		this.store.cache.delete(id);
		this.async(this.remove(id));
	}

	public async commit(): Promise<void> {
		await this.asyncDone;
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.tx.oncomplete = () => resolve();
		this.tx.onerror = () => reject(convertException(this.tx.error!));
		this.tx.commit();
		return promise;
	}

	public async abort(): Promise<void> {
		await this.asyncDone;
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
	cache = new Map<number, Uint8Array>();

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
 * Used to memoize the availability test result
 */
const idbTests = new WeakMap<IDBFactory, Promise<boolean>>();

async function testAvailability(idbFactory: IDBFactory): Promise<boolean> {
	if (!(idbFactory instanceof IDBFactory)) return false;

	try {
		const req = idbFactory.open('__zenfs_test');

		await wrap(req);
		return true;
	} catch {
		return false;
	} finally {
		idbFactory?.deleteDatabase('__zenfs_test');
	}
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
		if (idbTests.has(idbFactory)) return idbTests.get(idbFactory)!;
		const result = testAvailability(idbFactory);
		idbTests.set(idbFactory, result);
		return result;
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
