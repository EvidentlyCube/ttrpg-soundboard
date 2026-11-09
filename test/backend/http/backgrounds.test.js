import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { startServer } from '../../../src/http/server.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
import { ChangeWatcher } from '../../../src/library/change-watcher.js';
import { MAX_IMAGE_BYTES } from '../../../src/library/image-info.js';
import { FakeClock } from '../../helpers/fake-clock.js';
import { FakePrompter } from '../../helpers/fake-prompter.js';
import { FakeReporter } from '../../helpers/fake-reporter.js';
import { gifBytes, jpegBytes, pngBytes } from '../../helpers/image-bytes.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} [extra] more files in the root */
async function setup(extra = {}) {
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Combat': { '1.mp3': 'one' },
		...extra,
	});
	cleanups.push(() => tree.remove());
	const root = tree.root;
	const watcher = new ChangeWatcher({ root, log: () => {}, watch: () => ({ on: () => {}, close: () => {} }), timers: new FakeClock() });
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(root);
	if (outcome.status !== 'ready') {
		throw new Error(`bootstrap ended with ${outcome.status}`);
	}
	await watcher.start(outcome.scan);
	cleanups.push(async () => watcher.stop());
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		problems: outcome.problems,
		port: 0,
		logError: (error) => assert.fail(String(error)),
		watcher,
	});
	cleanups.push(() => server.close());
	return { root, server, watcher, library: outcome.library };
}

/**
 * @param {string} baseUrl
 * @param {Uint8Array} bytes
 * @param {string} type
 */
async function upload(baseUrl, bytes, type, playlistId = 'Combat') {
	const response = await fetch(`${baseUrl}/api/playlists/${playlistId}/background`, { method: 'PUT', headers: { 'Content-Type': type }, body: bytes });
	return { status: response.status, body: /** @type {any} */ (await response.json()) };
}

/**
 * @param {string} baseUrl
 * @param {string} url
 */
async function download(baseUrl, url, playlistId = 'Combat') {
	const response = await fetch(`${baseUrl}/api/playlists/${playlistId}/background/download`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url }),
	});
	return { status: response.status, body: /** @type {any} */ (await response.json()) };
}

/**
 * A local server for downloads, answering each path with its handler.
 * @param {Record<string, import('node:http').RequestListener>} routes
 */
async function imageServer(routes) {
	/** @type {import('node:http').IncomingHttpHeaders[]} */
	const requests = [];
	const server = createServer((incoming, outgoing) => {
		requests.push(incoming.headers);
		const handler = routes[incoming.url ?? ''];
		if (handler) {
			handler(incoming, outgoing);
		} else {
			outgoing.writeHead(404).end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	cleanups.push(() => new Promise((resolve) => {
		server.closeAllConnections();
		server.close(resolve);
	}));
	const address = /** @type {import('node:net').AddressInfo} */ (server.address());
	return { url: `http://127.0.0.1:${address.port}`, requests };
}

/**
 * Answers with an image of a type.
 * @param {Uint8Array} bytes
 * @param {string} type
 * @returns {import('node:http').RequestListener}
 */
const serve = (bytes, type) => (_incoming, outgoing) => {
	outgoing.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length }).end(bytes);
};

/** @param {string} root */
async function backgroundFiles(root) {
	return (await readdir(root)).filter((name) => name.includes('.bg.')).sort();
}

/** @param {string} root what is left in the work folder of image downloads and uploads */
async function workFiles(root) {
	return readdir(join(root, '.soundboard-downloads', 'images')).catch(() => []);
}

/**
 * The problems list as the event stream sends it now.
 * @param {string} baseUrl
 * @returns {Promise<{ kind: string, path: string }[]>}
 */
function currentProblems(baseUrl) {
	return new Promise((resolve, reject) => {
		let buffer = '';
		const outgoing = request(`${baseUrl}/api/events`, (response) => {
			response.setEncoding('utf8');
			response.on('data', (/** @type {string} */ chunk) => {
				buffer += chunk;
				for (const block of buffer.split('\n\n').filter((text) => text.startsWith('data: '))) {
					const message = JSON.parse(block.slice('data: '.length));
					if (message.type === 'problems') {
						outgoing.destroy();
						resolve(message.problems.filter((/** @type {{ kind: string }} */ problem) => problem.kind.endsWith('-background')));
						return;
					}
				}
			});
		});
		outgoing.on('error', reject);
		outgoing.end();
	});
}

describe('uploading a playlist image', () => {
	it('stores the image and answers with the playlist and its image', async () => {
		const { root, server } = await setup();
		const { status, body } = await upload(server.url, pngBytes(64, 48), 'image/png');
		assert.equal(status, 200);
		assert.equal(body.id, 'Combat');
		assert.equal(body.background.width, 64);
		assert.equal(body.background.height, 48);
		assert.match(body.background.url, /^\/api\/playlists\/Combat\/background\?v=[0-9a-f]+-[0-9a-f]+$/);
		assert.deepEqual(await backgroundFiles(root), ['Combat.bg.png']);
		assert.deepEqual(await workFiles(root), []);
	});

	it('records its own write, so the image is not an external change', async () => {
		const { server, watcher } = await setup();
		await upload(server.url, pngBytes(64, 48), 'image/png');
		assert.equal(await watcher.check(), false);
	});

	it('counts an image placed by hand as an external change', async () => {
		const { root, watcher } = await setup();
		await writeFile(join(root, 'Combat.bg.png'), pngBytes(64, 48));
		assert.equal(await watcher.check(), true);
	});

	it('refuses a type that is not one of the five with 415', async () => {
		const { root, server } = await setup();
		const { status } = await upload(server.url, Buffer.from('<svg/>'), 'image/svg+xml');
		assert.equal(status, 415);
		assert.deepEqual(await backgroundFiles(root), []);
	});

	it('refuses bytes that are not the type the file claims with 422, and deletes them', async () => {
		const { root, server } = await setup();
		const { status, body } = await upload(server.url, jpegBytes(10, 10), 'image/png');
		assert.equal(status, 422);
		assert.equal(body.code, 'image.mismatch');
		assert.deepEqual(await backgroundFiles(root), []);
		assert.deepEqual(await workFiles(root), []);
	});

	it('refuses an image over 8192 px with 422', async () => {
		const { server } = await setup();
		const { status, body } = await upload(server.url, pngBytes(9000, 10), 'image/png');
		assert.equal(status, 422);
		assert.equal(body.code, 'image.dimensions');
	});

	it('refuses a body over 16 MB with 413', async () => {
		const { root, server } = await setup();
		const { status, body } = await upload(server.url, Buffer.concat([pngBytes(10, 10), Buffer.alloc(MAX_IMAGE_BYTES)]), 'image/png');
		assert.equal(status, 413);
		assert.equal(body.code, 'image.tooLarge');
		assert.deepEqual(await workFiles(root), []);
	});

	it('refuses an unknown playlist with 404', async () => {
		const { server } = await setup();
		assert.equal((await upload(server.url, pngBytes(10, 10), 'image/png', 'Nowhere')).status, 404);
	});

	it('warns about an image larger than 1080p until it is replaced', async () => {
		const { server } = await setup();
		await upload(server.url, pngBytes(4000, 3000), 'image/png');
		assert.deepEqual((await currentProblems(server.url)).map((problem) => [problem.kind, problem.path]), [['large-background', 'Combat.bg.png']]);
		await upload(server.url, gifBytes(100, 100), 'image/gif');
		assert.deepEqual(await currentProblems(server.url), []);
	});
});

describe('downloading a playlist image', () => {
	it('stores the image under the format its bytes have, asking for no compression', async () => {
		const images = await imageServer({ '/photo': serve(gifBytes(20, 10), 'image/gif') });
		const { root, server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/photo`);
		assert.equal(status, 200);
		assert.equal(body.background.width, 20);
		assert.deepEqual(await backgroundFiles(root), ['Combat.bg.gif']);
		assert.equal(images.requests[0]['accept-encoding'], 'identity');
		assert.match(images.requests[0].accept ?? '', /image\/avif/);
	});

	it('takes a link whose extension the server overrules with another type', async () => {
		const images = await imageServer({ '/photo.jpg': serve(pngBytes(20, 10), 'image/png') });
		const { root, server } = await setup();
		assert.equal((await download(server.url, `${images.url}/photo.jpg`)).status, 200);
		assert.deepEqual(await backgroundFiles(root), ['Combat.bg.png']);
	});

	it('refuses a link whose extension and type agree but the bytes do not', async () => {
		const images = await imageServer({ '/photo.jpg': serve(pngBytes(20, 10), 'image/jpeg') });
		const { root, server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/photo.jpg`);
		assert.equal(status, 422);
		assert.equal(body.code, 'image.mismatch');
		assert.deepEqual(await backgroundFiles(root), []);
		assert.deepEqual(await workFiles(root), []);
	});

	it('refuses a link that is not http or https', async () => {
		const { server } = await setup();
		const { status, body } = await download(server.url, 'file:///etc/passwd');
		assert.equal(status, 422);
		assert.equal(body.code, 'imageLink.notHttp');
	});

	it('refuses a server error, naming the status', async () => {
		const images = await imageServer({});
		const { server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/missing.png`);
		assert.equal(status, 422);
		assert.equal(body.code, 'imageLink.failed');
	});

	it('refuses a redirect to another scheme', async () => {
		const images = await imageServer({
			'/away': (_incoming, outgoing) => outgoing.writeHead(302, { Location: 'file:///etc/passwd' }).end(),
		});
		const { server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/away`);
		assert.equal(status, 422);
		assert.equal(body.code, 'imageLink.unreachable');
	});

	it('refuses a Content-Length over 16 MB at once', async () => {
		const images = await imageServer({
			'/huge': (_incoming, outgoing) => {
				outgoing.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': MAX_IMAGE_BYTES + 1 });
				outgoing.write(pngBytes(10, 10));
			},
		});
		const { root, server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/huge`);
		assert.equal(status, 413);
		assert.equal(body.code, 'image.tooLarge');
		assert.deepEqual(await workFiles(root), []);
	});

	it('stops a body without a length at the first byte past 16 MB', async () => {
		const images = await imageServer({
			'/endless': (_incoming, outgoing) => {
				outgoing.writeHead(200, { 'Content-Type': 'image/png' });
				outgoing.write(pngBytes(10, 10));
				const chunk = Buffer.alloc(1024 * 1024);
				const pump = () => {
					while (!outgoing.destroyed && outgoing.write(chunk)) {
						// Writes until the socket pushes back.
					}
					if (!outgoing.destroyed) {
						outgoing.once('drain', pump);
					}
				};
				pump();
			},
		});
		const { server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/endless`);
		assert.equal(status, 413);
		assert.equal(body.code, 'image.tooLarge');
	});

	it('counts the bytes after decompression, so a gzip bomb is stopped', async () => {
		const { gzipSync } = await import('node:zlib');
		const bomb = gzipSync(Buffer.concat([pngBytes(10, 10), Buffer.alloc(MAX_IMAGE_BYTES + 1024)]));
		const images = await imageServer({
			'/bomb': (_incoming, outgoing) => {
				outgoing.writeHead(200, { 'Content-Type': 'image/png', 'Content-Encoding': 'gzip', 'Content-Length': bomb.length }).end(bomb);
			},
		});
		const { server } = await setup();
		const { status, body } = await download(server.url, `${images.url}/bomb`);
		assert.equal(bomb.length < MAX_IMAGE_BYTES, true);
		assert.equal(status, 413);
		assert.equal(body.code, 'image.tooLarge');
	});

	it('runs one download per playlist at a time', async () => {
		/** @type {() => void} */
		let release = () => {};
		const images = await imageServer({
			'/slow': (_incoming, outgoing) => {
				release = () => serve(pngBytes(10, 10), 'image/png')(_incoming, outgoing);
			},
		});
		const { server } = await setup();
		const first = download(server.url, `${images.url}/slow`);
		while (images.requests.length === 0) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const second = await download(server.url, `${images.url}/slow`);
		assert.equal(second.status, 409);
		release();
		assert.equal((await first).status, 200);
	});
});

describe('serving and removing a playlist image', () => {
	it('serves the image with headers that keep it an image', async () => {
		const bytes = pngBytes(10, 10);
		const { server } = await setup({ 'Combat.bg.png': bytes });
		const response = await fetch(`${server.url}/api/playlists/Combat/background`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), 'image/png');
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox");
		assert.equal(response.headers.get('cache-control'), 'no-cache');
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
		const again = await fetch(`${server.url}/api/playlists/Combat/background`, { headers: { 'If-None-Match': response.headers.get('etag') ?? '' } });
		assert.equal(again.status, 304);
	});

	it("serves the same image on the remote's route", async () => {
		const { server } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		const response = await fetch(`${server.url}/api/remote/backgrounds/Combat?v=1`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), 'image/png');
	});

	it('answers 404 for a playlist without an image, on either route', async () => {
		const { server } = await setup();
		assert.equal((await fetch(`${server.url}/api/playlists/Combat/background`)).status, 404);
		assert.equal((await fetch(`${server.url}/api/remote/backgrounds/Combat`)).status, 404);
		assert.equal((await fetch(`${server.url}/api/remote/backgrounds/..%2F.soundboard`)).status, 404);
	});

	it('deletes the image for good and drops its problems', async () => {
		const { root, server } = await setup({ 'Combat.bg.png': pngBytes(4000, 3000) });
		assert.equal((await currentProblems(server.url)).length, 1);
		const response = await fetch(`${server.url}/api/playlists/Combat/background`, { method: 'DELETE' });
		assert.equal(response.status, 200);
		assert.equal(/** @type {any} */ (await response.json()).background, null);
		assert.deepEqual(await backgroundFiles(root), []);
		assert.deepEqual(await currentProblems(server.url), []);
	});

	it('lists the image and the settings in the library, and saves the settings', async () => {
		const { root, server } = await setup({ 'Combat.bg.png': pngBytes(10, 10) });
		const library = /** @type {any} */ (await (await fetch(`${server.url}/api/library`)).json());
		const combat = library.playlists.find((/** @type {{ id: string }} */ playlist) => playlist.id === 'Combat');
		assert.deepEqual({ ...combat.background, url: undefined, version: undefined }, { url: undefined, version: undefined, width: 10, height: 10 });
		assert.equal(combat.imageColorOpacity, 0.6);
		const patched = await fetch(`${server.url}/api/playlists/Combat`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ imageBlur: 12 }),
		});
		assert.equal(/** @type {any} */ (await patched.json()).imageBlur, 12);
		assert.equal(JSON.parse(await readFile(join(root, 'Combat.json'), 'utf8')).imageBlur, 12);
	});
});

describe('sound images', () => {
	const SOUND = { 'Boom.mp3': 'boom' };
	const route = (/** @type {string} */ baseUrl) => `${baseUrl}/api/sounds/Boom.mp3/background`;

	it('uploads an image and answers with the sound and its image, recording its own write', async () => {
		const { root, server, watcher } = await setup(SOUND);
		const response = await fetch(route(server.url), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: pngBytes(64, 48) });
		const body = /** @type {any} */ (await response.json());
		assert.equal(response.status, 200);
		assert.equal(body.id, 'Boom.mp3');
		assert.equal(body.background.width, 64);
		assert.match(body.background.url, /^\/api\/sounds\/Boom\.mp3\/background\?v=[0-9a-f]+-[0-9a-f]+$/);
		assert.equal(body.imageColorOpacity, 0.6);
		assert.deepEqual(await backgroundFiles(root), ['Boom.mp3.bg.png']);
		assert.equal(await watcher.check(), false);
	});

	it('downloads an image from a link', async () => {
		const images = await imageServer({ '/a.png': serve(pngBytes(20, 10), 'image/png') });
		const { root, server } = await setup(SOUND);
		const response = await fetch(`${route(server.url)}/download`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: `${images.url}/a.png` }),
		});
		assert.equal(response.status, 200);
		assert.deepEqual(await backgroundFiles(root), ['Boom.mp3.bg.png']);
	});

	it('refuses an unknown sound with 404', async () => {
		const { server } = await setup(SOUND);
		const response = await fetch(`${server.url}/api/sounds/Nope.mp3/background`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: pngBytes(5, 5) });
		assert.equal(response.status, 404);
	});

	it("serves the image on its own route and the remote's, and lists it in the library", async () => {
		const { server } = await setup({ ...SOUND, 'Boom.mp3.bg.png': pngBytes(10, 10) });
		assert.equal((await fetch(route(server.url))).headers.get('content-type'), 'image/png');
		assert.equal((await fetch(`${server.url}/api/remote/sound-backgrounds/Boom.mp3?v=1`)).status, 200);
		const library = /** @type {any} */ (await (await fetch(`${server.url}/api/library`)).json());
		assert.equal(library.sounds[0].background.width, 10);
	});

	it("answers 404 on the remote's route for a sound without an image, and a playlist's never answers there", async () => {
		const { server } = await setup({ ...SOUND, 'Combat.bg.png': pngBytes(10, 10) });
		assert.equal((await fetch(`${server.url}/api/remote/sound-backgrounds/Boom.mp3`)).status, 404);
		assert.equal((await fetch(`${server.url}/api/remote/sound-backgrounds/Combat`)).status, 404);
	});

	it('saves the settings with the sound', async () => {
		const { root, server } = await setup(SOUND);
		const patched = await fetch(`${server.url}/api/sounds/Boom.mp3`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ titleShadowBlur: 3 }),
		});
		assert.equal(/** @type {any} */ (await patched.json()).titleShadowBlur, 3);
		assert.equal(JSON.parse(await readFile(join(root, 'Boom.mp3.json'), 'utf8')).titleShadowBlur, 3);
	});

	it('deletes the image for good and drops its problems', async () => {
		const { root, server } = await setup({ ...SOUND, 'Boom.mp3.bg.png': pngBytes(4000, 3000) });
		assert.equal((await currentProblems(server.url)).length, 1);
		const response = await fetch(route(server.url), { method: 'DELETE' });
		assert.equal(/** @type {any} */ (await response.json()).background, null);
		assert.deepEqual(await backgroundFiles(root), []);
		assert.deepEqual(await currentProblems(server.url), []);
	});

	it("drops an image's problems when its sound goes to the trash", async () => {
		const { server } = await setup({ ...SOUND, 'Boom.mp3.bg.png': pngBytes(4000, 3000) });
		await fetch(`${server.url}/api/sounds/Boom.mp3`, { method: 'DELETE' });
		assert.deepEqual(await currentProblems(server.url), []);
	});

	it('moves the image into a playlist and back without counting as an external change', async () => {
		const { server, watcher } = await setup({ ...SOUND, 'Boom.mp3.bg.png': pngBytes(10, 10) });
		const move = (/** @type {string} */ id, /** @type {string | null} */ to) => fetch(`${server.url}/api/move`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id, to }),
		});
		assert.equal((await move('Boom.mp3', 'Combat')).status, 200);
		assert.equal(await watcher.check(), false);
		const back = /** @type {any} */ (await (await move('Combat/Boom.mp3', null)).json());
		assert.equal(back.changes.at(-1).sound.background.width, 10);
		assert.equal(await watcher.check(), false);
	});
});
