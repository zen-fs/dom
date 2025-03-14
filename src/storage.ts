import type { Backend, Store, SyncMapStore } from '@zenfs/core';
import { Errno, ErrnoError, StoreFS, SyncMapTransaction } from '@zenfs/core';
import { decodeASCII, encodeASCII } from 'utilium';

/**
 * A synchronous key-value store backed by Storage.
 */
export class WebStorageStore implements Store, SyncMapStore {
	public get name(): string {
		return WebStorage.name;
	}

	public constructor(protected storage: Storage) {}

	/* node:coverage ignore next 10 */
	public clear(): void {
		this.storage.clear();
	}

	public clearSync(): void {
		this.storage.clear();
	}

	public async sync(): Promise<void> {}

	public transaction(): SyncMapTransaction {
		return new SyncMapTransaction(this);
	}

	public keys(): Iterable<number> {
		return Object.keys(this.storage).map(k => Number(k));
	}

	public get(key: number): Uint8Array | undefined {
		const data = this.storage.getItem(key.toString());
		if (typeof data != 'string') {
			return;
		}

		return encodeASCII(data);
	}

	public set(key: number, data: Uint8Array): void {
		try {
			this.storage.setItem(key.toString(), decodeASCII(data));
		} catch {
			throw new ErrnoError(Errno.ENOSPC, 'Storage is full.');
		}
	}

	public delete(key: number): void {
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
		storage: { type: 'object', required: false },
	},

	/**
	 * @todo Consider replacing `instanceof` with a duck-typing check?
	 */
	isAvailable(config?: WebStorageOptions): boolean {
		return (config?.storage ?? globalThis.localStorage) instanceof globalThis.Storage;
	},

	create({ storage = globalThis.localStorage }: WebStorageOptions) {
		return new StoreFS(new WebStorageStore(storage));
	},
} as const satisfies Backend<StoreFS, WebStorageOptions>;
type _WebStorage = typeof _WebStorage;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WebStorage extends _WebStorage {}
export const WebStorage: WebStorage = _WebStorage;
