import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BinaryReader, BufferReader } from '../../../src/metadata/binary-reader.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

const BYTES = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
let tree;
before(async () => {
	tree = await createTmpTree({ 'data.bin': BYTES });
});
after(() => tree.remove());

/** @type {[string, () => Promise<BinaryReader | BufferReader>][]} */
const implementations = [
	['BinaryReader', () => BinaryReader.open(join(tree.root, 'data.bin'))],
	['BufferReader', async () => new BufferReader(BYTES)],
];

for (const [name, create] of implementations) {
	describe(name, () => {
		it('reports the size', async () => {
			const reader = await create();
			assert.equal(reader.size, 10);
			await reader.close();
		});

		it('reads a range', async () => {
			const reader = await create();
			assert.deepEqual(await reader.read(2, 3), Buffer.from([2, 3, 4]));
			await reader.close();
		});

		it('returns fewer bytes when the range runs past the end', async () => {
			const reader = await create();
			assert.deepEqual(await reader.read(8, 5), Buffer.from([8, 9]));
			await reader.close();
		});

		it('returns no bytes for a range outside the data', async () => {
			const reader = await create();
			assert.equal((await reader.read(10, 4)).length, 0);
			assert.equal((await reader.read(-1, 4)).length, 0);
			assert.equal((await reader.read(3, 0)).length, 0);
			await reader.close();
		});
	});
}
