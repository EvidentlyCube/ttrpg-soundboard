import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpBackendApi } from '../../public/app/api/backend-api.js';
import { startServer } from '../../src/http/server.js';
import { BootstrapService } from '../../src/library/bootstrap-service.js';
import { FakePrompter } from '../helpers/fake-prompter.js';
import { FakeReporter } from '../helpers/fake-reporter.js';
import { createTmpTree } from '../helpers/tmp-tree.js';

describe('HttpBackendApi against the real server', () => {
	/** @type {import('../helpers/tmp-tree.js').TmpDir} */
	let tree;
	/** @type {Awaited<ReturnType<typeof startServer>>} */
	let server;
	/** @type {HttpBackendApi} */
	let api;

	before(async () => {
		tree = await createTmpTree({ '.soundboard': '{ "version": 1, "volumes": { "music": 0.5 } }', 'Boom.mp3': '' });
		const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
		assert.equal(outcome.status, 'ready');
		server = await startServer({ library: outcome.library, settings: outcome.settings, port: 0, logError: () => {} });
		api = new HttpBackendApi(server.url);
	});
	after(async () => {
		await server.close();
		await tree.remove();
	});

	it('fetches the library', async () => {
		const library = await api.fetchLibrary();
		assert.deepEqual(library.sounds.map((sound) => sound.url), ['/media/Boom.mp3']);
	});

	it('fetches the settings', async () => {
		assert.deepEqual(await api.fetchSettings(), { volumes: { master: 1, music: 0.5, sfx: 1 } });
	});

	it('saves volumes, with or without keepalive', async () => {
		await api.saveVolumes({ master: 0.8, music: 0.5, sfx: 1 }, { keepalive: false });
		await api.saveVolumes({ master: 0.8, music: 0.5, sfx: 0.3 }, { keepalive: true });
		const saved = JSON.parse(await readFile(join(tree.root, '.soundboard'), 'utf8'));
		assert.deepEqual(saved.volumes, { master: 0.8, music: 0.5, sfx: 0.3 });
	});

	it('rejects with the server error message', async () => {
		await assert.rejects(
			api.saveVolumes(/** @type {any} */ ({ master: 3, music: 1, sfx: 1 }), { keepalive: false }),
			/PUT \/api\/settings\/volumes failed: "master" must be a number from 0 to 1/,
		);
	});

	it('rejects when the server cannot be reached', async () => {
		await assert.rejects(new HttpBackendApi('http://127.0.0.1:1').fetchLibrary());
	});
});
