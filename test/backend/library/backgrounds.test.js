import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { backgroundNameFor, backgroundOwnerOf } from '../../../src/library/backgrounds.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ValidationError } from '../../../src/library/errors.js';
import { LibraryEditor } from '../../../src/library/library-editor.js';
import { readTrash } from '../../../src/library/trash.js';
import { takeSnapshot } from '../../../src/library/tree-snapshot.js';
import { DEFAULT_BACKGROUND_STYLE, validatePlaylistOptions } from '../../../src/library/validate.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { gifBytes, jpegBytes, pngBytes } from '../../helpers/image-bytes.js';
import { createTmpTree, writeTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

const COMBAT = JSON.stringify({ title: 'Combat', includedSubdirectories: [] });

/**
 * A library loaded by bootstrap with a Combat playlist. `writes` records what each task handed to `writeFiles`.
 * @param {import('../../helpers/tmp-tree.js').TreeSpec} [extra] more files in the root
 */
async function setup(extra = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Combat': { 'a.mp3': 'a' },
		'Combat.json': COMBAT,
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
	const combat = () => outcome.library.playlists.find((playlist) => playlist.id === 'Combat');
	// The test audio isn't real, so every file also has an unknown duration.
	const problems = outcome.problems.filter((problem) => problem.kind.endsWith('-background'));
	return { root: tree.root, library: outcome.library, problems, editor, writes, combat };
}

/**
 * Every file under a directory, relative to it, using `/`.
 * @param {string} directory
 */
async function filesIn(directory) {
	const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
		.sort();
}

/**
 * Writes an image to a temporary name in the root, as the upload and download do before handing it over.
 * @param {string} root
 * @param {Uint8Array} bytes
 */
async function incoming(root, bytes) {
	const path = join(root, 'incoming.tmp');
	await writeFile(path, bytes);
	return path;
}

describe('background file names', () => {
	it("adds .bg.<extension> to the owner's name", () => {
		assert.equal(backgroundNameFor('Combat', 'jpeg'), 'Combat.bg.jpg');
		assert.equal(backgroundNameFor('Combat', 'avif'), 'Combat.bg.avif');
	});

	it('finds the owner of any image extension, in any case', () => {
		assert.equal(backgroundOwnerOf('Combat.bg.PNG'), 'Combat');
		assert.equal(backgroundOwnerOf('Combat.bg.jpeg'), 'Combat');
		assert.equal(backgroundOwnerOf('A.bg.b.bg.webp'), 'A.bg.b');
		assert.equal(backgroundOwnerOf('Combat.bg.svg'), null);
		assert.equal(backgroundOwnerOf('Combat.png'), null);
		assert.equal(backgroundOwnerOf('.bg.png'), null);
	});
});

describe('playlist backgrounds at startup', () => {
	it('gives a playlist its image, with the format, size and dimensions', async () => {
		const { combat, problems } = await setup({ 'Combat.bg.png': pngBytes(640, 360) });
		const background = combat()?.background;
		assert.equal(background?.format, 'png');
		assert.equal(background?.width, 640);
		assert.equal(background?.height, 360);
		assert.equal(background?.size, pngBytes(640, 360).length);
		assert.deepEqual(problems, []);
	});

	it('gives a playlist without an image none, and the default settings', async () => {
		const { combat } = await setup();
		assert.equal(combat()?.background, null);
		assert.deepEqual({ ...combat(), background: undefined, tracks: undefined }, {
			...combat(), background: undefined, tracks: undefined, ...DEFAULT_BACKGROUND_STYLE,
		});
	});

	it('reads the settings from the options file', async () => {
		const options = JSON.stringify({ title: 'Combat', includedSubdirectories: [], imageBlur: 7.5, titleShadowOffset: 0 });
		const { combat } = await setup({ 'Combat.json': options });
		assert.equal(combat()?.imageBlur, 7.5);
		assert.equal(combat()?.titleShadowOffset, 0);
		assert.equal(combat()?.imageColorOpacity, DEFAULT_BACKGROUND_STYLE.imageColorOpacity);
	});

	it('warns about an image that fails the checks, and leaves it on disk', async () => {
		const { root, combat, problems } = await setup({ 'Combat.bg.png': jpegBytes(10, 10) });
		assert.equal(combat()?.background, null);
		assert.deepEqual(problems.map((problem) => [problem.kind, problem.path, problem.severity]), [
			['invalid-background', 'Combat.bg.png', 'warning'],
		]);
		assert.match(problems[0].message, /says it is a PNG but is a JPEG/);
		assert.ok((await filesIn(root)).includes('Combat.bg.png'));
	});

	it('shows neither of two images for one playlist and warns about both', async () => {
		const { combat, problems } = await setup({ 'Combat.bg.png': pngBytes(10, 10), 'Combat.bg.gif': gifBytes(10, 10) });
		assert.equal(combat()?.background, null);
		assert.deepEqual(problems.map((problem) => [problem.kind, problem.path]), [
			['duplicate-background', 'Combat.bg.gif'],
			['duplicate-background', 'Combat.bg.png'],
		]);
	});

	it('shows an image larger than 1080p with a warning naming its size', async () => {
		const { combat, problems } = await setup({ 'Combat.bg.png': pngBytes(4000, 3000) });
		assert.equal(combat()?.background?.width, 4000);
		assert.deepEqual(problems.map((problem) => [problem.kind, problem.params]), [
			['large-background', { width: 4000, height: 3000 }],
		]);
	});

	it('ignores an image whose playlist does not exist', async () => {
		const { problems } = await setup({ 'Tavern.bg.png': pngBytes(10, 10) });
		assert.deepEqual(problems, []);
	});

	it("follows images in the change watcher's snapshot", async () => {
		const { root } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		assert.ok((await takeSnapshot(root)).has(join(root, 'Combat.bg.png')));
	});
});

describe('the background settings', () => {
	it('accepts each setting within its range and refuses others', () => {
		assert.deepEqual(validatePlaylistOptions({ imageColorOpacity: 1, imageBlur: 20, titleShadowOpacity: 0, titleShadowBlur: 10, titleShadowOffset: 5 }), []);
		assert.deepEqual(validatePlaylistOptions({ imageColorOpacity: 1.1, imageBlur: -1, titleShadowOffset: '1' }), [
			'"imageColorOpacity" must be a number from 0 to 1',
			'"imageBlur" must be a number from 0 to 20',
			'"titleShadowOffset" must be a number from 0 to 5',
		]);
	});

	it('saves them rounded through updatePlaylist', async () => {
		const { editor, combat } = await setup();
		await editor.updatePlaylist('Combat', { imageColorOpacity: 0.123_4, imageBlur: 4.567 });
		assert.equal(combat()?.imageColorOpacity, 0.12);
		assert.equal(combat()?.imageBlur, 4.57);
	});

	it('refuses one out of range', async () => {
		const { editor } = await setup();
		await assert.rejects(editor.updatePlaylist('Combat', { titleShadowBlur: 11 }), ValidationError);
	});
});

describe("LibraryEditor setting and removing a playlist's image", () => {
	it("moves the image into place under the playlist's name and reads it", async () => {
		const { root, editor, writes, combat } = await setup();
		const result = await editor.setPlaylistBackground('Combat', await incoming(root, pngBytes(30, 20)), 'png');
		assert.equal(combat()?.background?.width, 30);
		assert.deepEqual(result, { item: combat(), removed: [], added: 'Combat.bg.png' });
		assert.ok(!(await filesIn(root)).includes('incoming.tmp'));
		assert.deepEqual(writes.at(-1), { written: [join(root, 'Combat.bg.png')], removed: [] });
	});

	it('replaces an image of another format and reports the old one gone', async () => {
		const { root, editor, writes } = await setup({ 'Combat.bg.gif': gifBytes(5, 5) });
		const result = await editor.setPlaylistBackground('Combat', await incoming(root, pngBytes(30, 20)), 'png');
		assert.deepEqual(result.removed, ['Combat.bg.gif']);
		assert.deepEqual((await filesIn(root)).filter((name) => name.includes('.bg.')), ['Combat.bg.png']);
		assert.deepEqual(writes.at(-1)?.removed, [join(root, 'Combat.bg.gif')]);
	});

	it('refuses a playlist deleted while the image was on its way', async () => {
		const { root, editor } = await setup();
		const from = await incoming(root, pngBytes(30, 20));
		await editor.deletePlaylist('Combat');
		await assert.rejects(editor.setPlaylistBackground('Combat', from, 'png'), { name: 'UnknownPlaylistError' });
	});

	it('deletes the image for good, and any other file named like one', async () => {
		const { root, editor, combat } = await setup({ 'Combat.bg.png': pngBytes(10, 10), 'Combat.bg.gif': gifBytes(5, 5) });
		const result = await editor.removePlaylistBackground('Combat');
		assert.equal(combat()?.background, null);
		assert.deepEqual(result.removed, ['Combat.bg.gif', 'Combat.bg.png']);
		assert.equal(result.added, null);
		assert.deepEqual((await filesIn(root)).filter((name) => name.includes('.bg.')), []);
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
	});
});

describe('playlist images in the trash', () => {
	it('go into the trash with a deleted playlist, replacing an older one there', async () => {
		const { root, editor } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		await writeTree(root, { '.trash': { 'Combat.bg.gif': gifBytes(5, 5) } });
		await editor.deletePlaylist('Combat');
		assert.deepEqual(await filesIn(join(root, '.trash')), ['Combat.bg.png', 'Combat.json', 'Combat/a.mp3', 'Combat/a.mp3.json']);
	});

	it("count toward the trashed playlist's size", async () => {
		const { root, editor } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		await editor.deletePlaylist('Combat');
		const withImage = (await readTrash(root)).playlists[0].size;
		await rm(join(root, '.trash', 'Combat.bg.png'));
		assert.equal(withImage - (await readTrash(root)).playlists[0].size, pngBytes(10, 10).length);
	});

	it('come back with a restored playlist', async () => {
		const { root, editor, library, writes } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		await editor.deletePlaylist('Combat');
		await editor.restoreFromTrash({ kind: 'playlist', id: 'Combat' });
		const combat = library.playlists.find((playlist) => playlist.id === 'Combat');
		assert.equal(combat?.background?.format, 'png');
		assert.ok((await filesIn(root)).includes('Combat.bg.png'));
		assert.ok(writes.at(-1)?.written?.includes(join(root, 'Combat.bg.png')));
	});

	it('are copied when restoring a track recreates its playlist, so the tracks still trashed keep it', async () => {
		const { root, editor, library } = await setup();
		await writeTree(root, {
			'.trash': { 'Tavern': { 'a.mp3': 'a', 'b.mp3': 'b' }, 'Tavern.json': COMBAT, 'Tavern.bg.png': pngBytes(10, 10) },
		});
		await editor.restoreFromTrash({ kind: 'track', id: 'Tavern/a.mp3' });
		assert.equal(library.playlists.find((playlist) => playlist.id === 'Tavern')?.background?.width, 10);
		assert.ok((await filesIn(join(root, '.trash'))).includes('Tavern.bg.png'));
		assert.ok((await filesIn(root)).includes('Tavern.bg.png'));
	});

	it('are deleted for good with their playlist', async () => {
		const { root, editor } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		await editor.deletePlaylist('Combat');
		await editor.purgeFromTrash({ kind: 'playlist', id: 'Combat' });
		assert.deepEqual(await filesIn(join(root, '.trash')), []);
	});
});
