import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { startServer } from '../../../src/http/server.js';
import { WAVEFORM_BYTES } from '../../../src/library/waveform-store.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

const PEAKS = Buffer.alloc(WAVEFORM_BYTES, 3);

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let musicRoot;

before(async () => {
	const tree = await createTmpTree({
		music: { 'Boom.mp3': 'boom', 'Combat': { 'Zażółć #1.ogg': 'one' } },
		public: { 'index.html': '<!doctype html>' },
	});
	musicRoot = join(tree.root, 'music');
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(musicRoot);
	assert.equal(outcome.status, 'ready');
	server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		port: 0,
		publicDir: join(tree.root, 'public'),
		logError: (error) => assert.fail(String(error)),
	});
});

after(async () => {
	await server.close();
});

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
const call = (path, init) => fetch(server.url + path, init);

describe('waveform API', () => {
	it('lists what is missing, then stores a waveform and stops listing it', async () => {
		const before = await (await call('/api/waveforms')).json();
		assert.deepEqual(before, { missing: ['Boom.mp3', 'Combat/Zażółć #1.ogg'] });

		const put = await call('/api/waveforms/Boom.mp3', { method: 'PUT', body: PEAKS });
		assert.equal(put.status, 204);
		assert.equal((await stat(join(musicRoot, 'Boom.mp3.wf'))).isFile(), true);

		assert.deepEqual(await (await call('/api/waveforms')).json(), { missing: ['Combat/Zażółć #1.ogg'] });
		const get = await call('/api/waveforms/Boom.mp3');
		assert.equal(get.status, 200);
		assert.equal(get.headers.get('content-type'), 'application/octet-stream');
		assert.deepEqual(Buffer.from(await get.arrayBuffer()), PEAKS);
	});

	it('accepts an id encoded whole or per segment', async () => {
		const id = 'Combat/Zażółć #1.ogg';
		assert.equal((await call(`/api/waveforms/${encodeURIComponent(id)}`, { method: 'PUT', body: PEAKS })).status, 204);
		const perSegment = id.split('/').map(encodeURIComponent).join('/');
		assert.equal((await call(`/api/waveforms/${perSegment}`)).status, 200);
	});

	it('answers 404 for a waveform that does not exist yet and for an unknown id', async () => {
		const missing = await call('/api/waveforms/Nothing.mp3');
		assert.equal(missing.status, 404);
		assert.equal((await call('/api/waveforms/Nothing.mp3', { method: 'PUT', body: PEAKS })).status, 404);
		assert.equal((await call('/api/waveforms/%E0%A4%A')).status, 404);
	});

	it('answers 400 for peaks of the wrong length and 413 for a huge body', async () => {
		assert.equal((await call('/api/waveforms/Boom.mp3', { method: 'PUT', body: Buffer.alloc(100) })).status, 400);
		assert.equal((await call('/api/waveforms/Boom.mp3', { method: 'PUT', body: Buffer.alloc(5000) })).status, 413);
	});

	it('answers 405 for other methods', async () => {
		const response = await call('/api/waveforms/Boom.mp3', { method: 'DELETE' });
		assert.equal(response.status, 405);
		assert.equal(response.headers.get('allow'), 'GET, PUT');
		assert.equal((await call('/api/waveforms', { method: 'POST' })).status, 405);
	});
});
