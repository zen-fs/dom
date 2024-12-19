import { configureSingle } from '@zenfs/core';
import { WebStorage } from '../src/storage.js';
import { copy, data } from '@zenfs/core/tests/setup.js';

const storage = {
	_: new Map<string, string>(),

	get length(): number {
		return this._.size;
	},

	clear(): void {
		this._.clear();
	},

	getItem(key: string): string | null {
		return this._.get(key) ?? null;
	},

	key(index: number): string | null {
		return Array.from(this._.keys())[index];
	},

	removeItem(key: string): void {
		this._.delete(key);
	},

	setItem(key: string, value: string): void {
		this._.set(key, value);
	},
};

// @ts-expect-error 2322
globalThis.Storage = Object; // Bypass `instanceof` check in `WebStorage` is available
globalThis.localStorage = storage;

await configureSingle({ backend: WebStorage, storage });

copy(data);
