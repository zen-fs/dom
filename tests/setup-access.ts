import { configureSingle, sync } from '@zenfs/core';
import type { TestFlag, TestFlagState } from '@zenfs/devel/tests/common';
import { copyAsync, data } from '@zenfs/devel/tests/setup';
import { afterEach } from 'node:test';
import { WebAccess } from '@zenfs/dom/access';
import { handle } from './web-access.ts';

await configureSingle({ backend: WebAccess, handle });
await copyAsync(data);

afterEach(sync);

export const flags: Partial<Record<TestFlag, TestFlagState>> = {
	// The File System Access API has no concept of hard links
	links: false,
};
