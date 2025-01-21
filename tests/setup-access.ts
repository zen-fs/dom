import { configureSingle } from '@zenfs/core';
import { copy, data } from '@zenfs/core/tests/setup.js';
import { WebAccess } from '../src/access.js';
import { handle } from './web-access.js';

await configureSingle({ backend: WebAccess, handle });

await copy(data);
