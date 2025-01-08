import { handle } from './web-access.js';
import { configureSingle } from '@zenfs/core';
import { WebAccess } from '../src/access.js';
import { copy, data } from '@zenfs/core/tests/setup.js';

await configureSingle({
	backend: WebAccess,
	handle,
});

copy(data);
