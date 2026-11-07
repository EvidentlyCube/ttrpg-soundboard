import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchImage, ImageLinkError, imageLinkOf } from '../../../src/downloads/image-download.js';

/** @type {(() => Promise<unknown>)[]} */
const cleanups = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		await cleanup();
	}
});

describe('imageLinkOf', () => {
	it('takes http and https links, trimmed', () => {
		assert.equal(imageLinkOf('  https://example.com/a.png ').href, 'https://example.com/a.png');
		assert.equal(imageLinkOf('http://example.com/').protocol, 'http:');
	});

	it('refuses other schemes and text that is not a link', () => {
		for (const text of ['file:///etc/passwd', 'data:image/png;base64,AAAA', 'ftp://example.com/a.png', 'not a link']) {
			assert.throws(() => imageLinkOf(text), (error) => error instanceof ImageLinkError && error.messageCode === 'imageLink.notHttp', text);
		}
	});
});

describe('fetchImage', () => {
	it('gives up on a server that never answers, saying it took too long', async () => {
		const server = createServer(() => {
			// Never answers.
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
		cleanups.push(() => new Promise((resolve) => {
			server.closeAllConnections();
			server.close(resolve);
		}));
		const directory = await mkdtemp(join(tmpdir(), 'image-download-'));
		cleanups.push(() => rm(directory, { recursive: true, force: true }));
		const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
		await assert.rejects(
			fetchImage(`http://127.0.0.1:${port}/slow.png`, join(directory, 'a.part'), { signal: new AbortController().signal, timeoutMs: 50 }),
			(error) => error instanceof ImageLinkError && error.messageCode === 'imageLink.timeout',
		);
	});
});
