import { configureSingle, sync } from '@zenfs/core';
import type { TestFlag, TestFlagState } from '@zenfs/core/tests/common';
import { copyAsync, data } from '@zenfs/core/tests/setup';
import { afterEach } from 'node:test';
import { WebAccess } from '../src/access.js';
import { handle } from './web-access.js';

await configureSingle({ backend: WebAccess, handle });
await copyAsync(data);

afterEach(sync);

export const flags: Partial<Record<TestFlag, TestFlagState>> = {
	// The File System Access API has no concept of hard links
	links: false,
};
