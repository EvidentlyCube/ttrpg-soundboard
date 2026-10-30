import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { HttpBackendApi } from '../../../public/app/api/backend-api.js';
import { DEVICE_COOKIE } from '../../../src/http/lan-access.js';
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

/**
 * Requests from this machine are never checked, so the pairing routes see this machine as the device.
 * @param {{ lan?: boolean, onRequest?: (request: { address: string, code: string }) => void }} [options]
 */
async function setup({ lan = true, onRequest } = {}) {
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
		lan: lan ? { address: '127.0.0.1', addresses: ['192.168.1.20'], names: [], onRequest } : undefined,
	});
	cleanups.push(() => server.close());
	return server;
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
	return { status: response.status, body: /** @type {any} */ (await response.json()), cookie: response.headers.get('set-cookie') };
}

/**
 * A page's event stream, with the `access.requests` messages received so far.
 * @param {string} baseUrl
 * @param {string} query
 */
function openEvents(baseUrl, query) {
	/** @type {{ type: string, requests: { address: string, code: string }[] }[]} */
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
				if (message.type === 'access.requests') {
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
		async requests(count) {
			while (messages.length < count) {
				await new Promise((resolve) => {
					wake = () => resolve(undefined);
				});
			}
			return messages.slice(0, count).map((message) => message.requests);
		},
		/** Gives a stream that should stay quiet time to prove it. */
		async quiet() {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return messages.length;
		},
	};
}

describe('the pairing routes', () => {
	it('start pairing and answer with the same code to a second ask', async () => {
		const { url } = await setup();
		const first = await call(url, 'POST', '/api/access/requests');
		assert.equal(first.status, 200);
		assert.match(first.body.code, /^\d{3}$/);
		assert.deepEqual(first.body, { status: 'pending', code: first.body.code });
		assert.deepEqual((await call(url, 'POST', '/api/access/requests')).body, first.body);
		assert.deepEqual((await call(url, 'GET', '/api/access/requests/mine')).body, first.body);
	});

	it('say there is nothing before anyone asked', async () => {
		const { url } = await setup();
		assert.deepEqual((await call(url, 'GET', '/api/access/requests/mine')).body, { status: 'none' });
	});

	it('give an allowed device its cookie once, without the secret in the body', async () => {
		const { url } = await setup();
		const { body: { code } } = await call(url, 'POST', '/api/access/requests');
		const address = '127.0.0.1';
		assert.equal((await call(url, 'POST', '/api/access/requests/answer', { address, decision: 'allow' })).status, 200);
		const allowed = await call(url, 'GET', '/api/access/requests/mine');
		assert.deepEqual(allowed.body, { status: 'allowed', code });
		assert.match(allowed.cookie ?? '', new RegExp(`^${DEVICE_COOKIE}=[0-9a-f]{32}; Path=/; HttpOnly; SameSite=Lax$`));
		assert.equal((await call(url, 'GET', '/api/access/requests/mine')).cookie, null);
	});

	it('report a denial', async () => {
		const { url } = await setup();
		const { body: { code } } = await call(url, 'POST', '/api/access/requests');
		await call(url, 'POST', '/api/access/requests/answer', { address: '127.0.0.1', decision: 'deny' });
		assert.deepEqual((await call(url, 'GET', '/api/access/requests/mine')).body, { status: 'denied', code });
	});

	it('ban an address that asks too often', async () => {
		const { url } = await setup();
		const statuses = [];
		for (let i = 0; i < 6; i++) {
			statuses.push((await call(url, 'POST', '/api/access/requests')).body.status);
		}
		assert.deepEqual(statuses, ['pending', 'pending', 'pending', 'pending', 'pending', 'banned']);
		assert.deepEqual((await call(url, 'GET', '/api/access/requests/mine')).body, { status: 'banned' });
	});

	it('refuse an answer that is not understood or has no request', async () => {
		const { url } = await setup();
		assert.equal((await call(url, 'POST', '/api/access/requests/answer', { address: '127.0.0.1', decision: 'ban' })).status, 400);
		assert.equal((await call(url, 'POST', '/api/access/requests/answer', { decision: 'allow' })).status, 400);
		assert.equal((await call(url, 'POST', '/api/access/requests/answer', { address: '127.0.0.1', decision: 'allow' })).status, 404);
		assert.equal((await call(url, 'GET', '/api/access/requests/answer')).status, 405);
		assert.equal((await call(url, 'GET', '/api/access/nothing')).status, 404);
	});

	it('do not exist without --lan', async () => {
		const { url } = await setup({ lan: false });
		for (const [method, path] of [['POST', '/api/access/requests'], ['GET', '/api/access/requests/mine'], ['GET', '/api/access/links']]) {
			assert.equal((await call(url, method, path)).status, 404, path);
		}
	});

	it('tell the terminal about a new request only', async () => {
		/** @type {string[]} */
		const heard = [];
		const { url } = await setup({ onRequest: ({ address, code }) => heard.push(`${address} ${code}`) });
		const { body: { code } } = await call(url, 'POST', '/api/access/requests');
		await call(url, 'POST', '/api/access/requests');
		assert.deepEqual(heard, [`127.0.0.1 ${code}`]);
	});
});

describe('the connect links', () => {
	it('are the server\'s addresses with its port', async () => {
		const { url } = await setup();
		const port = new URL(url).port;
		assert.deepEqual((await call(url, 'GET', '/api/access/links')).body, { links: [`http://192.168.1.20:${port}/`] });
	});
});

describe('the pairing requests on a page\'s event stream', () => {
	it('arrive on connect, after every change, and empty once answered', async () => {
		const { url } = await setup();
		const { body: { code } } = await call(url, 'POST', '/api/access/requests');
		const events = openEvents(url, 'page=a');
		assert.deepEqual(await events.requests(1), [[{ address: '127.0.0.1', code }]]);
		await call(url, 'POST', '/api/access/requests/answer', { address: '127.0.0.1', decision: 'deny' });
		assert.deepEqual(await events.requests(2), [[{ address: '127.0.0.1', code }], []]);
	});

	it('reach every page, and never a remote', async () => {
		const { url } = await setup();
		const first = openEvents(url, 'page=a');
		const second = openEvents(url, 'page=b');
		const remote = openEvents(url, 'role=remote');
		assert.deepEqual(await first.requests(1), [[]]);
		assert.deepEqual(await second.requests(1), [[]]);
		const { body: { code } } = await call(url, 'POST', '/api/access/requests');
		assert.deepEqual(await first.requests(2), [[], [{ address: '127.0.0.1', code }]]);
		assert.deepEqual(await second.requests(2), [[], [{ address: '127.0.0.1', code }]]);
		assert.equal(await remote.quiet(), 0);
	});

	it('are not sent without --lan', async () => {
		const { url } = await setup({ lan: false });
		assert.equal(await openEvents(url, 'page=a').quiet(), 0);
	});
});

describe('HttpBackendApi', () => {
	it('fetches the connect links, and gets none without --lan', async () => {
		const { url } = await setup();
		assert.deepEqual(await new HttpBackendApi(url).fetchConnectLinks(), [`http://192.168.1.20:${new URL(url).port}/`]);
		const plain = await setup({ lan: false });
		assert.deepEqual(await new HttpBackendApi(plain.url).fetchConnectLinks(), []);
	});

	it('answers a request, and rejects with the server\'s message when it is gone', async () => {
		const { url } = await setup();
		const api = new HttpBackendApi(url);
		await call(url, 'POST', '/api/access/requests');
		await api.answerAccessRequest('127.0.0.1', 'allow');
		assert.equal((await call(url, 'GET', '/api/access/requests/mine')).body.status, 'allowed');
		await assert.rejects(api.answerAccessRequest('127.0.0.1', 'allow'), /No such request/);
	});
});
