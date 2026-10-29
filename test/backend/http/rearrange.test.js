import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { startServer } from '../../../src/http/server.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ChangeWatcher } from '../../../src/library/change-watcher.js';
import { FakeClock } from '../../helpers/fake-clock.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

async function setup() {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Combat': { '1.mp3': 'one', '2.mp3': 'two' },
		'Tavern': { 'Song.mp3': 'song' },
	});
	cleanups.push(() => tree.remove());
	const root = tree.root;
	const watcher = new ChangeWatcher({ root, log: () => {}, watch: () => ({ on: () => {}, close: () => {} }), timers: new FakeClock() });
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(root);
	assert.equal(outcome.status, 'ready');
	await watcher.start(outcome.scan);
	cleanups.push(async () => watcher.stop());
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		port: 0,
		logError: (error) => assert.fail(String(error)),
		watcher,
	});
	cleanups.push(() => server.close());
	/**
	 * @param {string} path
	 * @param {{ method?: string, body?: unknown }} [init]
	 */
	const call = async (path, { method = 'GET', body } = {}) => {
		const response = await fetch(server.url + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
		const text = await response.text();
		return { status: response.status, body: /** @type {any} */ (text === '' ? null : JSON.parse(text)) };
	};
	return { root, server, watcher, call };
}

/**
 * Collects the messages of `GET /api/events` until one matches.
 * @param {string} baseUrl
 */
function openEvents(baseUrl) {
	/** @type {any[]} */
	const messages = [];
	/** @type {(() => void) | null} */
	let wake = null;
	let buffer = '';
	const outgoing = request(`${baseUrl}/api/events`, (response) => {
		response.setEncoding('utf8');
		response.on('data', (/** @type {string} */ chunk) => {
			buffer += chunk;
			const blocks = buffer.split('\n\n');
			buffer = blocks.pop() ?? '';
			for (const block of blocks.filter((text) => text.startsWith('data: '))) {
				messages.push(JSON.parse(block.slice('data: '.length)));
			}
			wake?.();
		});
	});
	outgoing.on('error', () => {});
	outgoing.end();
	cleanups.push(async () => outgoing.destroy());
	return {
		messages,
		/** @param {(message: any) => boolean} matches */
		async until(matches) {
			while (!messages.some(matches)) {
				await new Promise((resolve) => {
					wake = () => resolve(undefined);
				});
			}
		},
	};
}

/** @param {string} path */
async function exists(path) {
	return access(path).then(() => true, () => false);
}

describe('deleting and moving over HTTP', () => {
	it('deletes a sound, answers with the change and tells every page', async () => {
		const { root, server, watcher, call } = await setup();
		const events = openEvents(server.url);
		await events.until((message) => message.type === 'externalChanges');
		const response = await call('/api/sounds/Boom.mp3', { method: 'DELETE' });
		assert.deepEqual(response, { status: 200, body: { changes: [{ type: 'library.removed', soundId: 'Boom.mp3' }] } });
		await events.until((message) => message.type === 'library.removed');
		assert.ok(await exists(join(root, '.trash', 'Boom.mp3')));
		assert.deepEqual((await call('/api/library')).body.sounds, []);
		assert.equal(await watcher.check(), false);
	});

	it('deletes a track by its id, encoded whole', async () => {
		const { root, call } = await setup();
		const response = await call(`/api/tracks/${encodeURIComponent('Combat/2.mp3')}`, { method: 'DELETE' });
		assert.deepEqual(response.body.changes, [{ type: 'library.removed', trackId: 'Combat/2.mp3', playlistId: 'Combat' }]);
		assert.ok(await exists(join(root, '.trash', 'Combat', '2.mp3')));
	});

	it('deletes a playlist', async () => {
		const { root, call } = await setup();
		const response = await call('/api/playlists/Combat', { method: 'DELETE' });
		assert.deepEqual(response.body.changes, [{ type: 'library.removed', playlistId: 'Combat' }]);
		assert.ok(await exists(join(root, '.trash', 'Combat.json')));
		assert.deepEqual((await call('/api/library')).body.playlists.map((/** @type {any} */ playlist) => playlist.id), ['Tavern']);
	});

	it('answers 404 for an unknown id', async () => {
		const { call } = await setup();
		assert.equal((await call('/api/sounds/Nope.mp3', { method: 'DELETE' })).status, 404);
		assert.equal((await call('/api/tracks/Nope%2F1.mp3', { method: 'DELETE' })).status, 404);
		assert.equal((await call('/api/playlists/Nope', { method: 'DELETE' })).status, 404);
	});

	it('moves a sound into a playlist and sends the playlist whole', async () => {
		const { server, watcher, call } = await setup();
		const response = await call('/api/move', { method: 'POST', body: { id: 'Boom.mp3', to: 'Tavern' } });
		assert.equal(response.status, 200);
		const [removed, added] = response.body.changes;
		assert.deepEqual(removed, { type: 'library.removed', soundId: 'Boom.mp3' });
		assert.equal(added.type, 'library.added');
		assert.deepEqual(added.playlist.tracks.map((/** @type {any} */ track) => [track.id, track.url]), [
			['Tavern/Boom.mp3', '/media/Tavern/Boom.mp3'],
			['Tavern/Song.mp3', '/media/Tavern/Song.mp3'],
		]);
		assert.equal(await (await fetch(`${server.url}/media/Tavern/Boom.mp3`)).text(), 'boom');
		assert.equal((await fetch(`${server.url}/media/Boom.mp3`)).status, 404);
		assert.equal(await watcher.check(), false);
	});

	it('moves a track out to the sounds', async () => {
		const { call } = await setup();
		const response = await call('/api/move', { method: 'POST', body: { id: 'Combat/1.mp3', to: null } });
		assert.equal(response.body.changes[1].sound.id, '1.mp3');
		assert.equal(response.body.changes[1].sound.url, '/media/1.mp3');
	});

	it('refuses a move to where the item already is, or one it can\'t read', async () => {
		const { call } = await setup();
		assert.equal((await call('/api/move', { method: 'POST', body: { id: 'Boom.mp3', to: null } })).status, 400);
		assert.equal((await call('/api/move', { method: 'POST', body: { id: 'Combat/1.mp3', to: 'Combat' } })).status, 400);
		assert.equal((await call('/api/move', { method: 'POST', body: { id: 'Boom.mp3' } })).status, 400);
		assert.equal((await call('/api/move', { method: 'POST', body: { id: 'Nope.mp3', to: 'Combat' } })).status, 404);
		assert.equal((await call('/api/move', { method: 'POST', body: { id: 'Boom.mp3', to: 'Nope' } })).status, 404);
	});
});
