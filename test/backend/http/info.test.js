import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from '../../../src/http/server.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

const APP_VERSION = JSON.parse(await readFile(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8')).version;

/** @type {import('../../../src/downloads/yt-dlp-update.js').YtDlpUpdate} */
const OUTDATED = { state: 'outdated', current: '2026.10.21', latest: '2026.10.26', error: 'Insufficient permissions to write to /usr/bin' };

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

/** @param {import('../../../src/http/server.js').ServerOptions['downloads']} downloads */
async function setup(downloads) {
	const tree = await createTmpTree({
		music: { '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom' },
		public: {
			'index.html': '<!doctype html><title>App</title>',
			'initializing.html': '<!doctype html><title>Initializing</title>',
			'favicon.svg': '<svg/>',
		},
	});
	cleanups.push(() => tree.remove());
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(join(tree.root, 'music'));
	assert.equal(outcome.status, 'ready');
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		problems: outcome.problems,
		port: 0,
		publicDir: join(tree.root, 'public'),
		logError: (error) => assert.fail(String(error)),
		downloads,
	});
	cleanups.push(() => server.close());
	return server;
}

describe('starting up', () => {
	it('shows the initializing page and refuses the API until the tools are ready', async () => {
		/** @type {(ports: import('../../../src/http/server.js').DownloadPorts) => void} */
		let finish = () => {};
		const server = await setup(() => new Promise((resolve) => {
			finish = resolve;
		}));

		for (const path of ['/', '/index.html', '/connect']) {
			assert.match(await (await fetch(`${server.url}${path}`)).text(), /Initializing/, path);
		}
		assert.equal((await fetch(`${server.url}/favicon.svg`)).status, 200);
		const api = await fetch(`${server.url}/api/library`);
		assert.equal(api.status, 503);
		assert.equal(api.headers.get('retry-after'), '1');

		finish({ tools: { ytDlp: '2026.10.21', ffmpeg: '8.1' }, update: OUTDATED });
		await server.ready;
		assert.match(await (await fetch(`${server.url}/`)).text(), /App/);
		assert.equal((await fetch(`${server.url}/api/library`)).status, 200);
	});

	it('reports the versions and the update, and lists a failed update as a problem', async () => {
		const server = await setup(async () => ({ tools: { ytDlp: '2026.10.21', ffmpeg: '8.1' }, update: OUTDATED }));
		await server.ready;
		assert.deepEqual(await (await fetch(`${server.url}/api/info`)).json(), {
			app: APP_VERSION,
			ytDlp: { version: '2026.10.21', update: OUTDATED },
			ffmpeg: '8.1',
		});
		const events = await fetch(`${server.url}/api/events`);
		const reader = /** @type {ReadableStream<Uint8Array>} */ (events.body).getReader();
		let text = '';
		while (!text.includes('"type":"problems"')) {
			text += new TextDecoder().decode((await reader.read()).value);
		}
		await reader.cancel();
		assert.match(text, /"id":"ytdlp-outdated:yt-dlp"/);
	});

	it('reports missing tools as null, without an update', async () => {
		const server = await setup(undefined);
		assert.deepEqual(await (await fetch(`${server.url}/api/info`)).json(), {
			app: APP_VERSION,
			ytDlp: { version: null, update: null },
			ffmpeg: null,
		});
	});
});
