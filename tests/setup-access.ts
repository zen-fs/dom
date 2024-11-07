import * as fsAccess from 'file-system-access';
import adapter from 'file-system-access/lib/adapters/memory.js';
Object.assign(globalThis, fsAccess);

import { fs, configureSingle } from '@zenfs/core';
import { WebAccess } from '../src/access.js';
import { copy, data } from '@zenfs/core/tests/setup/common.js';

await configureSingle({
	backend: WebAccess,
	handle: await fsAccess.getOriginPrivateDirectory(adapter),
});

copy(data);
const wfs = fs.mounts.get('/')!;
// @ts-expect-error 2339
await wfs.crossCopy('/');
// @ts-expect-error 2339
await wfs.queueDone();

await wfs.ready();
