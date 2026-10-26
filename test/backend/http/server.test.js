import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { startServer } from '../../../src/http/server.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { rawRequest } from '../../helpers/http-client.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** Bytes that cannot be mistaken for a tag, so every byte position is easy to check. */
const AUDIO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const LARGE_AUDIO = Buffer.alloc(4 * 1024 * 1024, 7);

/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
let tree;
/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let musicRoot;
/** @type {unknown[]} */
const loggedErrors = [];
/** @type {string[]} */
const loggedRequests = [];

/**
 * Responses are logged when the server finishes them, which can be just after the client has the body.
 * @param {RegExp} pattern
 */
async function waitForLoggedRequest(pattern) {
	for (let attempt = 0; attempt < 50; attempt++) {
		const line = loggedRequests.find((entry) => pattern.test(entry));
		if (line) {
			return line;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.fail(`No logged request matches ${pattern}; got:\n${loggedRequests.join('\n')}`);
}

before(async () => {
	tree = await createTmpTree({
		'secret.txt': 'top secret',
		'music': {
			'.soundboard': JSON.stringify({ version: 1, volumes: { music: 0.5 }, futureKey: 'kept' }),
			'Boom.mp3': AUDIO,
			'Boom.mp3.json': JSON.stringify({ title: 'Big Boom' }),
			'Long.ogg': LARGE_AUDIO,
			'Combat': { 'Zażółć ♪ #1.ogg': AUDIO },
		},
		'public': {
			'index.html': '<!doctype html><title>Test</title>',
			'styles.css': 'body {}',
			'app': { 'main.js': 'export {};' },
		},
	});
	musicRoot = join(tree.root, 'music');
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(musicRoot);
	assert.equal(outcome.status, 'ready');
	server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		port: 0,
		publicDir: join(tree.root, 'public'),
		logError: (error) => loggedErrors.push(error),
		logRequest: (line) => loggedRequests.push(line),
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
function get(path, init) {
	return fetch(`${server.url}${path}`, init);
}

/**
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function json(response) {
	return response.json();
}

/** @param {unknown} body */
function putVolumes(body) {
	return get('/api/settings/volumes', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('server', () => {
	it('listens on the loopback address', () => {
		assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
	});

	describe('static files', () => {
		it('serves index.html for the root path', async () => {
			const response = await get('/');
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
			assert.equal(await response.text(), '<!doctype html><title>Test</title>');
		});

		it('serves nested files with their content type', async () => {
			const response = await get('/app/main.js');
			assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
			assert.equal(await response.text(), 'export {};');
		});

		it('answers HEAD without a body', async () => {
			const response = await rawRequest(server.url, '/styles.css', { method: 'HEAD' });
			assert.equal(response.status, 200);
			assert.equal(response.headers['content-length'], '7');
			assert.equal(response.body.length, 0);
		});

		it('returns 404 for missing files and directories', async () => {
			assert.equal((await get('/missing.js')).status, 404);
			assert.equal((await get('/app')).status, 404);
		});

		it('never serves files outside the public directory', async () => {
			for (const path of [
				'/../secret.txt',
				'/%2e%2e/secret.txt',
				'/..%2fsecret.txt',
				'/app/..%2f..%2fsecret.txt',
				'/..%5csecret.txt',
				'/%2e%2e%2fmusic%2fBoom.mp3',
				'/index.html%00.js',
				'/%E0%A4%A',
			]) {
				const response = await rawRequest(server.url, path);
				assert.notEqual(response.status, 200, path);
				assert.doesNotMatch(response.body.toString(), /top secret/, path);
			}
		});

		it('rejects other methods', async () => {
			const response = await get('/', { method: 'POST' });
			assert.equal(response.status, 405);
			assert.equal(response.headers.get('allow'), 'GET, HEAD');
		});
	});

	describe('GET /api/library', () => {
		it('lists playlists and sounds with encoded media URLs', async () => {
			const response = await get('/api/library');
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('cache-control'), 'no-store');
			assert.deepEqual(await response.json(), {
				version: 1,
				playlists: [{
					id: 'Combat',
					title: 'Combat',
					tracks: [{
						id: 'Combat/Zażółć ♪ #1.ogg',
						title: 'Zażółć ♪ #1.ogg',
						format: 'ogg',
						size: 1000,
						url: '/media/Combat/Za%C5%BC%C3%B3%C5%82%C4%87%20%E2%99%AA%20%231.ogg',
					}],
				}],
				sounds: [
					{ id: 'Boom.mp3', title: 'Big Boom', format: 'mp3', size: 1000, url: '/media/Boom.mp3' },
					{ id: 'Long.ogg', title: 'Long.ogg', format: 'ogg', size: LARGE_AUDIO.length, url: '/media/Long.ogg' },
				],
			});
		});
	});

	describe('settings', () => {
		it('returns the current settings', async () => {
			const response = await get('/api/settings');
			assert.equal(response.headers.get('cache-control'), 'no-store');
			assert.deepEqual((await json(response)).volumes.music, 0.5);
		});

		it('saves a volume change and returns the full settings', async () => {
			const response = await putVolumes({ sfx: 0.25 });
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), { volumes: { master: 1, music: 0.5, sfx: 0.25 } });
			assert.deepEqual(JSON.parse(await readFile(join(musicRoot, '.soundboard'), 'utf8')), {
				version: 1,
				volumes: { master: 1, music: 0.5, sfx: 0.25 },
				futureKey: 'kept',
			});
		});

		it('rejects invalid volume changes with 400', async () => {
			/** @type {[unknown, RegExp][]} */
			const cases = [
				['{ nope', /not valid JSON/],
				[[0.5], /must be a JSON object/],
				[{ music: 2 }, /"music" must be a number from 0 to 1/],
				[{ music: 0.1, loud: 1 }, /Unknown volume "loud"/],
			];
			for (const [body, message] of cases) {
				const response = await putVolumes(body);
				assert.equal(response.status, 400, JSON.stringify(body));
				assert.match((await json(response)).error, message);
			}
			assert.equal((await json(await get('/api/settings'))).volumes.music, 0.5);
		});

		it('rejects oversized bodies with 413', async () => {
			const response = await putVolumes(JSON.stringify({ music: 0.5, padding: 'x'.repeat(20_000) }));
			assert.equal(response.status, 413);
		});

		it('only allows PUT for volumes and GET for settings', async () => {
			assert.equal((await get('/api/settings/volumes')).status, 405);
			assert.equal((await get('/api/settings', { method: 'PUT', body: '{}' })).status, 405);
		});

		it('returns 404 for unknown API paths', async () => {
			const response = await get('/api/nothing');
			assert.equal(response.status, 404);
			assert.deepEqual(await response.json(), { error: 'Not found' });
		});
	});

	describe('media', () => {
		it('streams a whole file with caching and range headers', async () => {
			const response = await get('/media/Boom.mp3');
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('content-type'), 'audio/mpeg');
			assert.equal(response.headers.get('accept-ranges'), 'bytes');
			assert.equal(response.headers.get('content-length'), '1000');
			assert.match(response.headers.get('etag') ?? '', /^"[0-9a-f]+-[0-9a-f]+"$/);
			assert.ok(response.headers.get('last-modified'));
			assert.deepEqual(Buffer.from(await response.arrayBuffer()), AUDIO);
		});

		it('streams a byte range', async () => {
			const response = await get('/media/Boom.mp3', { headers: { Range: 'bytes=100-199' } });
			assert.equal(response.status, 206);
			assert.equal(response.headers.get('content-range'), 'bytes 100-199/1000');
			assert.equal(response.headers.get('content-length'), '100');
			assert.deepEqual(Buffer.from(await response.arrayBuffer()), AUDIO.subarray(100, 200));
		});

		it('streams open-ended and suffix ranges', async () => {
			const open = await get('/media/Boom.mp3', { headers: { Range: 'bytes=990-' } });
			assert.equal(open.headers.get('content-range'), 'bytes 990-999/1000');
			assert.deepEqual(Buffer.from(await open.arrayBuffer()), AUDIO.subarray(990));

			const suffix = await get('/media/Boom.mp3', { headers: { Range: 'bytes=-5' } });
			assert.equal(suffix.headers.get('content-range'), 'bytes 995-999/1000');
			assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), AUDIO.subarray(995));
		});

		it('logs each request with its range when asked to', async () => {
			await (await get('/media/Boom.mp3?logged', { headers: { Range: 'bytes=0-9' } })).arrayBuffer();
			assert.match(await waitForLoggedRequest(/\?logged/), /^GET \/media\/Boom\.mp3\?logged 206 bytes=0-9 \d+ms$/);
		});

		it('answers an unsatisfiable range with 416', async () => {
			const response = await get('/media/Boom.mp3', { headers: { Range: 'bytes=5000-' } });
			assert.equal(response.status, 416);
			assert.equal(response.headers.get('content-range'), 'bytes */1000');
		});

		it('answers HEAD with the same headers and no body', async () => {
			const response = await rawRequest(server.url, '/media/Boom.mp3', { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
			assert.equal(response.status, 206);
			assert.equal(response.headers['content-length'], '10');
			assert.equal(response.headers['content-range'], 'bytes 0-9/1000');
			assert.equal(response.body.length, 0);
		});

		it('finds files by their percent-encoded id', async () => {
			const response = await get('/media/Combat/Za%C5%BC%C3%B3%C5%82%C4%87%20%E2%99%AA%20%231.ogg');
			assert.equal(response.status, 200);
			assert.equal(response.headers.get('content-type'), 'audio/ogg');
		});

		it('serves only files in the library', async () => {
			for (const path of [
				'/media/Boom.mp3.json',
				'/media/.soundboard',
				'/media/../secret.txt',
				'/media/..%2fsecret.txt',
				'/media/Missing.mp3',
				'/media/%E0%A4%A',
				'/media/',
			]) {
				const response = await rawRequest(server.url, path);
				assert.equal(response.status, 404, path);
			}
		});

		it('rejects other methods', async () => {
			const response = await get('/media/Boom.mp3', { method: 'DELETE' });
			assert.equal(response.status, 405);
			assert.equal(response.headers.get('allow'), 'GET, HEAD');
		});

		it('keeps working after a client disconnects mid-stream', async () => {
			await new Promise((resolve, reject) => {
				const { hostname, port } = new URL(server.url);
				const outgoing = request({ hostname, port, path: '/media/Long.ogg' }, (response) => {
					response.once('data', () => {
						outgoing.destroy();
						resolve(undefined);
					});
				});
				outgoing.on('error', (error) => {
					if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ECONNRESET') {
						reject(error);
					}
				});
				outgoing.end();
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert.equal((await get('/media/Boom.mp3', { headers: { Range: 'bytes=0-0' } })).status, 206);
			assert.deepEqual(loggedErrors, []);
			assert.match(await waitForLoggedRequest(/^GET \/media\/Long\.ogg /), /^GET \/media\/Long\.ogg 200 \d+ms \(aborted\)$/);
		});
	});
});

describe('startServer', () => {
	it('fails when the port is already in use', async () => {
		const port = Number(new URL(server.url).port);
		const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(musicRoot);
		assert.equal(outcome.status, 'ready');
		await assert.rejects(
			startServer({ library: outcome.library, settings: outcome.settings, port, logError: () => {} }),
			{ code: 'EADDRINUSE' },
		);
	});
});
