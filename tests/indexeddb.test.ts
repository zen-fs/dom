// SPDX-License-Identifier: LGPL-3.0-or-later
import 'fake-indexeddb/auto';

import { configureSingle, fs } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom/IndexedDB.js';
import assert from 'node:assert/strict';
import { after, suite, test } from 'node:test';

after(() => indexedDB.deleteDatabase('preload'));

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
});
