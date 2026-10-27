import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readTitle } from '../../../src/metadata/index.js';
import { buildId3v2, buildOgg, textFrame } from '../../helpers/tag-builders.js';
import { createTmpTree, FIXTURES_DIR } from '../../helpers/tmp-tree.js';

describe('readTitle', () => {
	/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
	let tree;
	before(async () => {
		const id3 = buildId3v2({ frames: [textFrame('TIT2', 'From ID3')] });
		const ogg = buildOgg({ comments: ['TITLE=From Ogg'] });
		tree = await createTmpTree({
			'a.mp3': id3,
			'b.MP3': id3,
			'c.ogg': ogg,
			'd.OGG': ogg,
			'ogg-in-disguise.mp3': ogg,
			'e.wav': id3,
		});
	});
	after(() => tree.remove());

	it('picks the parser by extension, case-insensitively', async () => {
		assert.equal(await readTitle(join(tree.root, 'a.mp3')), 'From ID3');
		assert.equal(await readTitle(join(tree.root, 'b.MP3')), 'From ID3');
		assert.equal(await readTitle(join(tree.root, 'c.ogg')), 'From Ogg');
		assert.equal(await readTitle(join(tree.root, 'd.OGG')), 'From Ogg');
	});

	it('trusts the extension over the content', async () => {
		assert.equal(await readTitle(join(tree.root, 'ogg-in-disguise.mp3')), null);
	});

	it('returns null for unsupported extensions', async () => {
		assert.equal(await readTitle(join(tree.root, 'e.wav')), null);
	});

	it('propagates file system errors', async () => {
		await assert.rejects(readTitle(join(tree.root, 'missing.mp3')), { code: 'ENOENT' });
	});

	describe('example soundboard fixture', () => {
		const root = join(FIXTURES_DIR, 'example_soundboard');
		/** @type {[string, string | null][]} */
		const expected = [
			['Sound MP3 with title tag.mp3', 'Base Connected'],
			['Sound MP3 no title tag.mp3', null],
			['Sound OGG with title tag.ogg', 'Cluster Unlock'],
			['Sound OGG no title tag.ogg', null],
			['Music MP3/Song 1 MP3 with title tag.mp3', 'Piece by Piece'],
			['Music MP3/Song 2 MP3 with title tag.mp3', 'Intro'],
			['Music Ogg/Song 1 OGG with title tag.ogg', 'Piece by Piece'],
			['Music Ogg/Song 2 OGG with title tag.ogg', 'Intro'],
			['Music Mix/Song 1 MP3 with title tag.mp3', 'Piece by Piece'],
			['Music Mix/Song 2 OGG with title tag.ogg', 'Intro'],
			...[1, 2, 3, 4, 5, 6].map((n) => /** @type {[string, string]} */ ([`Music Order/Order ${n}.mp3`, `Order ${n}`])),
		];
		for (const [file, title] of expected) {
			it(`reads ${JSON.stringify(title)} from ${file}`, async () => {
				assert.equal(await readTitle(join(root, file)), title);
			});
		}
	});
});
