import 'fake-indexeddb/auto';

import { configureSingle } from '@zenfs/core';
import { copyAsync, data } from '@zenfs/devel/tests/setup';
import { after } from 'node:test';
import { IndexedDB } from '@zenfs/dom/IndexedDB';

await configureSingle({ backend: IndexedDB, storeName: 'test' });
await copyAsync(data);

after(() => {
	indexedDB.deleteDatabase('test');

	/**
	 * @todo Actually fix whatever is preventing the process from exiting
	 */
	// @ts-expect-error 2339
	for (const handle of process._getActiveHandles()) handle.unref();
});
