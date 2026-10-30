import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ValidationError } from '../../../src/library/errors.js';
import { LibraryEditor, UnknownPlaylistError, UnknownSoundError, UnknownTrackError } from '../../../src/library/library-editor.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/**
 * A library loaded by bootstrap, so every file has its options file: a sound with a waveform, a playlist with a nested
 * subdirectory, and a playlist with one track.
 * @param {import('../../helpers/tmp-tree.js').TreeSpec} [extra] more files, such as an existing trash
 */
async function setup(extra = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Boom.mp3.wf': 'peaks',
		'Rain.mp3': 'rain',
		'Combat': { 'a.mp3': 'a', 'b.mp3': 'b', 'Boss': { '1.mp3': 'boss' } },
		'Combat.json': JSON.stringify({ title: 'Combat', includedSubdirectories: ['Boss'] }),
		'Tavern': { 'song.mp3': 'song' },
		...extra,
	});
	trees.push(tree);
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
	assert.equal(outcome.status, 'ready');
	const library = outcome.library;
	return { root: tree.root, library, editor: new LibraryEditor(library) };
}

/**
 * Every file under a directory, relative to it, using `/`.
 * @param {string} directory
 */
async function filesIn(directory) {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.sort();
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

describe('LibraryEditor deletions', () => {
	it('moves a sound into the trash with its options file and waveform', async () => {
		const { root, library, editor } = await setup();
		const result = await editor.deleteSound('Boom.mp3');
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Boom.mp3', 'Boom.mp3.json', 'Boom.mp3.wf']);
		assert.deepEqual(result.changes, [{ type: 'library.removed', soundId: 'Boom.mp3' }]);
		assert.deepEqual(result.removed, [join(root, 'Boom.mp3'), join(root, 'Boom.mp3.json'), join(root, 'Boom.mp3.wf')]);
		assert.deepEqual(library.sounds.map((sound) => sound.id), ['Rain.mp3']);
		assert.equal(library.files.has('Boom.mp3'), false);
	});

	it('renames a sound that clashes in the trash, keeping its companions paired', async () => {
		const { root, editor } = await setup({ '.trash': { 'Boom.mp3': 'older', 'Boom.mp3.json': '{}' } });
		await editor.deleteSound('Boom.mp3');
		assert.deepEqual(await filesIn(join(root, '.trash')), [
			'Boom (2).mp3', 'Boom (2).mp3.json', 'Boom (2).mp3.wf', 'Boom.mp3', 'Boom.mp3.json',
		]);
		assert.equal(await readFile(join(root, '.trash', 'Boom (2).mp3'), 'utf8'), 'boom');
	});

	it("keeps a track's path inside the trash", async () => {
		const { root, library, editor } = await setup();
		const result = await editor.deleteTrack('Combat/Boss/1.mp3');
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Combat/Boss/1.mp3', 'Combat/Boss/1.mp3.json']);
		assert.deepEqual(result.changes, [{ type: 'library.removed', trackId: 'Combat/Boss/1.mp3', playlistId: 'Combat' }]);
		assert.deepEqual(library.playlists.find((playlist) => playlist.id === 'Combat')?.tracks.map((track) => track.id), ['Combat/a.mp3', 'Combat/b.mp3']);
	});

	it('deletes the playlist with its only track', async () => {
		const { root, library, editor } = await setup();
		const result = await editor.deleteTrack('Tavern/song.mp3');
		assert.deepEqual(result.changes, [{ type: 'library.removed', playlistId: 'Tavern' }]);
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Tavern.json', 'Tavern/song.mp3', 'Tavern/song.mp3.json']);
		assert.equal(library.playlists.some((playlist) => playlist.id === 'Tavern'), false);
	});

	it("moves a playlist's whole folder and its options file into the trash", async () => {
		const { root, library, editor } = await setup();
		await writeFile(join(root, 'Combat', 'cover.jpg'), 'image');
		const result = await editor.deletePlaylist('Combat');
		assert.deepEqual(await filesIn(join(root, '.trash')), [
			'Combat.json', 'Combat/Boss/1.mp3', 'Combat/Boss/1.mp3.json', 'Combat/a.mp3', 'Combat/a.mp3.json',
			'Combat/b.mp3', 'Combat/b.mp3.json', 'Combat/cover.jpg',
		]);
		assert.deepEqual(result.changes, [{ type: 'library.removed', playlistId: 'Combat' }]);
		assert.ok(result.removed.includes(join(root, 'Combat.json')));
		assert.ok(result.removed.includes(join(root, 'Combat', 'Boss', '1.mp3')));
		assert.deepEqual(library.playlists.map((playlist) => playlist.id), ['Tavern']);
		assert.equal(library.files.has('Combat/a.mp3'), false);
	});

	it('merges a deleted playlist into a trashed one of the same name, replacing its options file', async () => {
		const { root, editor } = await setup({
			'.trash': { 'Combat': { 'a.mp3': 'older', 'old.mp3': 'old' }, 'Combat.json': JSON.stringify({ title: 'Older' }) },
		});
		await editor.deletePlaylist('Combat');
		assert.deepEqual(await filesIn(join(root, '.trash')), [
			'Combat.json', 'Combat/Boss/1.mp3', 'Combat/Boss/1.mp3.json', 'Combat/a (2).mp3', 'Combat/a (2).mp3.json',
			'Combat/a.mp3', 'Combat/b.mp3', 'Combat/b.mp3.json', 'Combat/old.mp3',
		]);
		assert.equal((await readJson(join(root, '.trash', 'Combat.json'))).title, 'Combat');
		assert.equal(await readFile(join(root, '.trash', 'Combat', 'a (2).mp3'), 'utf8'), 'a');
		assert.deepEqual(await readdir(root).then((names) => names.includes('Combat')), false);
	});

	it('rejects unknown ids', async () => {
		const { editor } = await setup();
		await assert.rejects(editor.deleteSound('Combat/a.mp3'), UnknownSoundError);
		await assert.rejects(editor.deleteTrack('Boom.mp3'), UnknownTrackError);
		await assert.rejects(editor.deletePlaylist('Nope'), UnknownPlaylistError);
	});

	it('lets a save queued before the deletion finish first, and rejects saves after it', async () => {
		const { root, editor } = await setup();
		const save = editor.updateSound('Boom.mp3', { gain: 0.5 });
		await editor.deleteSound('Boom.mp3');
		await save;
		assert.equal((await readJson(join(root, '.trash', 'Boom.mp3.json'))).gain, 0.5);
		assert.deepEqual(await filesIn(root).then((files) => files.filter((file) => file.startsWith('Boom'))), []);
		await assert.rejects(editor.updateSound('Boom.mp3', { gain: 1 }), UnknownSoundError);
	});

	it('puts the item back when moving its files fails', async () => {
		const { root, library } = await setup();
		const editor = new LibraryEditor(library, { writeFiles: async () => Promise.reject(new Error('disk full')) });
		await assert.rejects(editor.deleteSound('Boom.mp3'), /disk full/);
		assert.deepEqual(library.sounds.map((sound) => sound.id), ['Boom.mp3', 'Rain.mp3']);
		assert.equal(library.files.get('Boom.mp3')?.absolutePath, join(root, 'Boom.mp3'));
	});

	it('runs through writeFiles, so the change watcher can follow', async () => {
		const { library } = await setup();
		/** @type {unknown[]} */
		const results = [];
		const editor = new LibraryEditor(library, {
			writeFiles: async (task) => {
				const result = await task();
				results.push(result);
				return result;
			},
		});
		await editor.deleteSound('Rain.mp3');
		assert.equal(results.length, 1);
	});
});

describe('LibraryEditor moves', () => {
	it('makes a sound a track, with its options file and waveform', async () => {
		const { root, library, editor } = await setup();
		const result = await editor.moveSound('Boom.mp3', 'Combat');
		assert.deepEqual((await filesIn(join(root, 'Combat'))).filter((file) => file.startsWith('Boom')), ['Boom.mp3', 'Boom.mp3.json', 'Boom.mp3.wf']);
		const combat = library.playlists.find((playlist) => playlist.id === 'Combat');
		assert.deepEqual(combat?.tracks.map((track) => track.id), ['Combat/a.mp3', 'Combat/b.mp3', 'Combat/Boom.mp3', 'Combat/Boss/1.mp3']);
		assert.equal(library.files.get('Combat/Boom.mp3')?.absolutePath, join(root, 'Combat', 'Boom.mp3'));
		assert.equal(library.files.has('Boom.mp3'), false);
		assert.deepEqual(result.changes, [{ type: 'library.removed', soundId: 'Boom.mp3' }, { type: 'library.added', playlist: combat }]);
		assert.deepEqual(result.renamed[0], [join(root, 'Boom.mp3'), join(root, 'Combat', 'Boom.mp3')]);
	});

	it('moves a track from a nested subdirectory into the root as a sound', async () => {
		const { root, library, editor } = await setup();
		const result = await editor.moveTrack('Combat/Boss/1.mp3', null);
		assert.deepEqual(await filesIn(root).then((files) => files.filter((file) => file.startsWith('1.mp3'))), ['1.mp3', '1.mp3.json']);
		const sound = library.sounds.find((entry) => entry.id === '1.mp3');
		assert.ok(sound);
		assert.deepEqual(result.changes, [
			{ type: 'library.removed', trackId: 'Combat/Boss/1.mp3', playlistId: 'Combat' },
			{ type: 'library.added', sound },
		]);
	});

	it('keeps the title, volume and points the track had', async () => {
		const { root, library, editor } = await setup();
		await editor.updateTrack('Combat/a.mp3', { title: 'Opening', gain: 0.5, startAt: 1 });
		await editor.moveTrack('Combat/a.mp3', 'Tavern');
		const moved = library.files.get('Tavern/a.mp3');
		assert.deepEqual([moved?.title, moved?.gain, moved?.startAt], ['Opening', 0.5, 1]);
		assert.equal((await readJson(join(root, 'Tavern', 'a.mp3.json'))).title, 'Opening');
	});

	it('renames a track whose name is taken in the other playlist', async () => {
		const { root, library, editor } = await setup();
		await mkdir(join(root, 'Tavern'), { recursive: true });
		await writeFile(join(root, 'Tavern', 'a.mp3.wf'), "someone else's");
		await editor.moveTrack('Combat/a.mp3', 'Tavern');
		assert.ok(library.files.has('Tavern/a (2).mp3'));
		assert.deepEqual(await filesIn(join(root, 'Tavern')), ['a (2).mp3', 'a (2).mp3.json', 'a.mp3.wf', 'song.mp3', 'song.mp3.json']);
	});

	it('takes the playlist with its only track, trashing what is left of it', async () => {
		const { root, library, editor } = await setup();
		const result = await editor.moveTrack('Tavern/song.mp3', 'Combat');
		assert.deepEqual(result.changes.map((change) => change.type), ['library.removed', 'library.added']);
		assert.deepEqual(result.changes[0], { type: 'library.removed', playlistId: 'Tavern' });
		assert.deepEqual(result.removed, [join(root, 'Tavern.json')]);
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Tavern.json']);
		assert.equal(library.playlists.some((playlist) => playlist.id === 'Tavern'), false);
		assert.ok(library.files.has('Combat/song.mp3'));
	});

	it('refuses to move a track into its own playlist', async () => {
		const { editor } = await setup();
		await assert.rejects(editor.moveTrack('Combat/a.mp3', 'Combat'), ValidationError);
	});

	it('rejects unknown ids and playlists', async () => {
		const { library, editor } = await setup();
		await assert.rejects(editor.moveSound('Nope.mp3', 'Combat'), UnknownSoundError);
		await assert.rejects(editor.moveSound('Boom.mp3', 'Nope'), UnknownPlaylistError);
		await assert.rejects(editor.moveTrack('Combat/a.mp3', 'Nope'), UnknownPlaylistError);
		assert.ok(library.files.has('Boom.mp3'));
		assert.ok(library.files.has('Combat/a.mp3'));
	});

	it('lets a save queued before the move finish at the old place', async () => {
		const { root, editor } = await setup();
		const save = editor.updateSound('Boom.mp3', { title: 'Big Boom' });
		await editor.moveSound('Boom.mp3', 'Combat');
		await save;
		assert.equal((await readJson(join(root, 'Combat', 'Boom.mp3.json'))).title, 'Big Boom');
		assert.equal((await readdir(root)).includes('Boom.mp3.json'), false);
	});
});
