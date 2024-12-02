import * as fsAccess from 'file-system-access';
import adapter from 'file-system-access/lib/adapters/memory.js';
Object.assign(globalThis, fsAccess);

import { configureSingle } from '@zenfs/core';
import { WebAccess } from '../src/access.js';
import { copy, data } from '@zenfs/core/tests/setup.js';

await configureSingle({
	backend: WebAccess,
	handle: await fsAccess.getOriginPrivateDirectory(adapter),
});

copy(data);
