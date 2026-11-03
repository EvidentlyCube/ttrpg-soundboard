import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HIDDEN_REASON, HOLDS_SOUNDBOARD_REASON, NO_AUDIO_REASON, OUTSIDE_REASON } from '../../../src/startup/folder-rules.js';
import { displayName, FolderNotAllowedError, FolderUnreadableError, listFolder, MAX_SEARCHED_FOLDERS, startingPlaces } from '../../../src/startup/folders.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @typedef {import('../../../src/startup/folder-rules.js').Platform} Platform */

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} spec */
async function tree(spec) {
	const created = await createTmpTree(spec);
	trees.push(created);
	return realpath(created.root);
}

/**
 * @param {string} root
 * @param {Partial<Platform>} [changes]
 * @returns {Platform}
 */
function platformFor(root, changes = {}) {
	return { name: 'linux', home: '/nowhere', roots: [root], allowHidden: false, ...changes };
}

describe('listFolder', () => {
	it('lists the subfolders by name with numbers in order, marks soundboards, and counts the audio files', async () => {
		const root = await tree({
			'Track 10': { 'a.mp3': '' },
			'Track 9': {},
			'board': { '.soundboard': '{}' },
			'Boom.mp3': '',
			'Rain.ogg': '',
			'notes.txt': '',
		});
		const listing = await listFolder(root, platformFor(root));
		assert.deepEqual(listing, {
			path: root,
			parent: dirname(root),
			folders: [
				{ name: 'board', title: null, path: join(root, 'board'), soundboard: true, holdsSoundboard: false, refused: null },
				{ name: 'Track 9', title: null, path: join(root, 'Track 9'), soundboard: false, holdsSoundboard: false, refused: null },
				{ name: 'Track 10', title: null, path: join(root, 'Track 10'), soundboard: false, holdsSoundboard: false, refused: null },
			],
			audioFiles: 2,
			files: ['Boom.mp3', 'Rain.ogg'],
			soundboard: false,
			allowed: false,
			reason: HOLDS_SOUNDBOARD_REASON,
		});
	});

	it('gives a soundboard’s own name as its title, and none for a broken or nameless one', async () => {
		const root = await tree({
			named: { '.soundboard': JSON.stringify({ version: 1, name: ' Tavern ' }) },
			broken: { '.soundboard': '{ nope' },
			blank: { '.soundboard': JSON.stringify({ version: 1, name: '' }) },
		});
		const listing = await listFolder(root, platformFor(root));
		assert.deepEqual(listing.folders.map((folder) => [folder.name, folder.title, folder.soundboard]), [
			['blank', null, true],
			['broken', null, true],
			['named', 'Tavern', true],
		]);
		assert.equal(await displayName(join(root, 'named')), 'Tavern');
		assert.equal(await displayName(join(root, 'broken')), 'broken');
	});

	it('lists the audio files by name, numbers in order, without dot files', async () => {
		const root = await tree({ 'Track 10.mp3': '', 'Track 9.ogg': '', '._Track 9.ogg': '', 'notes.txt': '' });
		const listing = await listFolder(root, platformFor(root));
		assert.deepEqual(listing.files, ['Track 9.ogg', 'Track 10.mp3']);
		assert.equal(listing.audioFiles, 2);
	});

	it('marks folders with a soundboard up to three levels inside, skipping hidden and tool folders', async () => {
		const board = { '.soundboard': '{}' };
		const root = await tree({
			one: { a: board },
			three: { a: { b: { c: board } } },
			four: { a: { b: { c: { d: board } } } },
			hidden: { '.a': board },
			tools: { node_modules: board, a: { __pycache__: board } },
			plain: { a: {} },
			own: board,
		});
		const listing = await listFolder(root, platformFor(root));
		const marked = Object.fromEntries(listing.folders.map((folder) => [folder.name, folder.holdsSoundboard]));
		assert.deepEqual(marked, { four: false, hidden: false, one: true, own: false, plain: false, three: true, tools: false });
		const withHidden = await listFolder(root, platformFor(root, { allowHidden: true }));
		assert.equal(withHidden.folders.find((folder) => folder.name === 'hidden')?.holdsSoundboard, true);
	});

	it(`stops looking after reading ${MAX_SEARCHED_FOLDERS} folders, a level at a time`, async () => {
		/** @type {import('../../helpers/tmp-tree.js').TreeSpec} */
		const wide = {};
		for (let index = 0; index < MAX_SEARCHED_FOLDERS; index++) {
			wide[`f${index}`] = {};
		}
		// The three listed folders take 3 reads; on the next level `a/b` comes first and is found, and the budget runs
		// out among wide's folders before `z/inside` is reached, though it is as shallow as `a/b`.
		const root = await tree({ a: { b: { '.soundboard': '{}' } }, wide, z: { inside: { '.soundboard': '{}' } } });
		const listing = await listFolder(root, platformFor(root));
		const marked = Object.fromEntries(listing.folders.map((folder) => [folder.name, folder.holdsSoundboard]));
		assert.deepEqual(marked, { a: true, wide: false, z: false });
	});

	it('leaves hidden folders out unless they are allowed, and says when the folder itself can’t be opened', async () => {
		const root = await tree({ '.hidden': {}, 'empty': {} });
		const hiddenLeftOut = await listFolder(root, platformFor(root));
		assert.deepEqual(hiddenLeftOut.folders.map((folder) => folder.name), ['empty']);
		const withHidden = await listFolder(root, platformFor(root, { allowHidden: true }));
		assert.deepEqual(withHidden.folders.map((folder) => folder.name), ['.hidden', 'empty']);
		const empty = await listFolder(join(root, 'empty'), platformFor(root));
		assert.equal(empty.allowed, false);
		assert.equal(empty.reason, NO_AUDIO_REASON);
	});

	it('lists a symbolic link to a folder as a folder, and marks one that leads out of the roots', async () => {
		const outside = await tree({ 'Boom.mp3': '' });
		const root = await tree({ inside: {} });
		await symlink(outside, join(root, 'escape'));
		const listing = await listFolder(root, platformFor(root));
		assert.deepEqual(listing.folders.map((folder) => folder.name), ['escape', 'inside']);
		// Judged by its path; going into it is refused once the link is resolved.
		await assert.rejects(listFolder(join(root, 'escape'), platformFor(root)), new FolderNotAllowedError(OUTSIDE_REASON));
	});

	it('refuses folders outside the roots, the parent of a root, and hidden ones', async () => {
		const root = await tree({ '.hidden': {} });
		await assert.rejects(listFolder(dirname(root), platformFor(root)), new FolderNotAllowedError(OUTSIDE_REASON));
		await assert.rejects(listFolder(join(root, '.hidden'), platformFor(root)), new FolderNotAllowedError(HIDDEN_REASON));
	});

	it('fails for a folder that doesn’t exist', async () => {
		const root = await tree({});
		await assert.rejects(listFolder(join(root, 'missing'), platformFor(root)), FolderUnreadableError);
	});

	it('gives no parent at the top of the disk', async () => {
		const listing = await listFolder('/', platformFor('/'));
		assert.equal(listing.parent, null);
	});
});

describe('startingPlaces', () => {
	it('lists each root, the home folder as Home, then the home’s usual media folders that exist and are allowed', async () => {
		const existing = new Set(['/home/ana', '/mnt/sfx', '/home/ana/Music', '/home/ana/Downloads']);
		const places = await startingPlaces(
			{ name: 'linux', home: '/home/ana', roots: ['/home/ana', '/mnt/sfx', '/gone'], allowHidden: false },
			{ exists: async (path) => existing.has(path) },
		);
		assert.deepEqual(places, [
			{ name: 'Home', path: '/home/ana' },
			{ name: 'sfx', path: '/mnt/sfx' },
			{ name: 'Music', path: '/home/ana/Music' },
			{ name: 'Downloads', path: '/home/ana/Downloads' },
		]);
	});

	it('leaves out the home’s folders when the home folder isn’t a root, and names a root that is a whole disk', async () => {
		const places = await startingPlaces(
			{ name: 'linux', home: '/home/ana', roots: ['/'], allowHidden: false },
			{ exists: async (path) => path === '/' || path === '/home/ana/Music' },
		);
		assert.deepEqual(places, [{ name: '/', path: '/' }, { name: 'Music', path: '/home/ana/Music' }]);
		const narrow = await startingPlaces(
			{ name: 'linux', home: '/home/ana', roots: ['/mnt/sfx'], allowHidden: false },
			{ exists: async () => true },
		);
		assert.deepEqual(narrow, [{ name: 'sfx', path: '/mnt/sfx' }]);
	});
});
