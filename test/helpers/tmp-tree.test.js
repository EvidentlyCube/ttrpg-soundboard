import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { copyFixture, createTmpTree, FIXTURES_DIR } from './tmp-tree.js';

describe('createTmpTree', () => {
	it('creates nested directories with text and binary files', async () => {
		const tree = await createTmpTree({
			'Explosion.mp3': new Uint8Array([1, 2, 3]),
			'Explosion.mp3.json': '{ "title": "Boom" }',
			'Combat': {
				Boss: {
					'Phase 1.ogg': 'audio',
				},
			},
			'Empty': {},
		});
		try {
			assert.deepEqual(await readFile(join(tree.root, 'Explosion.mp3')), Buffer.from([1, 2, 3]));
			assert.equal(await readFile(join(tree.root, 'Explosion.mp3.json'), 'utf8'), '{ "title": "Boom" }');
			assert.equal(await readFile(join(tree.root, 'Combat', 'Boss', 'Phase 1.ogg'), 'utf8'), 'audio');
			assert.deepEqual(await readdir(join(tree.root, 'Empty')), []);
		} finally {
			await tree.remove();
		}
	});

	it('removes the whole tree', async () => {
		const tree = await createTmpTree({ a: { 'b.mp3': '' } });
		await tree.remove();
		await assert.rejects(stat(tree.root), { code: 'ENOENT' });
	});
});

describe('copyFixture', () => {
	it('copies a fixture into a fresh temp directory', async () => {
		const copy = await copyFixture('example_soundboard');
		try {
			assert.notEqual(copy.root, join(FIXTURES_DIR, 'example_soundboard'));
			assert.deepEqual(
				(await readdir(copy.root)).sort(),
				(await readdir(join(FIXTURES_DIR, 'example_soundboard'))).sort(),
			);
		} finally {
			await copy.remove();
		}
	});
});
