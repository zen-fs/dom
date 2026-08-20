import { configureSingle, sync } from '@zenfs/core';
import type { TestFlag, TestFlagState } from '@zenfs/core/tests/common.ts';
import { copyAsync, data } from '@zenfs/core/tests/setup.ts';
import { afterEach } from 'node:test';
import { WebAccess } from '@zenfs/dom/access.js';
import { handle } from './web-access.ts';

await configureSingle({ backend: WebAccess, handle });
await copyAsync(data);

afterEach(sync);

export const flags: Partial<Record<TestFlag, TestFlagState>> = {
	// The File System Access API has no concept of hard links
	links: false,
};
