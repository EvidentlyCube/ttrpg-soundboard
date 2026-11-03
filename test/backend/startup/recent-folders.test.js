import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configFolder, MAX_RECENT, RecentFolders } from '../../../src/startup/recent-folders.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} spec */
async function tree(spec) {
	const created = await createTmpTree(spec);
	trees.push(created);
	return created.root;
}

describe('configFolder', () => {
	it('follows each platform’s convention', () => {
		assert.equal(configFolder({ name: 'win32', home: 'C:\\Users\\ana' }, { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }), join('C:\\Users\\ana\\AppData\\Roaming', 'Soundboard'));
		assert.equal(configFolder({ name: 'win32', home: 'C:\\Users\\ana' }, {}), join('C:\\Users\\ana', 'AppData', 'Roaming', 'Soundboard'));
		assert.equal(configFolder({ name: 'darwin', home: '/Users/ana' }, {}), '/Users/ana/Library/Application Support/Soundboard');
		assert.equal(configFolder({ name: 'linux', home: '/home/ana' }, { XDG_CONFIG_HOME: '/home/ana/.cfg' }), '/home/ana/.cfg/soundboard');
		assert.equal(configFolder({ name: 'linux', home: '/home/ana' }, { XDG_CONFIG_HOME: '' }), '/home/ana/.config/soundboard');
	});
});

describe('RecentFolders', () => {
	it('starts empty, creates its folder on the first write, and keeps the newest first without repeats', async () => {
		const root = await tree({ a: {}, b: {} });
		const file = join(root, 'config', 'soundboard', 'recent.json');
		const recent = new RecentFolders(file);
		assert.deepEqual(await recent.list(), []);
		await recent.add(join(root, 'a'));
		await recent.add(join(root, 'b'));
		await recent.add(join(root, 'a'));
		assert.deepEqual(await recent.list(), [{ path: join(root, 'a'), exists: true }, { path: join(root, 'b'), exists: true }]);
		assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { recent: [join(root, 'a'), join(root, 'b')] });
	});

	it(`keeps only the last ${MAX_RECENT}`, async () => {
		const root = await tree({});
		const recent = new RecentFolders(join(root, 'recent.json'));
		for (let index = 1; index <= MAX_RECENT + 2; index++) {
			await recent.add(`/folder/${index}`);
		}
		assert.deepEqual((await recent.list()).map((folder) => folder.path), ['/folder/7', '/folder/6', '/folder/5', '/folder/4', '/folder/3']);
	});

	it('forgets a folder, and marks one that no longer exists', async () => {
		const root = await tree({ a: {} });
		const recent = new RecentFolders(join(root, 'recent.json'));
		await recent.add(join(root, 'gone'));
		await recent.add(join(root, 'a'));
		assert.deepEqual(await recent.list(), [{ path: join(root, 'a'), exists: true }, { path: join(root, 'gone'), exists: false }]);
		await recent.forget(join(root, 'a'));
		await recent.forget('/never/added');
		assert.deepEqual(await recent.list(), [{ path: join(root, 'gone'), exists: false }]);
	});

	it('reads a broken file as an empty list, and skips entries that aren’t paths', async () => {
		const root = await tree({});
		const file = join(root, 'recent.json');
		const recent = new RecentFolders(file);
		await writeFile(file, '{broken');
		assert.deepEqual(await recent.list(), []);
		await writeFile(file, JSON.stringify({ recent: ['/x', 3, null] }));
		assert.deepEqual((await recent.list()).map((folder) => folder.path), ['/x']);
		await writeFile(file, JSON.stringify(['/x']));
		assert.deepEqual(await recent.list(), []);
	});
});
