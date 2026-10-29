import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { findInTrash, readTrash, Trash, UnknownTrashItemError } from '../../../src/library/trash.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} trash */
async function setup(trash) {
	const tree = await createTmpTree({ '.soundboard': '{"version":1}', '.trash': trash });
	trees.push(tree);
	return tree.root;
}

describe('readTrash', () => {
	it('lists root audio files as sounds and folders as playlists with tracks at any depth', async () => {
		const root = await setup({
			'Rain.mp3': 'rain',
			'Boom.ogg': 'boom',
			'Boom.ogg.json': JSON.stringify({ title: 'Big Boom' }),
			'Combat': { 'b.mp3': 'b', 'a.mp3': 'a', 'Boss': { '1.mp3': '1' } },
			'Combat.json': JSON.stringify({ title: 'Fights' }),
		});
		const listing = await readTrash(root);
		assert.deepEqual(listing.sounds.map(({ id, title }) => ({ id, title })), [
			{ id: 'Boom.ogg', title: 'Big Boom' },
			{ id: 'Rain.mp3', title: 'Rain.mp3' },
		]);
		assert.deepEqual(listing.playlists.map(({ id, title, tracks }) => ({ id, title, tracks: tracks.map((track) => track.id) })), [
			{ id: 'Combat', title: 'Fights', tracks: ['Combat/a.mp3', 'Combat/b.mp3', 'Combat/Boss/1.mp3'] },
		]);
	});

	it('names a playlist after its folder when it has no options file', async () => {
		const root = await setup({ Tavern: { 'song.mp3': 'song' } });
		assert.equal((await readTrash(root)).playlists[0].title, 'Tavern');
	});

	it('counts every file toward the size, listed or not', async () => {
		const root = await setup({
			'Rain.mp3': 'rain',
			'Rain.mp3.json': '{}',
			'Rain.mp3.wf': 'wf',
			'.DS_Store': 'xx',
			'Combat': { 'a.mp3': 'aaa', 'cover.jpg': 'jpeg' },
			'Combat.json': '{"title":"Combat"}',
		});
		const listing = await readTrash(root);
		assert.equal(listing.size, 4 + 2 + 2 + 2 + 3 + 4 + 18);
		assert.equal(listing.sounds[0].size, 4 + 2 + 2);
		assert.equal(listing.playlists[0].size, 3 + 4 + 18);
	});

	it('leaves out folders without audio and dot files, and survives broken options files', async () => {
		const root = await setup({
			'Artwork': { 'cover.jpg': 'jpeg' },
			'.hidden.mp3': 'x',
			'Rain.mp3': 'rain',
			'Rain.mp3.json': '{ not json',
		});
		const listing = await readTrash(root);
		assert.deepEqual(listing.playlists, []);
		assert.deepEqual(listing.sounds.map((sound) => sound.title), ['Rain.mp3']);
	});

	it('reads a missing trash as empty', async () => {
		const tree = await createTmpTree({ '.soundboard': '{"version":1}' });
		trees.push(tree);
		assert.deepEqual(await readTrash(tree.root), { size: 0, playlists: [], sounds: [] });
	});
});

describe('findInTrash', () => {
	it('finds only what the trash holds, by kind', async () => {
		const listing = await readTrash(await setup({ 'Rain.mp3': 'rain', 'Combat': { 'a.mp3': 'a' } }));
		assert.equal(findInTrash(listing, { kind: 'track', id: 'Combat/a.mp3' }).id, 'Combat/a.mp3');
		assert.throws(() => findInTrash(listing, { kind: 'sound', id: 'Combat/a.mp3' }), UnknownTrashItemError);
		assert.throws(() => findInTrash(listing, { kind: 'sound', id: '../.soundboard' }), UnknownTrashItemError);
	});
});

describe('Trash', () => {
	it('tells its listeners when the summary changes, and only then', async () => {
		const root = await setup({ 'Rain.mp3': 'rain', 'Combat': { 'a.mp3': 'a' } });
		const trash = new Trash(root);
		/** @type {import('../../../src/library/trash.js').TrashSummary[]} */
		const heard = [];
		trash.onChange((summary) => heard.push(summary));
		await trash.reload();
		await trash.reload();
		await rm(join(root, '.trash', 'Rain.mp3'));
		await trash.reload();
		assert.deepEqual(heard, [{ size: 5, count: 2 }, { size: 1, count: 1 }]);
		assert.deepEqual(trash.summary, { size: 1, count: 1 });
	});
});
