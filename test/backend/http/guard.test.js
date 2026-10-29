import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { startServer } from '../../../src/http/server.js';
import { WAVEFORM_BYTES } from '../../../src/library/waveform-store.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { rawRequest } from '../../helpers/http-client.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
let tree;

before(async () => {
	tree = await createTmpTree({
		music: { 'Boom.mp3': 'boom', 'Combat': { 'One.ogg': 'one' } },
		public: { 'index.html': '<!doctype html>' },
	});
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(join(tree.root, 'music'));
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
	await tree.remove();
});

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
const call = (path, init) => fetch(server.url + path, init);

describe('request guard', () => {
	describe('Host', () => {
		it('rejects another name on API, media and static paths', async () => {
			for (const path of ['/api/library', '/media/Boom.mp3', '/index.html', '/api/events']) {
				const response = await rawRequest(server.url, path, { headers: { Host: 'rebound.example' } });
				assert.equal(response.status, 403, path);
				assert.deepEqual(JSON.parse(response.body.toString()), { error: 'Request not allowed' });
			}
		});

		it('rejects the right name with another port', async () => {
			const response = await rawRequest(server.url, '/api/library', { headers: { Host: '127.0.0.1:1' } });
			assert.equal(response.status, 403);
		});

		it('answers to localhost with the server port', async () => {
			const port = new URL(server.url).port;
			const response = await rawRequest(server.url, '/api/library', { headers: { Host: `localhost:${port}` } });
			assert.equal(response.status, 200);
		});
	});

	describe('Origin', () => {
		it('rejects a cross-site POST without a body', async () => {
			for (const path of ['/api/refresh', '/api/changes/check', '/api/trash/restore']) {
				const response = await call(path, { method: 'POST', headers: { Origin: 'https://evil.example' } });
				assert.equal(response.status, 403, path);
			}
		});

		it('rejects a cross-site POST that would move a sound, and moves nothing', async () => {
			const response = await call('/api/move', {
				method: 'POST',
				headers: { 'Origin': 'https://evil.example', 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: 'Boom.mp3', to: 'Combat' }),
			});
			assert.equal(response.status, 403);
			const library = /** @type {{ sounds: { id: string }[] }} */ (await (await call('/api/library')).json());
			assert.deepEqual(library.sounds.map((sound) => sound.id), ['Boom.mp3']);
		});

		it('lets the page through with its own origin', async () => {
			const response = await call('/api/library', { headers: { Origin: server.url } });
			assert.equal(response.status, 200);
		});
	});

	describe('Content-Type', () => {
		it('answers 415 to a JSON route sent as text', async () => {
			const response = await call('/api/settings/volumes', { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{"master":0.5}' });
			assert.equal(response.status, 415);
			assert.deepEqual(await response.json(), { error: 'Send application/json' });
		});

		it('answers 415 to a JSON body with no type', async () => {
			const response = await call('/api/move', { method: 'POST', body: new Blob(['{}']) });
			assert.equal(response.status, 415);
		});

		it('accepts parameters and any case', async () => {
			for (const type of ['application/json; charset=utf-8', 'Application/JSON']) {
				const response = await call('/api/settings/volumes', { method: 'PUT', headers: { 'Content-Type': type }, body: '{"master":0.5}' });
				assert.equal(response.status, 200, type);
			}
		});

		it('answers 415 to a waveform that is not octet-stream', async () => {
			const response = await call('/api/waveforms/Boom.mp3', {
				method: 'PUT',
				headers: { 'Content-Type': 'text/plain' },
				body: Buffer.alloc(WAVEFORM_BYTES),
			});
			assert.equal(response.status, 415);
			assert.deepEqual(await response.json(), { error: 'Send application/octet-stream' });
		});

		it('still stores a waveform sent as octet-stream', async () => {
			const response = await call('/api/waveforms/Boom.mp3', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: Buffer.alloc(WAVEFORM_BYTES),
			});
			assert.equal(response.status, 204);
		});
	});
});
