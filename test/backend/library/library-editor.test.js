import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLibrary } from '../../../src/library/library.js';
import { LibraryEditor, UnknownSoundError } from '../../../src/library/library-editor.js';
import { ValidationError } from '../../../src/library/errors.js';
import { updateJsonFile } from '../../../src/library/options-store.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
let tree;
beforeEach(async () => {
	tree = await createTmpTree({
		'Alpha.mp3': '',
		'Alpha.mp3.json': JSON.stringify({ title: 'Alpha', futureKey: 'kept' }),
		'Beta.mp3': '',
		'Combat': { '1.mp3': '' },
	});
});
afterEach(() => tree.remove());

/** @param {string} name */
function sound(name) {
	return {
		id: name,
		name,
		format: /** @type {const} */ ('mp3'),
		size: 0,
		absolutePath: join(tree.root, name),
		optionsPath: join(tree.root, `${name}.json`),
		hasOptions: true,
	};
}

function library() {
	const track = { ...sound('1.mp3'), id: 'Combat/1.mp3', absolutePath: join(tree.root, 'Combat', '1.mp3'), optionsPath: join(tree.root, 'Combat', '1.mp3.json') };
	return buildLibrary(
		{
			root: tree.root,
			hasSettingsFile: true,
			settingsPath: join(tree.root, '.soundboard'),
			sounds: [sound('Alpha.mp3'), sound('Beta.mp3')],
			playlists: [{ id: 'Combat', absolutePath: join(tree.root, 'Combat'), optionsPath: join(tree.root, 'Combat.json'), hasOptions: false, tracks: [track], subdirectories: [] }],
			warnings: [],
		},
		new Map([[join(tree.root, 'Alpha.mp3.json'), { title: 'Alpha' }], [join(tree.root, 'Beta.mp3.json'), { title: 'Beta' }]]),
	);
}

/** @param {string} name */
async function readOptions(name) {
	return JSON.parse(await readFile(join(tree.root, `${name}.json`), 'utf8'));
}

describe('LibraryEditor.updateSound', () => {
	it('merges the change into the options file, keeping unknown keys', async () => {
		const editor = new LibraryEditor(library());
		await editor.updateSound('Alpha.mp3', { gain: 0.5 });
		assert.deepEqual(await readOptions('Alpha.mp3'), { title: 'Alpha', futureKey: 'kept', gain: 0.5 });
	});

	it('creates the options file when it is missing', async () => {
		const editor = new LibraryEditor(library());
		await editor.updateSound('Beta.mp3', { title: 'Second' });
		assert.deepEqual(await readOptions('Beta.mp3'), { title: 'Second' });
	});

	it('updates the sound in the library and returns it', async () => {
		const lib = library();
		const editor = new LibraryEditor(lib);
		const updated = await editor.updateSound('Alpha.mp3', { title: 'First', gain: 2 });
		assert.equal(updated.title, 'First');
		assert.equal(updated.gain, 2);
		assert.equal(lib.files.get('Alpha.mp3'), updated);
	});

	it('trims the title and rounds the gain to 4 decimals', async () => {
		const editor = new LibraryEditor(library());
		const updated = await editor.updateSound('Alpha.mp3', { title: '  Spaced  ', gain: 0.501187233627 });
		assert.equal(updated.title, 'Spaced');
		assert.equal(updated.gain, 0.5012);
		assert.deepEqual(await readOptions('Alpha.mp3'), { title: 'Spaced', futureKey: 'kept', gain: 0.5012 });
	});

	it('sorts the sounds again after a rename', async () => {
		const lib = library();
		const editor = new LibraryEditor(lib);
		await editor.updateSound('Alpha.mp3', { title: 'Zulu' });
		assert.deepEqual(lib.sounds.map((entry) => entry.id), ['Beta.mp3', 'Alpha.mp3']);
	});

	it('rejects invalid changes without writing anything', async () => {
		const lib = library();
		const editor = new LibraryEditor(lib);
		/** @type {[unknown, RegExp][]} */
		const cases = [
			[null, /must be a JSON object/],
			[[], /must be a JSON object/],
			[{ title: '   ' }, /"title" must be a non-empty string/],
			[{ gain: 5 }, /"gain" must be a number from 0 to 4/],
			[{ gain: 1, loud: true }, /Unknown option "loud"/],
		];
		for (const [changes, message] of cases) {
			await assert.rejects(editor.updateSound('Alpha.mp3', /** @type {any} */ (changes)), (error) => error instanceof ValidationError && message.test(error.message));
		}
		assert.deepEqual(await readOptions('Alpha.mp3'), { title: 'Alpha', futureKey: 'kept' });
		assert.equal(lib.files.get('Alpha.mp3')?.gain, 1);
	});

	it('rejects unknown sounds and tracks', async () => {
		const editor = new LibraryEditor(library());
		await assert.rejects(editor.updateSound('Nope.mp3', { gain: 1 }), UnknownSoundError);
		await assert.rejects(editor.updateSound('Combat/1.mp3', { gain: 1 }), UnknownSoundError);
	});

	it('writes overlapping saves to one file one after the other, ending with the newest values', async () => {
		/** @type {string[]} */
		const log = [];
		let active = 0;
		const editor = new LibraryEditor(library(), {
			updateFile: async (path, update) => {
				active++;
				log.push(`start ${active}`);
				await new Promise((resolve) => setTimeout(resolve, 5));
				await updateJsonFile(path, update);
				active--;
			},
		});
		await Promise.all([
			editor.updateSound('Alpha.mp3', { gain: 0.25, title: 'One' }),
			editor.updateSound('Alpha.mp3', { gain: 0.75 }),
		]);
		assert.deepEqual(log, ['start 1', 'start 1']);
		assert.deepEqual(await readOptions('Alpha.mp3'), { title: 'One', futureKey: 'kept', gain: 0.75 });
	});

	it('keeps saving after a failed write', async () => {
		let fail = true;
		const editor = new LibraryEditor(library(), {
			updateFile: async (path, update) => {
				if (fail) {
					fail = false;
					throw new Error('disk full');
				}
				await updateJsonFile(path, update);
			},
		});
		await assert.rejects(editor.updateSound('Alpha.mp3', { gain: 0.25 }), /disk full/);
		await editor.updateSound('Alpha.mp3', { gain: 0.5 });
		assert.equal((await readOptions('Alpha.mp3')).gain, 0.5);
	});

	it('leaves the library unchanged when the write fails', async () => {
		const lib = library();
		await writeFile(join(tree.root, 'Alpha.mp3.json'), '{ broken');
		const editor = new LibraryEditor(lib);
		await assert.rejects(editor.updateSound('Alpha.mp3', { title: 'Changed' }), ValidationError);
		assert.equal(lib.files.get('Alpha.mp3')?.title, 'Alpha');
	});
});
