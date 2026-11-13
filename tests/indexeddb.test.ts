// SPDX-License-Identifier: LGPL-3.0-or-later
import 'fake-indexeddb/auto';

import { configureSingle, fs, mounts, type StoreFS } from '@zenfs/core';
import { IndexedDB, type IndexedDBStore } from '@zenfs/dom/IndexedDB.js';
import assert from 'node:assert/strict';
import { after, suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { setTimeout } from 'node:timers/promises';

after(() => {
	for (const name of ['preload', 'lazy', 'abort', 'order']) indexedDB.deleteDatabase(name);
});

function mountedStore(): IndexedDBStore {
	return (mounts.get('/') as StoreFS<IndexedDBStore>)['store'];
}

suite('IndexedDB', () => {
	test('reopening a store preloads every record', async () => {
		await configureSingle({ backend: IndexedDB, storeName: 'preload' });
		await fs.promises.mkdir('/dir');

		const written = new Map<string, number[]>();
		for (let i = 0; i < 64; i++) {
			const contents = Array.from<number>({ length: 1 + ((i * 37) % 512) }).fill(i);
			await fs.promises.writeFile(`/dir/file${i}`, new Uint8Array(contents));
			written.set(`/dir/file${i}`, contents);
		}
		await fs.promises.writeFile('/dir/empty', new Uint8Array());

		// Reading synchronously only works if create() filled the cache.
		await configureSingle({ backend: IndexedDB, storeName: 'preload' });
		for (const [path, contents] of written) assert.deepEqual(Array.from(fs.readFileSync(path)), contents);
		assert.deepEqual(Array.from(fs.readFileSync('/dir/empty')), []);
	});

	test('data that is not cached is loaded instead of treated as missing', async () => {
		await configureSingle({ backend: IndexedDB, storeName: 'lazy' });
		await fs.promises.writeFile('/file.txt', 'hello world');
		await fs.promises.writeFile('/doomed.txt', 'bye');

		await configureSingle({ backend: IndexedDB, storeName: 'lazy', disableAsyncCache: true });
		const sfs = mounts.get('/') as StoreFS<IndexedDBStore>;

		assert.throws(() => fs.readFileSync('/file.txt', 'utf8'), { code: 'EAGAIN' });
		assert.throws(() => sfs.writeSync('/file.txt', encodeUTF8('X'), 0), { code: 'EAGAIN' });
		await setTimeout(50);
		sfs.writeSync('/file.txt', encodeUTF8('X'), 0);
		assert.equal(fs.readFileSync('/file.txt', 'utf8'), 'Xello world');

		fs.unlinkSync('/doomed.txt');
		assert.deepEqual(fs.readdirSync('/'), ['file.txt']);
		await setTimeout(50);

		await configureSingle({ backend: IndexedDB, storeName: 'lazy' });
		assert.deepEqual(fs.readdirSync('/'), ['file.txt']);
		assert.equal(fs.readFileSync('/file.txt', 'utf8'), 'Xello world');
	});

	test('aborted transactions change neither the cache nor the database', async () => {
		await configureSingle({ backend: IndexedDB, storeName: 'abort' });
		const store = mountedStore();
		const ino = fs.statSync('/').ino;
		const original = store.cache.get(ino)!.slice();

		const tx = store.transaction();
		tx.setSync(ino, encodeUTF8('replacement'));
		tx.removeSync(ino + 1);
		tx.abortSync();
		await setTimeout(50);

		assert.deepEqual(store.cache.get(ino), original);
		await configureSingle({ backend: IndexedDB, storeName: 'abort' });
		assert.deepEqual(mountedStore().cache.get(ino), original);
		assert.deepEqual(fs.readdirSync('/'), []);
	});

	test('a transaction that commits later does not replace newer cached data', async () => {
		await configureSingle({ backend: IndexedDB, storeName: 'order' });
		const store = mountedStore();

		const older = store.transaction();
		const newer = store.transaction();
		newer.setSync(1000, encodeUTF8('newer'));
		newer.commitSync();
		older.setSync(1000, encodeUTF8('older'));
		await older.commit();
		await setTimeout(50);

		assert.deepEqual(store.cache.get(1000), encodeUTF8('newer'));
		await configureSingle({ backend: IndexedDB, storeName: 'order' });
		assert.deepEqual(mountedStore().cache.get(1000), encodeUTF8('newer'));
	});
});
