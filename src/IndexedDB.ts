// SPDX-License-Identifier: LGPL-3.0-or-later
import type { Backend, SharedConfig, Store } from '@zenfs/core';
import { StoreFS, Transaction } from '@zenfs/core';
import { log, withErrno } from 'kerium';
import { convertException } from './utils.js';

/** Note a failed request is not prevented from aborting its transaction, so changes stay atomic */
function wrap<T>(request: IDBRequest<T>): Promise<T> {
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(convertException(request.error!));
	return promise;
}

/**
 * A transaction on an IndexedDB store.
 * Changes are kept in the transaction until it is committed, and IndexedDB discards them if it is aborted.
 * Conflicts with other transactions are not detected, so concurrent changes to the same data can be lost.
 * @internal
 */
export class IndexedDBTransaction extends Transaction<IndexedDBStore> {
	private _idb: IDBObjectStore;

	/** Changes made by this transaction, where `undefined` means the key was removed */
	protected readonly changes = new Map<number, Uint8Array | undefined>();

	/** Where this transaction is in the order IndexedDB runs transactions */
	protected readonly id: number;

	/** Settles once IndexedDB has finished the transaction */
	protected readonly finished: Promise<void>;

	protected isFinished = false;

	protected asyncDone: Promise<unknown> = Promise.resolve();

	/**
	 * Run a asynchronous operation from a sync context. Not magic and subject to (race) conditions.
	 * @internal
	 */
	protected async(promise: Promise<unknown>): void {
		this.asyncDone = Promise.all([this.asyncDone, promise]);
		this.asyncDone.catch(() => {});
	}

	public constructor(
		public tx: IDBTransaction,
		public store: IndexedDBStore
	) {
		super(store);
		this._idb = tx.objectStore(store.name);
		this.id = store._nextTxId();

		const { promise, resolve, reject } = Promise.withResolvers<void>();
		tx.oncomplete = () => {
			this.isFinished = true;
			resolve();
		};
		tx.onabort = () => {
			this.isFinished = true;
			reject(tx.error ? convertException(tx.error) : new Error('IndexedDB transaction aborted'));
		};
		this.finished = promise;
		this.finished.catch(() => {});
	}

	public async keys(): Promise<Iterable<number>> {
		return (await wrap(this._idb.getAllKeys())).map(Number);
	}

	public async get(id: number): Promise<Uint8Array | undefined> {
		if (this.changes.has(id)) return this.changes.get(id)?.slice();
		const data: Uint8Array | undefined = await wrap(this._idb.get(id));
		this.store.cacheRead(id, data, this.id);
		return data;
	}

	/** Throws `EAGAIN` and loads the data in the background if it exists but is not cached */
	public getSync(id: number): Uint8Array | undefined {
		if (this.changes.has(id)) return this.changes.get(id)?.slice();

		const cached = this.store.cache.get(id);
		if (cached) return cached.slice();

		if (!this.store.ids.has(id)) return;

		this.store.load(id);
		throw withErrno('EAGAIN');
	}

	public async set(id: number, data: Uint8Array): Promise<void> {
		this.changes.set(id, data.slice());
		await wrap(this._idb.put(data, id));
	}

	public setSync(id: number, data: Uint8Array): void {
		this.async(this.set(id, data));
	}

	public async remove(id: number): Promise<void> {
		this.changes.set(id, undefined);
		await wrap(this._idb.delete(id));
	}

	public removeSync(id: number): void {
		this.async(this.remove(id));
	}

	public async commit(): Promise<void> {
		await this.asyncDone;
		if (!this.isFinished) this.tx.commit();
		await this.finished;
		this.store.apply(this.changes, this.id);
	}

	/** The changes are visible at once, but a failure to commit them can only be logged */
	public commitSync(): void {
		if (!this.isFinished) this.tx.commit();
		this.store.apply(this.changes, this.id);
		this.finished.catch((e: unknown) => log.crit(`IndexedDB: failed to commit ${this.id}: ${String(e)}`));
	}

	public async abort(): Promise<void> {
		await this.asyncDone.catch(() => {});
		this.abortSync();
		await this.finished.catch(() => {});
	}

	public abortSync(): void {
		if (!this.isFinished) this.tx.abort();
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
	public readonly flags = ['atomic'] as const;

	/** Committed data, for synchronous reads */
	public readonly cache = new Map<number, Uint8Array>();

	/** Every key in the database, so data that is not cached can be told apart from data that does not exist */
	public readonly ids = new Set<number>();

	/** For each key, the order of the transaction whose data for it is cached, so older data does not replace newer data */
	protected readonly cachedTxData = new Map<number, number>();

	protected _txId = 0;

	/** Keys being loaded by synchronous reads that were not cached */
	protected readonly loading = new Set<number>();

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

	/**
	 * Transactions on the store are run in the order they are created, which this tracks.
	 * @internal
	 */
	public _nextTxId(): number {
		return this._txId++;
	}

	protected cacheData(id: number, data: Uint8Array | undefined, tx: number): void {
		if ((this.cachedTxData.get(id) ?? -1) > tx) return;
		this.cachedTxData.set(id, tx);
		if (data) {
			this.cache.set(id, data);
			this.ids.add(id);
		} else {
			this.cache.delete(id);
			this.ids.delete(id);
		}
	}

	/**
	 * Caches data read by the transaction at `tx`.
	 * @internal
	 */
	public cacheRead(id: number, data: Uint8Array | undefined, tx: number): void {
		this.cacheData(id, data?.slice(), tx);
	}

	/**
	 * Caches the changes committed by the transaction at `tx`.
	 * @internal
	 */
	public apply(changes: Map<number, Uint8Array | undefined>, tx: number): void {
		for (const [id, data] of changes) this.cacheData(id, data, tx);
	}

	/**
	 * Loads data into the cache in the background, using a separate transaction.
	 * @internal
	 */
	public load(id: number): void {
		if (this.loading.has(id)) return;
		this.loading.add(id);

		const txId = this._nextTxId();
		wrap(this.db.transaction(this.name, 'readonly').objectStore(this.name).get(id))
			.then((data: Uint8Array | undefined) => this.cacheRead(id, data, txId))
			.catch((e: unknown) => log.warn(`IndexedDB: failed to load ${id}: ${String(e)}`))
			.finally(() => this.loading.delete(id));
	}

	/**
	 * Fill the cache with every record, in two requests rather than one per record.
	 * @internal
	 */
	public async preload(): Promise<void> {
		const txId = this._nextTxId();
		const store = this.db.transaction(this.name, 'readonly').objectStore(this.name);
		// Both iterate in ascending key order, so the results line up index for index.
		const [keys, values] = await Promise.all([wrap(store.getAllKeys()), wrap(store.getAll())]);
		for (let i = 0; i < keys.length; i++) this.cacheData(Number(keys[i]), values[i] as Uint8Array | undefined, txId);
	}

	/**
	 * Load every key, without any data.
	 * @internal
	 */
	public async loadKeys(): Promise<void> {
		const keys = await wrap(this.db.transaction(this.name, 'readonly').objectStore(this.name).getAllKeys());
		for (const key of keys) this.ids.add(Number(key));
	}
}

/**
 * Configuration options for the IndexedDB file system.
 */
export interface IndexedDBOptions {
	/**
	 * The name of this file system. You can have multiple IndexedDB file systems operating at once, but each must have a different name.
	 * @todo rename to `label`
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

		const db = await wrap(req);
		// Make sure the test db gets closed so that other zenfs instances in other workers don't get blocked
		db.close();

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
			await store.loadKeys();
			return fs;
		}
		await store.preload();
		return fs;
	},
} as const satisfies Backend<StoreFS<IndexedDBStore>, IndexedDBOptions>;
type _IndexedDB = typeof _IndexedDB;
export interface IndexedDB extends _IndexedDB {}
export const IndexedDB: IndexedDB = _IndexedDB;
