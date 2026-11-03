import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { HttpBackendApi } from '../../../public/app/api/backend-api.js';
import { HttpStartupApi } from '../../../public/app/api/startup-api.js';
import { NESTED_DIRECTORIES_QUESTION } from '../../../src/library/bootstrap-service.js';
import { PORT_ATTEMPTS, startApp } from '../../../src/http/app-server.js';
import { OUTSIDE_REASON } from '../../../src/startup/folder-rules.js';
import { RecentFolders } from '../../../src/startup/recent-folders.js';
import { StartupSession } from '../../../src/startup/startup-session.js';
import { findFreePort } from '../../helpers/http-client.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @typedef {import('../../../src/startup/startup-session.js').Opener} Opener */

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

/** @type {import('../../../src/http/router.js').AppInfo} */
const INFO = { app: '1.2.3', checking: false, tools: { ytDlp: '2026.10.26', ffmpeg: '8.1' }, update: null };

/**
 * The app server over a temporary tree: `music/board` may be opened, and `public` holds a page per phase.
 * Opening a folder asks about nested directories when `ask` is set; the board answers every request with "board".
 * @param {{ ask?: boolean, paths?: string[] | null, lan?: import('../../../src/http/server.js').LanOptions, lanManager?: boolean, port?: number }} [options]
 */
async function setup({ ask = false, paths = null, lan, lanManager = false, port = 0 } = {}) {
	const created = await createTmpTree({
		music: { 'board': { 'Boom.mp3': '' }, 'empty': {}, '.hidden': { 'Boom.mp3': '' } },
		public: {
			'selector.html': 'Selector page',
			'initializer.html': 'Initializer page',
			'waiting.html': 'Waiting page',
			'favicon.svg': '<svg/>',
			'app': { 'selector.js': 'script' },
		},
		config: {},
	});
	cleanups.push(() => created.remove());
	const root = await realpath(created.root);
	const music = join(root, 'music');
	/** @type {string[]} */
	const closed = [];
	/** @type {Opener} */
	const open = async (folder, ports) => {
		if (ask) {
			ports.reporter.nestedDirectories(['Combat/Boss']);
			if (!(await ports.prompter.confirm(NESTED_DIRECTORIES_QUESTION))) {
				return { status: 'cancelled' };
			}
		}
		return {
			status: 'ready',
			start: async () => ({
				handle: async (request, response) => {
					response.writeHead(200, { 'Content-Type': 'text/plain' });
					response.end(`board ${request.url}`);
				},
				close: async () => {
					closed.push(folder);
				},
			}),
		};
	};
	const platform = { name: /** @type {NodeJS.Platform} */ ('linux'), home: '/nowhere', roots: [music], allowHidden: false };
	const session = new StartupSession({
		paths: paths && paths.map((path) => join(music, path)),
		recent: new RecentFolders(join(root, 'config', 'recent.json')),
		platform,
		open,
		toolsReady: Promise.resolve(),
		logError: (error) => assert.fail(String(error)),
	});
	const app = await startApp({
		session,
		port,
		platform,
		info: INFO,
		lan,
		lanManager,
		publicDir: join(root, 'public'),
		logError: (error) => assert.fail(String(error)),
	});
	cleanups.push(() => app.close());
	cleanups.push(() => session.shutdown());
	const base = `http://127.0.0.1:${app.port}`;
	return { app, session, music, closed, base };
}

/**
 * @param {string} url
 * @param {string} [method]
 * @param {unknown} [body]
 */
async function call(url, method = 'GET', body = undefined) {
	const response = await fetch(url, {
		method,
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	/** @type {any} */
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		// Pages and files aren't JSON.
	}
	return { status: response.status, text, json };
}

/**
 * Waits until the session reaches a phase, since opening writes the recent folders.
 * @param {StartupSession} session
 * @param {string} phase
 */
async function phase(session, phase) {
	const deadline = Date.now() + 2000;
	while (session.phase !== phase) {
		assert.ok(Date.now() < deadline, `Timed out waiting for ${phase}`);
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

/**
 * Waits until the Initializer asks something.
 * @param {StartupSession} session
 */
async function question(session) {
	const deadline = Date.now() + 2000;
	while ((await session.state()).initializer?.step !== 'question') {
		assert.ok(Date.now() < deadline, 'Timed out waiting for a question');
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

describe('startApp', () => {
	it('answers on localhost, serves the Selector for every page and refuses the soundboard’s routes', async () => {
		const { app, base } = await setup();
		assert.equal(app.url, `http://localhost:${app.port}`);
		for (const path of ['/', '/index.html', '/remote']) {
			assert.equal((await call(base + path)).text, 'Selector page', path);
		}
		assert.equal((await call(`${base}/app/selector.js`)).text, 'script');
		assert.deepEqual(await call(`${base}/api/library`), { status: 503, text: '{"error":"No soundboard is loaded."}', json: { error: 'No soundboard is loaded.' } });
	});

	it('answers the info in every phase', async () => {
		const { base } = await setup();
		assert.deepEqual((await call(`${base}/api/info`)).json, { app: '1.2.3', checking: false, ytDlp: { version: '2026.10.26', update: null }, ffmpeg: '8.1' });
	});

	it('keeps the request guard', async () => {
		const { base } = await setup();
		const response = await fetch(`${base}/api/startup`, { method: 'GET', headers: { Origin: 'http://evil.example' } });
		assert.equal(response.status, 403);
	});

	it('tells the state with the tools, lists the starting places and folders, and refuses what may not be browsed', async () => {
		const { base, music } = await setup();
		const { json: state } = await call(`${base}/api/startup`);
		assert.equal(state.phase, 'selecting');
		assert.deepEqual(state.recent, []);
		assert.equal(state.tools.ffmpeg, '8.1');
		assert.deepEqual((await call(`${base}/api/startup/folders`)).json, { places: [{ name: 'music', path: music }] });
		const listing = await call(`${base}/api/startup/folders?path=${encodeURIComponent(music)}`);
		assert.deepEqual(listing.json.folders.map((/** @type {{ name: string }} */ folder) => folder.name), ['board', 'empty']);
		assert.deepEqual(await call(`${base}/api/startup/folders?path=${encodeURIComponent(join(music, '..'))}`), {
			status: 403,
			text: JSON.stringify({ error: OUTSIDE_REASON }),
			json: { error: OUTSIDE_REASON },
		});
		assert.equal((await call(`${base}/api/startup/folders?path=${encodeURIComponent(join(music, '.hidden'))}`)).status, 403);
		assert.equal((await call(`${base}/api/startup/folders?path=${encodeURIComponent(join(music, 'missing'))}`)).status, 404);
	});

	it('refuses browsing when folders were given on the command line', async () => {
		const { base } = await setup({ paths: ['board'] });
		assert.equal((await call(`${base}/api/startup/folders`)).status, 403);
	});

	it('opens a folder through the Initializer and its question, then hands every request to the soundboard', async () => {
		const { base, music, session } = await setup({ ask: true });
		assert.equal((await call(`${base}/api/startup/select`, 'POST', { path: join(music, 'board') })).status, 204);
		await phase(session, 'initializing');
		assert.equal((await call(`${base}/`)).text, 'Initializer page');
		const { json } = await call(`${base}/api/startup`);
		assert.deepEqual(json.initializer.question, { id: 1, kind: 'nestedDirectories', paths: ['Combat/Boss'] });
		assert.equal((await call(`${base}/api/startup/answer`, 'POST', { id: 1, yes: 'yes' })).status, 400);
		assert.equal((await call(`${base}/api/startup/answer`, 'POST', { id: 7, yes: true })).status, 409);
		assert.equal((await call(`${base}/api/startup/answer`, 'POST', { id: 1, yes: true })).status, 204);
		await phase(session, 'ready');
		assert.equal((await call(`${base}/`)).text, 'board /');
		assert.equal((await call(`${base}/api/library`)).text, 'board /api/library');
		assert.deepEqual((await call(`${base}/api/startup/ready`)).json, { ready: true });
		assert.equal((await call(`${base}/api/startup`)).json.phase, 'ready');
	});

	it('answers each action with 400 for a refused folder or a bad body, and 409 out of its phase', async () => {
		const { base, music } = await setup();
		const refused = await call(`${base}/api/startup/select`, 'POST', { path: join(music, 'empty') });
		assert.equal(refused.status, 400);
		assert.equal(refused.json.error, 'No audio files found here.');
		assert.equal((await call(`${base}/api/startup/select`, 'POST', {})).status, 400);
		for (const action of ['back', 'retry', 'delete-and-retry', 'close']) {
			assert.equal((await call(`${base}/api/startup/${action}`, 'POST')).status, 409, action);
		}
		assert.equal((await call(`${base}/api/startup/select`)).status, 405);
		assert.equal((await call(`${base}/api/startup/unknown`, 'POST')).status, 404);
	});

	it('closes the soundboard and serves the Selector again', async () => {
		const { base, music, session, closed } = await setup();
		await call(`${base}/api/startup/select`, 'POST', { path: join(music, 'board') });
		await phase(session, 'ready');
		assert.equal((await call(`${base}/api/startup/close`, 'POST')).status, 204);
		assert.deepEqual(closed, [join(music, 'board')]);
		assert.equal((await call(`${base}/`)).text, 'Selector page');
		assert.deepEqual((await call(`${base}/api/startup`)).json.recent, [{ path: join(music, 'board'), name: 'board', exists: true }]);
	});

	it('forgets a recent folder', async () => {
		const { base, music, session } = await setup();
		await call(`${base}/api/startup/select`, 'POST', { path: join(music, 'board') });
		await phase(session, 'ready');
		await call(`${base}/api/startup/close`, 'POST');
		assert.equal((await call(`${base}/api/startup/recent`, 'DELETE', { path: join(music, 'board') })).status, 204);
		assert.deepEqual((await call(`${base}/api/startup`)).json.recent, []);
	});

	it(`tries the next ports when one is taken, up to ${PORT_ATTEMPTS}`, async () => {
		const port = await findFreePort();
		const blocker = createServer();
		await new Promise((resolve) => blocker.listen(port, '127.0.0.1', () => resolve(undefined)));
		cleanups.push(() => new Promise((resolve) => blocker.close(() => resolve(undefined))));
		const { app } = await setup({ port });
		assert.notEqual(app.port, port);
		assert.ok(app.port > port && app.port < port + PORT_ATTEMPTS);
	});

	it('gives up with the listen error once every port it may try is taken', async () => {
		const first = await findFreePort();
		/** @type {import('node:net').Server[]} */
		const blockers = [];
		for (let offset = 0; offset < PORT_ATTEMPTS; offset++) {
			const blocker = createServer();
			const listening = await new Promise((resolve) => {
				blocker.once('error', () => resolve(false));
				blocker.listen(first + offset, '127.0.0.1', () => resolve(true));
			});
			if (listening) {
				blockers.push(blocker);
			}
		}
		cleanups.push(async () => {
			await Promise.all(blockers.map((blocker) => new Promise((resolve) => blocker.close(() => resolve(undefined)))));
		});
		await assert.rejects(setup({ port: first }), { code: 'EADDRINUSE' });
	});
});

describe('HttpStartupApi and closing through HttpBackendApi, against the app server', () => {
	it('fetches the state, the places and folders, and sends the choices', async () => {
		const { base, music, session } = await setup({ ask: true });
		const api = new HttpStartupApi(base);
		assert.equal((await api.fetchState()).phase, 'selecting');
		assert.deepEqual(await api.fetchPlaces(), [{ name: 'music', path: music }]);
		assert.equal((await api.listFolder(music)).path, music);
		await assert.rejects(api.listFolder(join(music, '..')), new Error(OUTSIDE_REASON));
		await assert.rejects(api.select(join(music, 'empty')), new Error('No audio files found here.'));
		await api.select(join(music, 'board'));
		await question(session);
		await api.answer(1, false);
		await phase(session, 'selecting');
		await api.select(join(music, 'board'));
		await question(session);
		await api.back();
		await phase(session, 'selecting');
		await assert.rejects(api.retry(), /Not possible while the soundboard is being chosen/);
		await assert.rejects(api.deleteAndRetry(), /Not possible/);
		await api.forgetRecent(join(music, 'board'));
	});

	it('closes the soundboard, and rejects with the server’s message when none is open', async () => {
		const { base, music, session } = await setup();
		const api = new HttpBackendApi(base);
		await assert.rejects(api.closeSoundboard(), /Not possible while the soundboard is being chosen/);
		await new HttpStartupApi(base).select(join(music, 'board'));
		await phase(session, 'ready');
		await api.closeSoundboard();
		assert.equal(session.phase, 'selecting');
	});
});

/** An IPv4 address of this machine that isn't the loopback one, for requests that count as another device. */
const networkAddress = Object.values(networkInterfaces()).flat().find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;

describe('startApp with --lan, seen from another device', { skip: networkAddress === undefined && 'this machine has no network address' }, () => {
	const address = /** @type {string} */ (networkAddress);
	const lan = { address: '0.0.0.0', addresses: [address], names: [address] };

	it('gives only the waiting page until a soundboard is open, then hands requests to the soundboard', async () => {
		const { app, base, music, session } = await setup({ lan });
		const remote = `http://${address}:${app.port}`;
		assert.equal((await call(`${remote}/`)).text, 'Waiting page');
		assert.equal((await call(`${remote}/favicon.svg`)).text, '<svg/>');
		assert.equal((await call(`${remote}/app/selector.js`)).status, 403);
		assert.equal((await call(`${remote}/api/startup`)).status, 503);
		assert.equal((await call(`${remote}/api/info`)).status, 503);
		assert.deepEqual((await call(`${remote}/api/startup/ready`)).json, { ready: false });
		await call(`${base}/api/startup/select`, 'POST', { path: join(music, 'board') });
		await phase(session, 'ready');
		assert.deepEqual((await call(`${remote}/api/startup/ready`)).json, { ready: true });
		assert.equal((await call(`${remote}/`)).text, 'board /');
		assert.equal((await call(`${remote}/api/startup/close`, 'POST')).text, 'board /api/startup/close');
	});

	it('gives the Selector and its routes to every device with --UNSAFE-lan-manager', async () => {
		const { app, music, session } = await setup({ lan, lanManager: true });
		const remote = `http://${address}:${app.port}`;
		assert.equal((await call(`${remote}/`)).text, 'Selector page');
		assert.equal((await call(`${remote}/api/startup`)).json.phase, 'selecting');
		assert.equal((await call(`${remote}/api/startup/select`, 'POST', { path: join(music, 'board') })).status, 204);
		await phase(session, 'ready');
		assert.equal((await call(`${remote}/`)).text, 'board /');
	});
});
