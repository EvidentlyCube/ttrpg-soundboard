import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HIDDEN_REASON, NO_AUDIO_REASON, OUTSIDE_REASON } from '../../../src/startup/folder-rules.js';
import { FolderNotAllowedError, FolderUnreadableError, listFolder, startingPlaces } from '../../../src/startup/folders.js';
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
				{ name: 'board', path: join(root, 'board'), soundboard: true, refused: null },
				{ name: 'Track 9', path: join(root, 'Track 9'), soundboard: false, refused: null },
				{ name: 'Track 10', path: join(root, 'Track 10'), soundboard: false, refused: null },
			],
			audioFiles: 2,
			soundboard: false,
			allowed: true,
			reason: null,
		});
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
