import { configureSingle } from '@zenfs/core';
import { copyAsync, copySync, data } from '@zenfs/core/tests/setup.js';
import { WebAccess } from '../src/access.js';
import { handle } from './web-access.js';

await configureSingle({ backend: WebAccess, handle });

copySync(data);
await copyAsync(data);
