import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ValidationError } from '../../../src/library/errors.js';
import { LibraryEditor } from '../../../src/library/library-editor.js';
import { UnknownTrashItemError } from '../../../src/library/trash.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree, writeTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/**
 * A library loaded by bootstrap, plus a trash. `writes` records what each task handed to `writeFiles` reported.
 * @param {import('../../helpers/tmp-tree.js').TreeSpec} trash
 * @param {import('../../helpers/tmp-tree.js').TreeSpec} [extra] more files in the root
 */
async function setup(trash, extra = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Rain.mp3': 'rain',
		'Combat': { 'a.mp3': 'a' },
		'Combat.json': JSON.stringify({ title: 'Combat', includedSubdirectories: [] }),
		...extra,
	});
	trees.push(tree);
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
	assert.equal(outcome.status, 'ready');
	await writeTree(tree.root, { '.trash': trash });
	/** @type {import('../../../src/library/change-watcher.js').FileChanges[]} */
	const writes = [];
	const library = outcome.library;
	const editor = new LibraryEditor(library, {
		writeFiles: async (task) => {
			const result = await task();
			writes.push(result);
			return result;
		},
	});
	return { root: tree.root, library, editor, writes };
}

/**
 * Every file under a directory, relative to it, using `/`; none when it is gone.
 * @param {string} directory
 */
async function filesIn(directory) {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.sort();
}

/** @param {string} path */
async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

const TRACK_OPTIONS = JSON.stringify({ title: 'Boss Theme', gain: 0.5 });

describe('LibraryEditor restoring from the trash', () => {
	it('puts a sound back into the root with its companions and adds it to the library', async () => {
		const { root, library, editor } = await setup({ 'Boom.mp3': 'boom', 'Boom.mp3.json': JSON.stringify({ title: 'Boom' }), 'Boom.mp3.wf': 'peaks' });
		const result = await editor.restoreFromTrash({ kind: 'sound', id: 'Boom.mp3' });
		assert.deepEqual((await filesIn(root)).filter((path) => path.startsWith('Boom')), ['Boom.mp3', 'Boom.mp3.json', 'Boom.mp3.wf']);
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
		assert.deepEqual(library.sounds.map((sound) => sound.id), ['Boom.mp3', 'Rain.mp3']);
		assert.equal(library.files.get('Boom.mp3')?.title, 'Boom');
		assert.deepEqual(result.changes, [{ type: 'library.added', sound: library.files.get('Boom.mp3') }]);
	});

	it('reports the audio and options files it wrote, never the waveform, which the watcher does not follow', async () => {
		const { root, editor, writes } = await setup({ 'Boom.mp3': 'boom', 'Boom.mp3.json': '{}', 'Boom.mp3.wf': 'peaks' });
		await editor.restoreFromTrash({ kind: 'sound', id: 'Boom.mp3' });
		assert.deepEqual(writes[0].written, [join(root, 'Boom.mp3'), join(root, 'Boom.mp3.json')]);
	});

	it('renames a restored sound whose name is taken and keeps its title', async () => {
		const { root, library, editor } = await setup({ 'Rain.mp3': 'old rain', 'Rain.mp3.json': JSON.stringify({ title: 'Old rain' }) });
		await editor.restoreFromTrash({ kind: 'sound', id: 'Rain.mp3' });
		assert.equal(await readFile(join(root, 'Rain (2).mp3'), 'utf8'), 'old rain');
		assert.equal(library.files.get('Rain (2).mp3')?.title, 'Old rain');
	});

	it('puts a track into the top level of its playlist, wherever it sat in the trash', async () => {
		const { root, library, editor } = await setup({ Combat: { 'Boss': { '1.mp3': 'boss', '1.mp3.json': TRACK_OPTIONS }, 'b.mp3': 'b' } });
		const result = await editor.restoreFromTrash({ kind: 'track', id: 'Combat/Boss/1.mp3' });
		const combat = library.playlists.find((playlist) => playlist.id === 'Combat');
		assert.deepEqual(combat?.tracks.map((track) => track.id), ['Combat/1.mp3', 'Combat/a.mp3']);
		assert.equal(library.files.get('Combat/1.mp3')?.title, 'Boss Theme');
		assert.deepEqual(result.changes, [{ type: 'library.added', playlist: combat }]);
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Combat/b.mp3']);
	});

	it('recreates a missing playlist from a copy of its trashed options file', async () => {
		const tavern = JSON.stringify({ title: 'The Tavern', gain: 0.8, includedSubdirectories: [] });
		const { root, library, editor } = await setup({ 'Tavern': { 'a.mp3': 'a', 'b.mp3': 'b' }, 'Tavern.json': tavern });
		await editor.restoreFromTrash({ kind: 'track', id: 'Tavern/a.mp3' });
		const restored = library.playlists.find((playlist) => playlist.id === 'Tavern');
		assert.equal(restored?.title, 'The Tavern');
		assert.equal(restored?.gain, 0.8);
		assert.deepEqual(restored?.tracks.map((track) => track.id), ['Tavern/a.mp3']);
		assert.deepEqual(await readJson(join(root, 'Tavern.json')), JSON.parse(tavern));
		// The tracks still in the trash keep their playlist's options.
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Tavern.json', 'Tavern/b.mp3']);
	});

	it('names a recreated playlist after its folder when the trash has no options file for it', async () => {
		const { root, library, editor } = await setup({ Tavern: { 'a.mp3': 'a' } });
		await editor.restoreFromTrash({ kind: 'track', id: 'Tavern/a.mp3' });
		assert.equal(library.playlists.find((playlist) => playlist.id === 'Tavern')?.title, 'Tavern');
		assert.deepEqual(await readJson(join(root, 'Tavern.json')), { title: 'Tavern', includedSubdirectories: [] });
	});

	it('clears a trashed playlist out once its last track is restored, leftovers and all', async () => {
		const { root, editor } = await setup({ 'Combat': { 'b.mp3': 'b', 'cover.jpg': 'jpeg' }, 'Combat.json': '{}' });
		await editor.restoreFromTrash({ kind: 'track', id: 'Combat/b.mp3' });
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
	});

	it('moves a playlist back whole when its name is free', async () => {
		const tavern = JSON.stringify({ title: 'The Tavern', includedSubdirectories: ['Night'] });
		const { root, library, editor, writes } = await setup({
			'Tavern': { 'a.mp3': 'a', 'a.mp3.json': TRACK_OPTIONS, 'Night': { 'n.mp3': 'n' }, 'cover.jpg': 'jpeg' },
			'Tavern.json': tavern,
		});
		const result = await editor.restoreFromTrash({ kind: 'playlist', id: 'Tavern' });
		assert.deepEqual(await filesIn(join(root, 'Tavern')), ['Night/n.mp3', 'Night/n.mp3.json', 'a.mp3', 'a.mp3.json', 'cover.jpg']);
		const restored = library.playlists.find((playlist) => playlist.id === 'Tavern');
		assert.equal(restored?.title, 'The Tavern');
		assert.deepEqual(restored?.tracks.map((track) => track.id), ['Tavern/a.mp3', 'Tavern/Night/n.mp3']);
		assert.deepEqual(result.changes, [{ type: 'library.added', playlist: restored }]);
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
		// Every options file is reported, including the one measured into being for the track that had none.
		assert.deepEqual(writes[0].written?.toSorted(), [
			join(root, 'Tavern', 'Night', 'n.mp3'),
			join(root, 'Tavern', 'Night', 'n.mp3.json'),
			join(root, 'Tavern', 'a.mp3'),
			join(root, 'Tavern', 'a.mp3.json'),
			join(root, 'Tavern.json'),
		].toSorted());
	});

	it("restores a playlist's tracks into the one of the same name, flattened, ignoring its trashed options", async () => {
		const { root, library, editor } = await setup({
			'Combat': { 'a.mp3': 'old a', 'Boss': { '1.mp3': 'boss' }, 'cover.jpg': 'jpeg' },
			'Combat.json': JSON.stringify({ title: 'Renamed', gain: 0.1 }),
		});
		await editor.restoreFromTrash({ kind: 'playlist', id: 'Combat' });
		const combat = library.playlists.find((playlist) => playlist.id === 'Combat');
		assert.equal(combat?.title, 'Combat');
		assert.equal(combat?.gain, 1);
		assert.deepEqual(combat?.tracks.map((track) => track.id), ['Combat/1.mp3', 'Combat/a (2).mp3', 'Combat/a.mp3']);
		assert.equal(await readFile(join(root, 'Combat', 'a (2).mp3'), 'utf8'), 'old a');
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
	});

	it('restores whole playlists first, then sounds', async () => {
		const { library, editor } = await setup({ 'Boom.mp3': 'boom', 'Tavern': { 'a.mp3': 'a' }, 'Duck': { 'd.mp3': 'd' } });
		const result = await editor.restoreFromTrash('all');
		assert.deepEqual(result.changes.map((change) => ('sound' in change ? change.sound.id : 'playlist' in change ? change.playlist.id : null)), ['Duck', 'Tavern', 'Boom.mp3']);
		assert.deepEqual(library.playlists.map((playlist) => playlist.id), ['Combat', 'Duck', 'Tavern']);
	});

	it('refuses a broken options file before moving anything', async () => {
		const { root, library, editor } = await setup({ Tavern: { 'a.mp3': 'a', 'b.mp3': 'b', 'b.mp3.json': '{"gain":"loud"}' } });
		await assert.rejects(editor.restoreFromTrash({ kind: 'playlist', id: 'Tavern' }), ValidationError);
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Tavern/a.mp3', 'Tavern/b.mp3', 'Tavern/b.mp3.json']);
		assert.equal(library.playlists.some((playlist) => playlist.id === 'Tavern'), false);
	});

	it("rejects what the trash doesn't hold", async () => {
		const { editor } = await setup({ 'Boom.mp3': 'boom' });
		await assert.rejects(editor.restoreFromTrash({ kind: 'sound', id: 'Rain.mp3' }), UnknownTrashItemError);
		await assert.rejects(editor.restoreFromTrash({ kind: 'playlist', id: 'Boom.mp3' }), UnknownTrashItemError);
	});
});

describe('LibraryEditor deleting from the trash', () => {
	it('deletes a sound for good with its options file and waveform', async () => {
		const { root, editor } = await setup({ 'Boom.mp3': 'boom', 'Boom.mp3.json': '{}', 'Boom.mp3.wf': 'peaks', 'Bang.mp3': 'bang' });
		await editor.purgeFromTrash({ kind: 'sound', id: 'Boom.mp3' });
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Bang.mp3']);
	});

	it('deletes a track, and its playlist folder with it when no audio is left', async () => {
		const { root, editor } = await setup({ 'Tavern': { 'a.mp3': 'a', 'b.mp3': 'b', 'notes.txt': 'n' }, 'Tavern.json': '{}' });
		await editor.purgeFromTrash({ kind: 'track', id: 'Tavern/a.mp3' });
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Tavern.json', 'Tavern/b.mp3', 'Tavern/notes.txt']);
		await editor.purgeFromTrash({ kind: 'track', id: 'Tavern/b.mp3' });
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
	});

	it('deletes a playlist folder with everything in it and its options file', async () => {
		const { root, editor } = await setup({ 'Tavern': { 'a.mp3': 'a', 'Night': { 'n.mp3': 'n' } }, 'Tavern.json': '{}', 'Boom.mp3': 'boom' });
		await editor.purgeFromTrash({ kind: 'playlist', id: 'Tavern' });
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Boom.mp3']);
	});

	it("empties the whole trash, files it doesn't list included", async () => {
		const { root, editor } = await setup({ 'Boom.mp3': 'boom', '.DS_Store': 'x', 'Artwork': { 'cover.jpg': 'jpeg' } });
		await editor.purgeFromTrash('all');
		assert.deepEqual(await readdir(root).then((names) => names.includes('.trash')), false);
	});
});
