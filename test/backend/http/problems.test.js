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
	const tree = await createTmpTree({
		'.soundboard': JSON.stringify({ version: 1 }),
		'Boom.mp3': 'boom',
		'Song.wav': 'wav',
	});
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
 * The first `problems` message of the event stream, and the next one after it if asked for.
 * @param {string} baseUrl
 */
function openEvents(baseUrl) {
	/** @type {{ problems: { id: string }[] }[]} */
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
				if (message.type === 'problems') {
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
			return messages.slice(0, count).map((message) => message.problems.map((problem) => problem.id));
		},
	};
}

describe('problems over HTTP', () => {
	it('sends the list on connect and after every dismissal', async () => {
		const server = await setup();
		const events = openEvents(server.url);
		assert.deepEqual(await events.messages(1), [['unsupported-audio:Song.wav', 'unknown-duration:Boom.mp3']]);
		const response = await fetch(`${server.url}/api/problems/${encodeURIComponent('unsupported-audio:Song.wav')}`, { method: 'DELETE' });
		assert.equal(response.status, 204);
		assert.deepEqual(await events.messages(2), [['unsupported-audio:Song.wav', 'unknown-duration:Boom.mp3'], ['unknown-duration:Boom.mp3']]);
		assert.equal((await fetch(`${server.url}/api/problems`, { method: 'DELETE' })).status, 204);
		assert.deepEqual((await events.messages(3))[2], []);
	});

	it("answers 404 for a problem it doesn't have and 405 for other methods", async () => {
		const server = await setup();
		assert.equal((await fetch(`${server.url}/api/problems/nope`, { method: 'DELETE' })).status, 404);
		assert.equal((await fetch(`${server.url}/api/problems`)).status, 405);
	});
});
