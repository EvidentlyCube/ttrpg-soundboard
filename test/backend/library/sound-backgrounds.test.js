import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ValidationError } from '../../../src/library/errors.js';
import { LibraryEditor } from '../../../src/library/library-editor.js';
import { readTrash } from '../../../src/library/trash.js';
import { takeSnapshot } from '../../../src/library/tree-snapshot.js';
import { DEFAULT_BACKGROUND_STYLE, validateAudioOptions } from '../../../src/library/validate.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { gifBytes, jpegBytes, pngBytes } from '../../helpers/image-bytes.js';
import { createTmpTree, writeTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/**
 * A library loaded by bootstrap with a sound Boom.mp3 and a playlist Combat. `writes` records what each task handed to
 * `writeFiles`.
 * @param {import('../../helpers/tmp-tree.js').TreeSpec} [extra] more files in the root
 */
async function setup(extra = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Combat': { 'a.mp3': 'a' },
		'Combat.json': JSON.stringify({ title: 'Combat', includedSubdirectories: [] }),
		...extra,
	});
	trees.push(tree);
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
	if (outcome.status !== 'ready') {
		throw new Error(`bootstrap ended with ${outcome.status}`);
	}
	/** @type {import('../../../src/library/change-watcher.js').FileChanges[]} */
	const writes = [];
	const editor = new LibraryEditor(outcome.library, {
		writeFiles: async (task) => {
			const result = await task();
			writes.push(result);
			return result;
		},
	});
	const sound = (id = 'Boom.mp3') => outcome.library.sounds.find((entry) => entry.id === id);
	const track = (id = 'Combat/Boom.mp3') => outcome.library.playlists.flatMap((playlist) => playlist.tracks).find((entry) => entry.id === id);
	// The test audio isn't real, so every file also has an unknown duration.
	const problems = outcome.problems.filter((problem) => problem.kind.endsWith('-background'));
	return { root: tree.root, library: outcome.library, problems, editor, writes, sound, track };
}

/**
 * Every file under a directory, relative to it, using `/`; the trash only when asked for.
 * @param {string} directory
 */
async function filesIn(directory) {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.filter((path) => !path.startsWith('.trash/'))
		.sort();
}

/** @param {string} directory */
async function imagesIn(directory) {
	return (await filesIn(directory)).filter((path) => path.includes('.bg.'));
}

/**
 * @param {string} root
 * @param {Uint8Array} bytes
 */
async function incoming(root, bytes) {
	const path = join(root, 'incoming.tmp');
	await writeFile(path, bytes);
	return path;
}

describe('sound backgrounds at startup', () => {
	it('gives a sound its image', async () => {
		const { sound, problems } = await setup({ 'Boom.mp3.bg.png': pngBytes(64, 48) });
		assert.equal(sound()?.background?.format, 'png');
		assert.equal(sound()?.background?.width, 64);
		assert.deepEqual(problems, []);
	});

	it('gives a sound without an image none, and the default settings', async () => {
		const { sound } = await setup();
		assert.equal(sound()?.background, null);
		assert.equal(sound()?.imageBlur, DEFAULT_BACKGROUND_STYLE.imageBlur);
	});

	it('reads the settings from the options file', async () => {
		const { sound } = await setup({ 'Boom.mp3.json': JSON.stringify({ title: 'Boom', imageColorOpacity: 0.25 }) });
		assert.equal(sound()?.imageColorOpacity, 0.25);
	});

	it('warns about an unusable image, two images, and a large one, as for playlists', async () => {
		const { problems } = await setup({
			'Boom.mp3.bg.png': jpegBytes(10, 10),
			'Bang.ogg': 'bang',
			'Bang.ogg.bg.png': pngBytes(10, 10),
			'Bang.ogg.bg.gif': gifBytes(10, 10),
			'Big.mp3': 'big',
			'Big.mp3.bg.png': pngBytes(4000, 3000),
		});
		assert.deepEqual(problems.map((problem) => [problem.kind, problem.path]), [
			['duplicate-background', 'Bang.ogg.bg.gif'],
			['duplicate-background', 'Bang.ogg.bg.png'],
			['large-background', 'Big.mp3.bg.png'],
			['invalid-background', 'Boom.mp3.bg.png'],
		]);
	});

	it("ignores a track's image without a warning, and gives the track none", async () => {
		const { track, problems } = await setup({ Combat: { 'a.mp3': 'a', 'a.mp3.bg.png': jpegBytes(5, 5) } });
		assert.equal(track('Combat/a.mp3')?.background, null);
		assert.deepEqual(problems, []);
	});

	it("follows a sound's image in the change watcher's snapshot, but not a track's", async () => {
		const { root } = await setup({ 'Boom.mp3.bg.png': pngBytes(10, 10), 'Combat': { 'a.mp3': 'a', 'a.mp3.bg.png': pngBytes(5, 5) } });
		const snapshot = await takeSnapshot(root);
		assert.ok(snapshot.has(join(root, 'Boom.mp3.bg.png')));
		assert.ok(!snapshot.has(join(root, 'Combat', 'a.mp3.bg.png')));
	});
});

describe('the background settings of sounds and tracks', () => {
	it('are valid keys of their options files', () => {
		assert.deepEqual(validateAudioOptions({ imageBlur: 20, titleShadowOffset: 0 }), []);
		assert.deepEqual(validateAudioOptions({ imageBlur: 21 }), ['"imageBlur" must be a number from 0 to 20']);
	});

	it('are saved rounded through updateSound', async () => {
		const { editor, sound } = await setup();
		await editor.updateSound('Boom.mp3', { titleShadowOpacity: 0.456 });
		assert.equal(sound()?.titleShadowOpacity, 0.46);
	});

	it('cannot be changed on a track, which has no tile', async () => {
		const { editor } = await setup();
		await assert.rejects(editor.updateTrack('Combat/a.mp3', { imageBlur: 2 }), ValidationError);
	});
});

describe("LibraryEditor setting and removing a sound's image", () => {
	it("moves the image into place under the sound's file name", async () => {
		const { root, editor, writes, sound } = await setup({ 'Boom.mp3.bg.gif': gifBytes(5, 5) });
		const result = await editor.setSoundBackground('Boom.mp3', await incoming(root, pngBytes(30, 20)), 'png');
		assert.equal(sound()?.background?.width, 30);
		assert.deepEqual(result, { item: sound(), removed: ['Boom.mp3.bg.gif'], added: 'Boom.mp3.bg.png' });
		assert.deepEqual(await imagesIn(root), ['Boom.mp3.bg.png']);
		assert.deepEqual(writes.at(-1), { written: [join(root, 'Boom.mp3.bg.png')], removed: [join(root, 'Boom.mp3.bg.gif')] });
	});

	it('refuses a sound deleted while the image was on its way', async () => {
		const { root, editor } = await setup();
		const from = await incoming(root, pngBytes(30, 20));
		await editor.deleteSound('Boom.mp3');
		await assert.rejects(editor.setSoundBackground('Boom.mp3', from, 'png'), { name: 'UnknownSoundError' });
	});

	it('deletes the image for good', async () => {
		const { root, editor, sound } = await setup({ 'Boom.mp3.bg.png': pngBytes(10, 10) });
		const result = await editor.removeSoundBackground('Boom.mp3');
		assert.equal(sound()?.background, null);
		assert.deepEqual(result.removed, ['Boom.mp3.bg.png']);
		assert.deepEqual(await imagesIn(root), []);
		assert.deepEqual((await readTrash(root)).sounds, []);
	});
});

describe('sound images following their sound', () => {
	it('go into a playlist with the sound, unused, and stop being watched', async () => {
		const { root, editor, track, writes } = await setup({ 'Boom.mp3.bg.png': pngBytes(10, 10) });
		await editor.moveSound('Boom.mp3', 'Combat');
		assert.deepEqual(await imagesIn(root), ['Combat/Boom.mp3.bg.png']);
		assert.equal(track()?.background, null);
		assert.ok(writes.at(-1)?.removed?.includes(join(root, 'Boom.mp3.bg.png')));
	});

	it('come back with a track moved out to the sounds, with its settings, and are watched again', async () => {
		const { root, editor, sound, writes } = await setup({
			'Boom.mp3.bg.png': pngBytes(10, 10),
			'Boom.mp3.json': JSON.stringify({ title: 'Boom', imageBlur: 9 }),
		});
		await editor.moveSound('Boom.mp3', 'Combat');
		await editor.moveTrack('Combat/Boom.mp3', null);
		assert.equal(sound()?.background?.width, 10);
		assert.equal(sound()?.imageBlur, 9);
		assert.deepEqual(writes.at(-1)?.written, [join(root, 'Boom.mp3.bg.png')]);
	});

	it('take the same new name as their sound on a clash', async () => {
		const { root, editor } = await setup({
			'Boom.mp3.bg.png': pngBytes(10, 10),
			'Combat': { 'a.mp3': 'a', 'Boom.mp3': 'other' },
		});
		await editor.moveSound('Boom.mp3', 'Combat');
		assert.deepEqual(await imagesIn(root), ['Combat/Boom (2).mp3.bg.png']);
	});

	it('count as taking a name, so a sound never lands on an image that is not its own', async () => {
		const { root, editor } = await setup({ Combat: { 'a.mp3': 'a', 'Boom.mp3.bg.gif': gifBytes(5, 5) } });
		await editor.moveSound('Boom.mp3', 'Combat');
		assert.ok((await filesIn(root)).includes('Combat/Boom (2).mp3'));
	});

	it('go into the trash and back with their sound, counted in its size', async () => {
		const { root, editor, sound } = await setup({ 'Boom.mp3.bg.png': pngBytes(10, 10) });
		await editor.deleteSound('Boom.mp3');
		assert.deepEqual(await imagesIn(root), []);
		const [trashed] = (await readTrash(root)).sounds;
		assert.equal(trashed.size, 'boom'.length + (await stat(join(root, '.trash', 'Boom.mp3.json'))).size + pngBytes(10, 10).length);
		await editor.restoreFromTrash({ kind: 'sound', id: 'Boom.mp3' });
		assert.equal(sound()?.background?.width, 10);
		assert.deepEqual(await imagesIn(root), ['Boom.mp3.bg.png']);
	});

	it('are deleted for good with their sound', async () => {
		const { root, editor } = await setup({ 'Boom.mp3.bg.png': pngBytes(10, 10) });
		await editor.deleteSound('Boom.mp3');
		await editor.purgeFromTrash({ kind: 'sound', id: 'Boom.mp3' });
		assert.deepEqual(await readdir(join(root, '.trash')), []);
	});

	it("are merged into the trash with a playlist's tracks", async () => {
		const { root, editor } = await setup({ Combat: { 'a.mp3': 'a', 'a.mp3.bg.png': pngBytes(5, 5) } });
		await writeTree(root, { '.trash': { Combat: { 'a.mp3': 'old' } } });
		await editor.deletePlaylist('Combat');
		const trashed = (await readdir(join(root, '.trash', 'Combat'))).sort();
		assert.deepEqual(trashed.filter((name) => name.includes('.bg.')), ['a (2).mp3.bg.png']);
	});
});
