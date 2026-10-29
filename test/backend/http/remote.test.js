import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer } from '../../../src/http/server.js';
import { BootstrapService } from '../../../src/library/bootstrap-service.js';
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
	const tree = await createTmpTree({ '.soundboard': JSON.stringify({ version: 1 }), 'Boom.mp3': 'boom' });
	cleanups.push(() => tree.remove());
	const outcome = await new BootstrapService({ prompter: new FakePrompter(), reporter: new FakeReporter() }).run(tree.root);
	assert.equal(outcome.status, 'ready');
	const server = await startServer({
		library: outcome.library,
		settings: outcome.settings,
		problems: outcome.problems,
		port: 0,
		logError: (error) => assert.fail(String(error)),
	});
	cleanups.push(() => server.close());
	return server;
}

/**
 * An event stream, with the messages received so far.
 * @param {string} baseUrl
 * @param {string} query
 * @param {string} type only messages of this type are kept, and the first message of every stream
 * 	(`remote.role` for a page, `remote.host` for a remote) always
 */
function openEvents(baseUrl, query, type) {
	const first = query.startsWith('page=') ? 'remote.role' : 'remote.host';
	/** @type {Record<string, any>[]} */
	const messages = [];
	/** @type {(() => void) | null} */
	let wake = null;
	let buffer = '';
	const outgoing = request(`${baseUrl}/api/events?${query}`, (response) => {
		response.setEncoding('utf8');
		response.on('data', (/** @type {string} */ chunk) => {
			buffer += chunk;
			const blocks = buffer.split('\n\n');
			buffer = blocks.pop() ?? '';
			for (const block of blocks.filter((text) => text.startsWith('data: '))) {
				const message = JSON.parse(block.slice('data: '.length));
				if (message.type === type || message.type === first) {
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
		async messages(count) {
			while (messages.length < count) {
				await new Promise((resolve) => {
					wake = () => resolve(undefined);
				});
			}
			return messages.slice(0, count);
		},
		close: () => outgoing.destroy(),
	};
}

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 */
async function call(baseUrl, method, path, body) {
	const response = await fetch(baseUrl + path, {
		method,
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: response.status, body: await response.json() };
}

describe('the remote routes', () => {
	it('tell whether a page is the host', async () => {
		const { url } = await setup();
		assert.deepEqual(await call(url, 'GET', '/api/remote'), { status: 200, body: { host: false } });
		const page = openEvents(url, 'page=a', 'remote.role');
		assert.deepEqual(await page.messages(1), [{ type: 'remote.role', host: false }]);
		assert.equal((await call(url, 'PUT', '/api/remote/host', { pageId: 'a' })).status, 200);
		assert.deepEqual(await call(url, 'GET', '/api/remote'), { status: 200, body: { host: true } });
	});

	it('refuse a claim from a page without a stream, and a claim without a page id', async () => {
		const { url } = await setup();
		assert.equal((await call(url, 'PUT', '/api/remote/host', { pageId: 'nobody' })).status, 400);
		assert.equal((await call(url, 'PUT', '/api/remote/host', {})).status, 400);
		assert.equal((await call(url, 'PUT', '/api/remote/host', [])).status, 400);
	});

	it('answer 409 to a second claim, and let it replace the host when it says so', async () => {
		const { url } = await setup();
		const first = openEvents(url, 'page=a', 'remote.role');
		const second = openEvents(url, 'page=b', 'remote.role');
		await first.messages(1);
		await second.messages(1);
		await call(url, 'PUT', '/api/remote/host', { pageId: 'a' });
		assert.equal((await call(url, 'PUT', '/api/remote/host', { pageId: 'b' })).status, 409);
		assert.equal((await call(url, 'PUT', '/api/remote/host', { pageId: 'b', replace: true })).status, 200);
		assert.deepEqual((await first.messages(2))[1], { type: 'remote.role', host: false, reason: 'replaced' });
	});

	it('release the role when the host asks, and ignore anyone else', async () => {
		const { url } = await setup();
		const page = openEvents(url, 'page=a', 'remote.role');
		await page.messages(1);
		await call(url, 'PUT', '/api/remote/host', { pageId: 'a' });
		assert.equal((await call(url, 'DELETE', '/api/remote/host?page=b')).status, 200);
		assert.deepEqual((await call(url, 'GET', '/api/remote')).body, { host: true });
		assert.equal((await call(url, 'DELETE', '/api/remote/host?page=a')).status, 200);
		assert.deepEqual((await call(url, 'GET', '/api/remote')).body, { host: false });
		assert.equal((await call(url, 'DELETE', '/api/remote/host')).status, 400);
	});

	it('carry the host\'s state to the remotes, and its commands the other way', async () => {
		const { url } = await setup();
		const page = openEvents(url, 'page=a', 'command');
		const remote = openEvents(url, 'role=remote', 'remote.state');
		await page.messages(1);
		await remote.messages(1);
		await call(url, 'PUT', '/api/remote/host', { pageId: 'a' });
		assert.equal((await call(url, 'PUT', '/api/remote/state', { pageId: 'a', state: { panic: 'fade' } })).status, 200);
		assert.deepEqual((await remote.messages(3)).at(-1), { type: 'remote.state', state: { panic: 'fade' } });
		assert.equal((await call(url, 'POST', '/api/remote/commands', { type: 'panic.stop' })).status, 200);
		assert.deepEqual((await page.messages(2)).at(-1), { type: 'command', command: { type: 'panic.stop' } });
	});

	it('refuse a state from a page that is not the host, and a state that is not an object', async () => {
		const { url } = await setup();
		const page = openEvents(url, 'page=a', 'remote.role');
		await page.messages(1);
		await call(url, 'PUT', '/api/remote/host', { pageId: 'a' });
		assert.equal((await call(url, 'PUT', '/api/remote/state', { pageId: 'b', state: {} })).status, 409);
		assert.equal((await call(url, 'PUT', '/api/remote/state', { pageId: 'a', state: 3 })).status, 400);
	});

	it('refuse commands a remote may not send, and any command without a host', async () => {
		const { url } = await setup();
		assert.equal((await call(url, 'POST', '/api/remote/commands', { type: 'volume.set', bus: 'master', value: 0 })).status, 400);
		assert.equal((await call(url, 'POST', '/api/remote/commands', { type: 'panic.stop' })).status, 409);
	});

	it('know their methods and paths', async () => {
		const { url } = await setup();
		assert.equal((await call(url, 'POST', '/api/remote')).status, 405);
		assert.equal((await call(url, 'GET', '/api/remote/commands')).status, 405);
		assert.equal((await call(url, 'GET', '/api/remote/nothing')).status, 404);
	});

	it('hand a remote what it missed when it connects', async () => {
		const { url } = await setup();
		const page = openEvents(url, 'page=a', 'remote.role');
		await page.messages(1);
		await call(url, 'PUT', '/api/remote/host', { pageId: 'a' });
		await call(url, 'PUT', '/api/remote/state', { pageId: 'a', state: { panic: 'now' } });
		const remote = openEvents(url, 'role=remote', 'remote.state');
		assert.deepEqual(await remote.messages(2), [
			{ type: 'remote.host', connected: true },
			{ type: 'remote.state', state: { panic: 'now' } },
		]);
	});

	it('keep the host role while its stream is closed for less than the grace period', async () => {
		const { url } = await setup();
		const page = openEvents(url, 'page=a', 'remote.role');
		await page.messages(1);
		await call(url, 'PUT', '/api/remote/host', { pageId: 'a' });
		const remote = openEvents(url, 'role=remote', 'remote.host');
		await remote.messages(1);
		page.close();
		// The grace period is 10 s, too long to wait for here; the relay's own tests cover it with a fake clock.
		assert.deepEqual((await call(url, 'GET', '/api/remote')).body, { host: true });
	});
});
