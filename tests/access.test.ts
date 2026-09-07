// SPDX-License-Identifier: LGPL-3.0-or-later
import { configureSingle, fs, resolveMountConfig } from '@zenfs/core';
import { WebAccess } from '@zenfs/dom/access.js';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { handle, setOpenFileLimit } from './web-access.js';

await configureSingle({ backend: WebAccess, handle });

async function contents(name: string): Promise<number[]> {
	const file = await handle.getFileHandle(name).then(handle => handle.getFile());
	return Array.from(new Uint8Array(await file.arrayBuffer()));
}

suite('WebAccess', () => {
	test('overwriting a file with less data shrinks it #42', async () => {
		await fs.promises.writeFile('/shrink.bin', new Uint8Array(1024).fill(0xff));
		await fs.promises.writeFile('/shrink.bin', new Uint8Array(8).fill(1));

		const { size } = await fs.promises.stat('/shrink.bin');
		assert.equal(size, 8);

		assert.deepEqual(await contents('shrink.bin'), Array(8).fill(1));
	});

	test('truncate resizes the file itself', async () => {
		await fs.promises.writeFile('/truncate.bin', new Uint8Array([1, 2, 3, 4]));

		await fs.promises.truncate('/truncate.bin', 2);
		assert.deepEqual(await contents('truncate.bin'), [1, 2]);

		await fs.promises.truncate('/truncate.bin', 5);
		assert.deepEqual(await contents('truncate.bin'), [1, 2, 0, 0, 0]);
		assert.deepEqual(Array.from(await fs.promises.readFile('/truncate.bin')), [1, 2, 0, 0, 0]);
	});

	test('writing at an offset keeps the rest of the file', async () => {
		await fs.promises.writeFile('/offset.bin', new Uint8Array([1, 2, 3, 4, 5, 6]));

		const file = await fs.promises.open('/offset.bin', 'r+');
		await file.write(new Uint8Array([9, 9]), 0, 2, 2);
		await file.close();

		assert.deepEqual(await contents('offset.bin'), [1, 2, 9, 9, 5, 6]);

		await fs.promises.appendFile('/offset.bin', new Uint8Array([7]));
		assert.deepEqual(await contents('offset.bin'), [1, 2, 9, 9, 5, 6, 7]);
	});

	test('empty files should work #45', async () => {
		await fs.promises.writeFile('/empty.txt', '');

		assert.partialDeepStrictEqual(await fs.promises.stat('/empty.txt'), { size: 0 });
		assert.partialDeepStrictEqual(await fs.promises.readdir('/'), ['empty.txt']);
		await assert.doesNotReject(handle.getFileHandle('empty.txt'));
	});

	test('crossCopy should not fail with a large number of files @zenfs/core#318', async () => {
		const ccDir = await handle.getDirectoryHandle('zenfs-static-preload', { create: true });
		for (let i = 0; i < 512; i++) {
			const dir = await ccDir.getDirectoryHandle(`d${Math.floor(i / 128)}`, { create: true });
			const file = await dir.getFileHandle(`f${i}`, { create: true });
			const writer = await file.createWritable();
			await writer.write('A');
			await writer.close();
		}

		setOpenFileLimit(256);

		await assert.doesNotReject(resolveMountConfig({ backend: WebAccess, handle: ccDir }));

		setOpenFileLimit(Infinity);
	});
});
