import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	InvalidWaveformError,
	UnknownWaveformFileError,
	WAVEFORM_BYTES,
	WaveformStore,
} from '../../../src/library/waveform-store.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

const PEAKS = Buffer.alloc(WAVEFORM_BYTES, 5);

/** @type {string} */
let root;
/** @type {WaveformStore} */
let store;

/** @param {string} id */
function file(id) {
	return /** @type {any} */ ({ id, absolutePath: join(root, id) });
}

beforeEach(async () => {
	const tree = await createTmpTree({ 'Boom.mp3': 'boom', 'Rain.ogg': 'rain', 'Combat': { '1.mp3': 'one', '2.mp3': 'two' } });
	root = tree.root;
	const sounds = [file('Rain.ogg'), file('Boom.mp3')];
	const tracks = [file('Combat/1.mp3'), file('Combat/2.mp3')];
	store = new WaveformStore(/** @type {any} */ ({
		sounds,
		playlists: [{ tracks }],
		files: new Map([...sounds, ...tracks].map((entry) => [entry.id, entry])),
	}));
});

describe('WaveformStore', () => {
	it('lists everything as missing at first, sounds before tracks', async () => {
		assert.deepEqual(await store.missing(), ['Rain.ogg', 'Boom.mp3', 'Combat/1.mp3', 'Combat/2.mp3']);
	});

	it('stores a waveform next to its audio file and reads it back', async () => {
		await store.write('Combat/1.mp3', PEAKS);
		assert.deepEqual(await store.read('Combat/1.mp3'), PEAKS);
		assert.equal((await stat(join(root, 'Combat/1.mp3.wf'))).isFile(), true);
		assert.deepEqual(await store.missing(), ['Rain.ogg', 'Boom.mp3', 'Combat/2.mp3']);
	});

	it('has no waveform to read before one is written', async () => {
		assert.equal(await store.read('Boom.mp3'), null);
	});

	it('treats a waveform as stale once its audio file changes', async () => {
		await store.write('Boom.mp3', PEAKS);
		await writeFile(join(root, 'Boom.mp3'), 'a longer boom');
		assert.equal(await store.read('Boom.mp3'), null);
		assert.ok((await store.missing()).includes('Boom.mp3'));
	});

	it('treats a waveform as stale when only the modified time changes', async () => {
		await store.write('Boom.mp3', PEAKS);
		await utimes(join(root, 'Boom.mp3'), new Date(2000, 0, 1), new Date(2000, 0, 1));
		assert.equal(await store.read('Boom.mp3'), null);
	});

	it('replaces a stale waveform', async () => {
		await store.write('Boom.mp3', PEAKS);
		await writeFile(join(root, 'Boom.mp3'), 'a longer boom');
		await store.write('Boom.mp3', Buffer.alloc(WAVEFORM_BYTES, 9));
		assert.equal((await store.read('Boom.mp3'))?.[0], 9);
	});

	it('treats a damaged waveform file as missing', async () => {
		await store.write('Boom.mp3', PEAKS);
		await writeFile(join(root, 'Boom.mp3.wf'), 'junk');
		assert.equal(await store.read('Boom.mp3'), null);
	});

	it('rejects peaks of the wrong length', async () => {
		await assert.rejects(store.write('Boom.mp3', Buffer.alloc(10)), InvalidWaveformError);
		await assert.rejects(readFile(join(root, 'Boom.mp3.wf')), { code: 'ENOENT' });
	});

	it('rejects an id that is not a sound or track', async () => {
		await assert.rejects(store.write('../etc/passwd', PEAKS), UnknownWaveformFileError);
		await assert.rejects(store.read('nope.mp3'), UnknownWaveformFileError);
	});

	it('leaves no temporary file behind', async () => {
		await store.write('Boom.mp3', PEAKS);
		await assert.rejects(stat(join(root, 'Boom.mp3.wf.tmp')), { code: 'ENOENT' });
	});
});
