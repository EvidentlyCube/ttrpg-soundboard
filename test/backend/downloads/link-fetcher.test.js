import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { httpLinkFetcher, nameFromDisposition, nameFromUrl } from '../../../src/downloads/link-fetcher.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('node:http').Server} */
let server;
let base = '';
before(async () => {
	server = createServer((request, response) => {
		switch (request.url) {
			case '/rain':
				response.writeHead(200, { 'Content-Type': 'audio/mpeg; charset=binary', 'Content-Length': '4', 'Content-Disposition': 'attachment; filename="Rain loop.mp3"' });
				response.end('RAIN');
				return;
			case '/grows':
				// Larger now than when it was looked up.
				response.writeHead(200, { 'Content-Type': 'audio/ogg', 'Content-Length': '8' });
				response.end('TOO LONG');
				return;
			default:
				response.writeHead(404);
				response.end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const address = /** @type {import('node:net').AddressInfo} */ (server.address());
	base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

describe('httpLinkFetcher', () => {
	it('reads the type, size and name of a link from its headers', async () => {
		assert.deepEqual(await httpLinkFetcher.inspect(`${base}/rain`), { contentType: 'audio/mpeg', size: 4, name: 'Rain loop.mp3' });
	});

	it('gives nothing for a link that doesn\'t answer successfully', async () => {
		assert.equal(await httpLinkFetcher.inspect(`${base}/missing`), null);
		assert.equal(await httpLinkFetcher.inspect('http://127.0.0.1:1/'), null);
	});

	it('downloads to a file and reports progress', async () => {
		const tree = await createTmpTree({});
		try {
			/** @type {number[]} */
			const progress = [];
			const path = join(tree.root, 'rain.mp3');
			await httpLinkFetcher.download(`${base}/rain`, path, { signal: new AbortController().signal, expectedSize: 4, onProgress: (bytes) => progress.push(bytes) });
			assert.equal(await readFile(path, 'utf8'), 'RAIN');
			assert.equal(progress.at(-1), 4);
		} finally {
			await tree.remove();
		}
	});

	it('stops when more arrives than the lookup announced', async () => {
		const tree = await createTmpTree({});
		try {
			await assert.rejects(
				httpLinkFetcher.download(`${base}/grows`, join(tree.root, 'x.ogg'), { signal: new AbortController().signal, expectedSize: 2, onProgress: () => {} }),
				/larger than the server said/,
			);
		} finally {
			await tree.remove();
		}
	});
});

describe('nameFromDisposition and nameFromUrl', () => {
	it('prefer the encoded name, then the plain one', () => {
		assert.equal(nameFromDisposition('attachment; filename*=UTF-8\'\'R%C3%A9gen.mp3; filename="Regen.mp3"'), 'Régen.mp3');
		assert.equal(nameFromDisposition('attachment; filename=plain.ogg'), 'plain.ogg');
		assert.equal(nameFromDisposition('inline'), null);
		assert.equal(nameFromDisposition(null), null);
	});

	it('take the last part of the path, decoded', () => {
		assert.equal(nameFromUrl('https://example.com/sounds/Big%20Boom.mp3?x=1'), 'Big Boom.mp3');
		assert.equal(nameFromUrl('https://example.com/'), null);
	});
});
