import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
	browseRefusalOf,
	checkFolder,
	CONTAINER_REASON,
	HIDDEN_REASON,
	HOLDS_SOUNDBOARD_REASON,
	MISSING_REASON,
	NO_AUDIO_REASON,
	NOT_FOLDER_REASON,
	OUTSIDE_REASON,
	refusalOf,
	SYSTEM_REASON,
} from '../../../src/startup/folder-rules.js';
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

/** @type {Platform} */
const LINUX = { name: 'linux', home: '/home/ana', roots: ['/'], allowHidden: false };
/** @type {Platform} */
const MAC = { name: 'darwin', home: '/Users/ana', roots: ['/'], allowHidden: false };
/** @type {Platform} */
const WINDOWS = { name: 'win32', home: 'C:\\Users\\ana', systemDrive: 'C:', roots: ['C:\\', 'D:\\'], allowHidden: false };

describe('browseRefusalOf', () => {
	it('refuses everything outside the roots, and allows the roots and what is inside them', () => {
		const platform = { ...LINUX, roots: ['/home/ana', '/mnt/sfx'] };
		assert.equal(browseRefusalOf('/home/ana', platform), null);
		assert.equal(browseRefusalOf('/home/ana/Music/Battle', platform), null);
		assert.equal(browseRefusalOf('/mnt/sfx', platform), null);
		assert.equal(browseRefusalOf('/home', platform), OUTSIDE_REASON);
		assert.equal(browseRefusalOf('/home/anabel', platform), OUTSIDE_REASON);
		assert.equal(browseRefusalOf('/mnt', platform), OUTSIDE_REASON);
		assert.equal(browseRefusalOf('/home/ana/../bob', platform), OUTSIDE_REASON);
	});

	it('refuses hidden folders below the root unless they are allowed, but not a hidden root itself', () => {
		const platform = { ...LINUX, roots: ['/home/ana', '/srv/.sounds'] };
		assert.equal(browseRefusalOf('/home/ana/.config', platform), HIDDEN_REASON);
		assert.equal(browseRefusalOf('/home/ana/.local/share/sounds', platform), HIDDEN_REASON);
		assert.equal(browseRefusalOf('/srv/.sounds/Battle', platform), null);
		assert.equal(browseRefusalOf('/home/ana/.config', { ...platform, allowHidden: true }), null);
	});

	it('compares Windows and macOS paths without regard to case', () => {
		assert.equal(browseRefusalOf('c:\\users\\ANA\\Music', { ...WINDOWS, roots: ['C:\\Users\\ana'] }), null);
		assert.equal(browseRefusalOf('/users/ANA/Music', { ...MAC, roots: ['/Users/ana'] }), null);
		assert.equal(browseRefusalOf('/HOME/ana/Music', { ...LINUX, roots: ['/home/ana'] }), OUTSIDE_REASON);
	});
});

describe('refusalOf', () => {
	it('refuses the system folders on Linux with everything inside them, but not drives under /run/media', () => {
		for (const path of ['/usr', '/usr/share/sounds', '/etc', '/var/lib', '/opt/game', '/run/user/1000']) {
			assert.equal(refusalOf(path, LINUX), SYSTEM_REASON, path);
		}
		assert.equal(refusalOf('/run/media/ana/USB', LINUX), null);
		assert.equal(refusalOf('/srvx', LINUX), null);
	});

	it('refuses the folders that only hold other places, but not what is inside them', () => {
		for (const path of ['/', '/home', '/home/ana', '/mnt', '/media', '/run/media']) {
			assert.equal(refusalOf(path, LINUX), CONTAINER_REASON, path);
		}
		assert.equal(refusalOf('/mnt/sfx', LINUX), null);
		assert.equal(refusalOf('/home/ana/Music', LINUX), null);
	});

	it('allows the home folder inside a system folder, as on Fedora Silverblue', () => {
		const platform = { ...LINUX, home: '/var/home/ana' };
		assert.equal(refusalOf('/var/home/ana/Music', platform), null);
		assert.equal(refusalOf('/var/home/ana', platform), CONTAINER_REASON);
		assert.equal(refusalOf('/var/lib', platform), SYSTEM_REASON);
	});

	it('refuses the macOS system folders', () => {
		assert.equal(refusalOf('/System/Library/Sounds', MAC), SYSTEM_REASON);
		assert.equal(refusalOf('/library/Sounds', MAC), SYSTEM_REASON);
		assert.equal(refusalOf('/Users', MAC), CONTAINER_REASON);
		assert.equal(refusalOf('/Volumes', MAC), CONTAINER_REASON);
		assert.equal(refusalOf('/Volumes/USB', MAC), null);
	});

	it('refuses the Windows system folders, AppData and the system drive, but not another drive', () => {
		for (const path of ['C:\\Windows\\Media', 'c:\\program files\\Game', 'D:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\Users\\ana\\AppData\\Local']) {
			assert.equal(refusalOf(path, WINDOWS), SYSTEM_REASON, path);
		}
		assert.equal(refusalOf('C:\\', WINDOWS), CONTAINER_REASON);
		assert.equal(refusalOf('C:\\Users', WINDOWS), CONTAINER_REASON);
		assert.equal(refusalOf('C:\\Users\\ana', WINDOWS), CONTAINER_REASON);
		assert.equal(refusalOf('D:\\', WINDOWS), null);
		assert.equal(refusalOf('C:\\Users\\ana\\Music', WINDOWS), null);
	});

	it('refuses system folders even inside a root, and gives the root and hidden reasons first', () => {
		assert.equal(refusalOf('/etc', { ...LINUX, roots: ['/'] }), SYSTEM_REASON);
		assert.equal(refusalOf('/etc', { ...LINUX, roots: ['/home/ana'] }), OUTSIDE_REASON);
		assert.equal(refusalOf('/home/ana/.x', { ...LINUX, roots: ['/home/ana'] }), HIDDEN_REASON);
	});
});

describe('checkFolder', () => {
	it('allows a soundboard, a folder with audio files, and one with audio files a level down', async () => {
		const root = await tree({
			board: { '.soundboard': '{}' },
			sounds: { 'Boom.mp3': '' },
			playlists: { Battle: { 'Song.ogg': '' } },
		});
		const platform = { ...LINUX, home: '/nowhere', roots: [root] };
		for (const name of ['board', 'sounds', 'playlists']) {
			assert.deepEqual(await checkFolder(join(root, name), platform), { allowed: true, reason: null, path: join(root, name) });
		}
	});

	it('refuses what is missing, a file, and a folder without audio within two levels', async () => {
		const root = await tree({
			'file.mp3': '',
			'empty': { 'a': { b: { 'Deep.mp3': '' } }, '.hidden': { 'Hidden.mp3': '' }, 'notes.txt': '' },
		});
		const platform = { ...LINUX, home: '/nowhere', roots: [root] };
		assert.equal((await checkFolder(join(root, 'missing'), platform)).reason, MISSING_REASON);
		assert.equal((await checkFolder(join(root, 'file.mp3'), platform)).reason, NOT_FOLDER_REASON);
		assert.equal((await checkFolder(join(root, 'empty'), platform)).reason, NO_AUDIO_REASON);
	});

	it('refuses a folder with a soundboard directly inside, even with audio of its own, but not one deeper or hidden', async () => {
		const root = await tree({
			outer: { 'Boom.mp3': '', 'board': { '.soundboard': '{}' } },
			deeper: { 'Boom.mp3': '', 'a': { board: { '.soundboard': '{}' } } },
			hidden: { 'Boom.mp3': '', '.board': { '.soundboard': '{}' } },
			nested: { '.soundboard': '{}', 'board': { '.soundboard': '{}' } },
		});
		const platform = { ...LINUX, home: '/nowhere', roots: [root] };
		assert.equal((await checkFolder(join(root, 'outer'), platform)).reason, HOLDS_SOUNDBOARD_REASON);
		for (const name of ['deeper', 'hidden', 'nested']) {
			assert.equal((await checkFolder(join(root, name), platform)).allowed, true, name);
		}
	});

	it('resolves symbolic links, so one can neither lead out of the roots nor hide where it leads', async () => {
		const outside = await tree({ 'Boom.mp3': '' });
		const root = await tree({ inside: { 'Boom.mp3': '' } });
		await symlink(outside, join(root, 'escape'));
		await symlink(join(root, 'inside'), join(root, 'alias'));
		const platform = { ...LINUX, home: '/nowhere', roots: [root] };
		assert.deepEqual(await checkFolder(join(root, 'escape'), platform), { allowed: false, reason: OUTSIDE_REASON, path: outside });
		assert.deepEqual(await checkFolder(join(root, 'alias'), platform), { allowed: true, reason: null, path: join(root, 'inside') });
	});
});
