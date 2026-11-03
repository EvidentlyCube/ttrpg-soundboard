import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { startServer } from '../../../src/http/server.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ChangeWatcher } from '../../../src/library/change-watcher.js';
import { FakeClock } from '../../helpers/fake-clock.js';
import { fakeProcessRunner } from '../../helpers/fake-process-runner.js';
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

const VIDEO_JSON = { _type: 'video', id: 'zoo', title: 'Me at the zoo', duration: 19, filesize: 1000, extractor_key: 'Youtube', webpage_url: 'https://www.youtube.com/watch?v=zoo', chapters: [] };

/**
 * Plays yt-dlp and ffmpeg: a lookup prints the video, a download or conversion writes its file.
 * @type {import('../../helpers/fake-process-runner.js').FakeProgram}
 */
async function tools(command, args, process) {
	if (command === 'yt-dlp' && args.includes('-J')) {
		return args.at(-1)?.includes('unsupported')
			? (process.line('ERROR: [generic] Unsupported URL'), { code: 1 })
			: { stdout: JSON.stringify(VIDEO_JSON) };
	}
	if (command === 'yt-dlp') {
		process.line('[download] 100%');
		await writeFile(join(args[args.indexOf('-P') + 1], 'Me at the zoo [zoo].webm'), 'webm');
		return { code: 0 };
	}
	await writeFile(/** @type {string} */ (args.at(-1)), 'ogg');
	return { code: 0 };
}

/** @type {import('../../../src/downloads/link-fetcher.js').LinkFetcher} */
const NOT_A_FILE = { inspect: async () => null, download: async () => {} };

/** @param {{ downloads?: boolean, toolsFound?: boolean }} [options] */
async function setup({ downloads = true, toolsFound = true } = {}) {
	const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom', 'Combat': { '1.mp3': 'one' } });
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
		downloads: downloads
			? { tools: toolsFound ? { ytDlp: '2026.08.19', ffmpeg: '7.1' } : { ytDlp: null, ffmpeg: null }, run: fakeProcessRunner(tools).run, fetcher: NOT_A_FILE }
			: undefined,
	});
	cleanups.push(() => server.close());
	/**
	 * @param {string} path
	 * @param {{ method?: string, body?: unknown }} [init]
	 */
	const call = async (path, { method = 'GET', body } = {}) => {
		const response = await fetch(server.url + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
		const text = await response.text();
		return { status: response.status, body: /** @type {any} */ (text === '' ? null : JSON.parse(text)) };
	};
	return { server, watcher, call };
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

describe('downloads over HTTP', () => {
	it('reports the tools and that nothing runs', async () => {
		const { call } = await setup();
		assert.deepEqual(await call('/api/download'), { status: 200, body: { tools: { ytDlp: '2026.08.19', ffmpeg: '7.1' }, job: null } });
	});

	it("looks a link up, or says why it can't", async () => {
		const { call } = await setup();
		const found = await call('/api/download/probe', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=zoo' } });
		assert.equal(found.status, 200);
		assert.equal(found.body.kind, 'video');
		assert.equal(typeof found.body.probeId, 'string');
		assert.deepEqual(await call('/api/download/probe', { method: 'POST', body: { url: 'https://unsupported.example/' } }), { status: 422, body: { error: '[generic] Unsupported URL' } });
		assert.equal((await call('/api/download/probe', { method: 'POST', body: { url: 'ftp://x' } })).status, 422);
		assert.equal((await call('/api/download/probe', { method: 'POST', body: {} })).status, 400);
	});

	it('downloads, streams the progress and the addition, and counts nothing as an external change', async () => {
		const { server, watcher, call } = await setup();
		const events = openEvents(server.url);
		await events.until((message) => message.type === 'download');
		const { body: probe } = await call('/api/download/probe', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=zoo' } });
		const started = await call('/api/download', { method: 'POST', body: { probeId: probe.probeId, target: { kind: 'sound' } } });
		assert.equal(started.status, 202);
		assert.equal(started.body.state, 'running');
		assert.equal((await call('/api/download', { method: 'POST', body: { probeId: probe.probeId, target: { kind: 'sound' } } })).status, 409);

		await events.until((message) => message.type === 'download' && message.job?.state === 'done');
		const added = events.messages.find((message) => message.type === 'library.added');
		assert.equal(added.sound.id, 'Me at the zoo [zoo].opus');
		assert.equal(added.sound.url, '/media/Me%20at%20the%20zoo%20%5Bzoo%5D.opus');
		assert.ok(events.messages.some((message) => message.type === 'download.log' && message.lines.includes('[download] 100%')));
		const library = await call('/api/library');
		assert.ok(library.body.sounds.some((/** @type {{ id: string }} */ sound) => sound.id === 'Me at the zoo [zoo].opus'));
		assert.equal(await watcher.check(), false);

		const current = await call('/api/download');
		assert.equal(current.body.job.state, 'done');
		assert.ok(current.body.job.log.includes('[download] 100%'));
		assert.equal((await call('/api/download', { method: 'DELETE' })).status, 204);
		assert.equal((await call('/api/download')).body.job, null);
	});

	it('starts every event stream with the download and its whole log', async () => {
		const { server, call } = await setup();
		const { body: probe } = await call('/api/download/probe', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=zoo' } });
		await call('/api/download', { method: 'POST', body: { probeId: probe.probeId, target: { kind: 'sound' } } });
		while ((await call('/api/download')).body.job.state === 'running') {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const events = openEvents(server.url);
		await events.until((message) => message.type === 'download');
		const first = events.messages.find((message) => message.type === 'download');
		assert.equal(first.job.state, 'done');
		assert.equal(first.job.log, undefined);
		assert.ok(first.log.includes('[download] 100%'));
	});

	it('checks what a download asks for', async () => {
		const { call } = await setup();
		assert.equal((await call('/api/download', { method: 'POST', body: { target: { kind: 'sound' } } })).status, 400);
		assert.deepEqual(await call('/api/download', { method: 'POST', body: { probeId: 'old', target: { kind: 'sound' } } }), {
			status: 400,
			body: { error: 'That lookup is too old. Look the link up again.', code: 'download.oldLookup', params: {} },
		});
		assert.equal((await call('/api/download', { method: 'PUT' })).status, 405);
	});

	it('refuses without the tools, or without downloads at all', async () => {
		const missing = await setup({ toolsFound: false });
		assert.equal((await missing.call('/api/download/probe', { method: 'POST', body: { url: 'https://x/' } })).status, 503);
		const none = await setup({ downloads: false });
		assert.deepEqual((await none.call('/api/download')).body, { tools: { ytDlp: null, ffmpeg: null }, job: null });
		assert.equal((await none.call('/api/download/probe', { method: 'POST', body: { url: 'https://x/' } })).status, 503);
	});
});
