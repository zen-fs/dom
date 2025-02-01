import 'fake-indexeddb/auto';

import { configureSingle } from '@zenfs/core';
import { IndexedDB } from '../src/IndexedDB.js';
import { copyAsync, data } from '@zenfs/core/tests/setup.js';

await configureSingle({ backend: IndexedDB, storeName: 'test' });

await copyAsync(data);

/**
 * @todo Actually fix whatever is preventing the process from exiting
 */
setTimeout(() => {
	indexedDB.deleteDatabase('test');
	process.exit(0);
}, 5_000);
