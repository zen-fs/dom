import 'fake-indexeddb/auto';

import { configureSingle } from '@zenfs/core';
import { IndexedDB } from '../src/IndexedDB.js';
import { copy, data } from '@zenfs/core/tests/setup.js';

await configureSingle({
	backend: IndexedDB,
	storeName: 'test',
});

copy(data);

/**
 * @todo Actually fix whatever is preventing the process from exiting
 */
setTimeout(() => {
	indexedDB.deleteDatabase('test');
	process.exit(0);
}, 5_000);
