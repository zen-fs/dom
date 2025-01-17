import { configureSingle, mounts } from '@zenfs/core';
import { copy, data } from '@zenfs/core/tests/setup.js';
import { WebAccess, type WebAccessFS } from '../src/access.js';
import { handle } from './web-access.js';

await configureSingle({ backend: WebAccess, handle });

copy(data);

await (mounts.get('/') as WebAccessFS).queueDone();
