import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rename, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { startServer } from '../../../src/http/server.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ChangeWatcher } from '../../../src/library/change-watcher.js';
import { FakeClock } from '../../helpers/fake-clock.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @typedef {import('../../../src/library/bootstrap-service.js').RefreshOutcome} RefreshOutcome */

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

/** A watcher that never hears from the file system, so only checks and refreshes compare the directory. */
const QUIET_WATCH = () => ({ on: () => {}, close: () => {} });

/**
 * A server wired like `src/cli/main.js`, unless the test brings its own refresh.
 * @param {{ refresh?: (bootstrap: () => Promise<RefreshOutcome>) => () => Promise<RefreshOutcome> }} [options]
 */
async function setup({ refresh } = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Combat': { '1.mp3': 'one' },
	});
	cleanups.push(() => tree.remove());
	const root = tree.root;
	const watcher = new ChangeWatcher({ root, log: () => {}, watch: QUIET_WATCH, timers: new FakeClock() });
	const bootstrap = new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter(), updateSettingsFile: watcher.updateFile });
	const outcome = await bootstrap.run(root);
	assert.equal(outcome.status, 'ready');
	await watcher.start(outcome.scan);
	cleanups.push(async () => watcher.stop());
	const rebuild = () => bootstrap.refresh(root);
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		port: 0,
		logError: (error) => assert.fail(String(error)),
		watcher,
		refresh: refresh ? refresh(rebuild) : () => watcher.refresh(rebuild),
	});
	cleanups.push(() => server.close());
	/**
	 * @param {string} path
	 * @param {RequestInit} [init]
	 */
	const call = async (path, init) => {
		const response = await fetch(server.url + path, init);
		return { status: response.status, body: /** @type {any} */ (await response.json()) };
	};
	return { root, server, watcher, call };
}

/**
 * Reads `GET /api/events` message by message.
 * @param {string} baseUrl
 * @param {(message: { type: string }) => boolean} [keep]
 */
function openEvents(baseUrl, keep = () => true) {
	/** @type {{ type: string }[]} */
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
				const message = JSON.parse(block.slice('data: '.length));
				if (keep(message)) {
					messages.push(message);
				}
			}
			wake?.();
		});
	});
	outgoing.on('error', () => {});
	outgoing.end();
	cleanups.push(async () => outgoing.destroy());
	return {
		/** @param {number} count */
		async first(count) {
			while (messages.length < count) {
				await new Promise((resolve) => {
					wake = () => resolve(undefined);
				});
			}
			return messages.slice(0, count);
		},
	};
}

describe('external changes over HTTP', () => {
	describe('GET /api/events', () => {
		it('sends the current state, then every change of it', async () => {
			const { root, server, call } = await setup();
			// Every connection also says what the trash holds and what is wrong, which this test doesn't look at.
			const events = openEvents(server.url, (message) => message.type !== 'trash' && message.type !== 'problems');
			const message = (/** @type {boolean} */ pending) => ({ type: 'externalChanges', pending });
			assert.deepEqual(await events.first(1), [message(false)]);
			await writeFile(join(root, 'New.mp3'), 'new');
			await call('/api/changes/check', { method: 'POST' });
			assert.deepEqual(await events.first(2), [message(false), message(true)]);
			await call('/api/refresh', { method: 'POST' });
			assert.deepEqual(await events.first(3), [message(false), message(true), message(false)]);
		});

		it('streams with the event-stream type and no caching', async () => {
			const { server } = await setup();
			const controller = new AbortController();
			const response = await fetch(`${server.url}/api/events`, { signal: controller.signal });
			assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
			assert.equal(response.headers.get('cache-control'), 'no-store');
			controller.abort();
		});
	});

	describe('POST /api/changes/check', () => {
		it('says whether files changed outside the app', async () => {
			const { root, call } = await setup();
			assert.deepEqual(await call('/api/changes/check', { method: 'POST' }), { status: 200, body: { externalChanges: false } });
			await writeFile(join(root, 'New.mp3'), 'new');
			assert.deepEqual(await call('/api/changes/check', { method: 'POST' }), { status: 200, body: { externalChanges: true } });
		});

		it('only accepts POST', async () => {
			const { call } = await setup();
			assert.equal((await call('/api/changes/check')).status, 405);
		});

		it("does not count the app's own saves", async () => {
			const { call } = await setup();
			const patch = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Big Boom' }) };
			assert.equal((await call('/api/sounds/Boom.mp3', patch)).status, 200);
			assert.equal((await call('/api/settings/volumes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ music: 0.5 }) })).status, 200);
			assert.deepEqual((await call('/api/changes/check', { method: 'POST' })).body, { externalChanges: false });
		});
	});

	describe('POST /api/refresh', () => {
		it('rebuilds the library and serves the new one from then on', async () => {
			const { root, server, call } = await setup();
			await writeFile(join(root, 'New.mp3'), 'new');
			assert.deepEqual(await call('/api/refresh', { method: 'POST' }), { status: 200, body: {} });
			const library = (await call('/api/library')).body;
			assert.deepEqual(library.sounds.map((/** @type {{ id: string }} */ sound) => sound.id), ['Boom.mp3', 'New.mp3']);
			assert.equal((await fetch(`${server.url}/media/New.mp3`)).status, 200);
			const patch = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Brand new' }) };
			assert.equal((await call('/api/sounds/New.mp3', patch)).status, 200);
			assert.deepEqual((await call('/api/changes/check', { method: 'POST' })).body, { externalChanges: false });
		});

		it('answers 422 with every problem when an options file is invalid, and keeps the old library', async () => {
			const { root, call } = await setup();
			await writeFile(join(root, 'Combat', '1.mp3.json'), '{ "gain": 99 }');
			const { status, body } = await call('/api/refresh', { method: 'POST' });
			assert.equal(status, 422);
			assert.equal(body.error, 'Some options files are invalid');
			assert.deepEqual(body.errors.map((/** @type {{ path: string }} */ error) => error.path), ['Combat/1.mp3.json']);
			assert.match(body.errors[0].message, /gain/);
			assert.equal((await call('/api/library')).body.playlists[0].tracks[0].gain, 1);
		});

		it('answers 503 when .soundboard is gone', async () => {
			const { root, call } = await setup();
			await rename(join(root, '.soundboard'), join(root, 'settings.bak'));
			assert.deepEqual(await call('/api/refresh', { method: 'POST' }), {
				status: 503,
				body: { error: 'The .soundboard file is gone. Restart the app.' },
			});
		});

		it('only accepts POST', async () => {
			const { call } = await setup();
			assert.equal((await call('/api/refresh')).status, 405);
		});

		it('shares one rebuild between requests that arrive while it runs', async () => {
			let rebuilds = 0;
			/** @type {() => void} */
			let release = () => {};
			const { call } = await setup({
				refresh: (rebuild) => async () => {
					rebuilds++;
					await new Promise((resolve) => {
						release = () => resolve(undefined);
					});
					return rebuild();
				},
			});
			const first = call('/api/refresh', { method: 'POST' });
			const second = call('/api/refresh', { method: 'POST' });
			await new Promise((resolve) => setTimeout(resolve, 50));
			release();
			assert.deepEqual((await Promise.all([first, second])).map(({ status }) => status), [200, 200]);
			assert.equal(rebuilds, 1);
		});

		it('makes a save sent during the rebuild wait, so it reaches the new library', async () => {
			/** @type {() => void} */
			let release = () => {};
			const { call } = await setup({
				refresh: (rebuild) => async () => {
					await new Promise((resolve) => {
						release = () => resolve(undefined);
					});
					return rebuild();
				},
			});
			const refreshing = call('/api/refresh', { method: 'POST' });
			await new Promise((resolve) => setTimeout(resolve, 50));
			let saved = false;
			const saving = call('/api/sounds/Boom.mp3', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Big Boom' }) })
				.then((result) => {
					saved = true;
					return result;
				});
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert.equal(saved, false);
			release();
			await refreshing;
			assert.equal((await saving).status, 200);
			assert.equal((await call('/api/library')).body.sounds[0].title, 'Big Boom');
		});
	});

	it('works without a watcher or a refresh: no changes, and refreshing is unavailable', async () => {
		const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom' });
		cleanups.push(() => tree.remove());
		const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
		assert.equal(outcome.status, 'ready');
		const server = await startServer({ library: outcome.library, settings: outcome.settings, port: 0, logError: () => {} });
		cleanups.push(() => server.close());
		assert.deepEqual(await openEvents(server.url).first(1), [{ type: 'externalChanges', pending: false }]);
		const check = await fetch(`${server.url}/api/changes/check`, { method: 'POST' });
		assert.deepEqual(await check.json(), { externalChanges: false });
		const refresh = await fetch(`${server.url}/api/refresh`, { method: 'POST' });
		assert.deepEqual([refresh.status, await refresh.json()], [503, { error: 'Refreshing is not available' }]);
	});
});
