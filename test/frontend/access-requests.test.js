import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Soundboard } from '../../public/app/logic/soundboard.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeWaveformDecoder } from '../helpers/fake-waveform-decoder.js';

/** @typedef {import('../../public/app/logic/ports.js').ServerMessage} ServerMessage */

async function started() {
	const clock = new FakeClock();
	const api = new FakeBackendApi();
	/** @type {unknown[][]} */
	const logged = [];
	/** @type {((message: ServerMessage) => void) | null} */
	let deliver = null;
	const soundboard = new Soundboard({
		engine: new FakeAudioEngine(clock, { defaultScript: { duration: 30, loadDelay: 0 } }),
		clock,
		api,
		logger: { warn: (...args) => logged.push(args), error: (...args) => logged.push(args) },
		decoder: new FakeWaveformDecoder(),
		pageId: 'page-1',
		serverEvents: {
			connect: (onMessage) => {
				deliver = onMessage;
				return () => {};
			},
		},
	});
	await soundboard.start();
	/** @type {import('../../public/app/logic/ports.js').AccessRequest[][]} */
	const announced = [];
	soundboard.on('access.requestsChanged', ({ requests }) => announced.push(requests));
	return {
		soundboard,
		api,
		logged,
		announced,
		send: (/** @type {ServerMessage} */ message) => deliver?.(message),
		settle: () => new Promise((resolve) => setImmediate(resolve)),
	};
}

describe('connection requests', () => {
	it('has none until the server reports some', async () => {
		const { soundboard } = await started();
		assert.deepEqual(soundboard.accessRequests(), []);
	});

	it('keeps the list the server sent and announces every change', async () => {
		const { soundboard, send, announced } = await started();
		const phone = { address: '192.168.1.50', code: '482' };
		send({ type: 'access.requests', requests: [phone] });
		assert.deepEqual(soundboard.accessRequests(), [phone]);
		send({ type: 'access.requests', requests: [] });
		assert.deepEqual(soundboard.accessRequests(), []);
		assert.deepEqual(announced, [[phone], []]);
	});

	it('sends the answer to the server, and leaves the list to the server\'s next message', async () => {
		const { soundboard, api, send, settle } = await started();
		const phone = { address: '192.168.1.50', code: '482' };
		send({ type: 'access.requests', requests: [phone] });
		soundboard.answerAccessRequest(phone.address, 'allow');
		soundboard.answerAccessRequest(phone.address, 'deny');
		await settle();
		assert.deepEqual(api.accessAnswers, [
			{ address: phone.address, decision: 'allow' },
			{ address: phone.address, decision: 'deny' },
		]);
		assert.deepEqual(soundboard.accessRequests(), [phone]);
	});

	it('logs an answer the server refused instead of throwing', async () => {
		const { soundboard, api, logged, settle } = await started();
		api.answerAccessRequest = async () => {
			throw new Error('No such request');
		};
		soundboard.answerAccessRequest('192.168.1.50', 'allow');
		await settle();
		assert.equal(logged.length, 1);
	});

	it('asks the server for the addresses that open the remote', async () => {
		const { soundboard, api } = await started();
		assert.deepEqual(await soundboard.fetchConnectLinks(), []);
		api.connectLinks = ['http://192.168.1.20:3000/'];
		assert.deepEqual(await soundboard.fetchConnectLinks(), ['http://192.168.1.20:3000/']);
	});
});
