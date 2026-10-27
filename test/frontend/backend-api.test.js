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
		tree = await createTmpTree({ '.soundboard': '{ "version": 1, "volumes": { "music": 0.5 } }', 'Boom.mp3': '', 'Zażółć #1': { '1.mp3': '' } });
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

	it('saves sound options, with or without keepalive', async () => {
		await api.saveSoundOptions('Boom.mp3', { title: 'Big Boom', gain: 2 }, { keepalive: false });
		await api.saveSoundOptions('Boom.mp3', { title: 'Bigger Boom', gain: 2 }, { keepalive: true });
		const { title, gain } = JSON.parse(await readFile(join(tree.root, 'Boom.mp3.json'), 'utf8'));
		assert.deepEqual({ title, gain }, { title: 'Bigger Boom', gain: 2 });
		assert.equal((await api.fetchLibrary()).sounds[0].title, 'Bigger Boom');
	});

	it('saves start and end points, with null clearing the end point', async () => {
		await api.saveSoundOptions('Boom.mp3', { startAt: 0.25, endAt: 0.75 }, { keepalive: false });
		const [saved] = (await api.fetchLibrary()).sounds;
		assert.deepEqual([saved.startAt, saved.endAt], [0.25, 0.75]);
		await api.saveSoundOptions('Boom.mp3', { startAt: 0.25, endAt: null }, { keepalive: false });
		assert.equal(JSON.parse(await readFile(join(tree.root, 'Boom.mp3.json'), 'utf8')).endAt, null);
	});

	it('saves playlist options', async () => {
		await api.savePlaylistOptions('Zażółć #1', { title: 'Calm', gain: 0.5 }, { keepalive: false });
		const saved = JSON.parse(await readFile(join(tree.root, 'Zażółć #1.json'), 'utf8'));
		assert.deepEqual({ title: saved.title, gain: saved.gain }, { title: 'Calm', gain: 0.5 });
		assert.equal((await api.fetchLibrary()).playlists[0].gain, 0.5);
	});

	it('saves track options for an id with a slash', async () => {
		await api.saveTrackOptions('Zażółć #1/1.mp3', { title: 'First' }, { keepalive: false });
		const saved = JSON.parse(await readFile(join(tree.root, 'Zażółć #1', '1.mp3.json'), 'utf8'));
		assert.equal(saved.title, 'First');
	});

	it('encodes sound ids in the path', async () => {
		await assert.rejects(api.saveSoundOptions('No such/sound #1.mp3', { gain: 1 }, { keepalive: false }), /PATCH \/api\/sounds\/No%20such%2Fsound%20%231.mp3 failed: Unknown sound "No such\/sound #1.mp3"/);
	});

	it('rejects when the server cannot be reached', async () => {
		await assert.rejects(new HttpBackendApi('http://127.0.0.1:1').fetchLibrary());
	});
});
