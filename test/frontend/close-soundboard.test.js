import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteController } from '../../public/app/logic/remote-controller.js';
import { Soundboard } from '../../public/app/logic/soundboard.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeWaveformDecoder } from '../helpers/fake-waveform-decoder.js';

/** @typedef {import('../../public/app/logic/ports.js').ServerMessage} ServerMessage */

const logger = { warn: () => {}, error: () => {} };

async function started() {
	const clock = new FakeClock();
	const api = new FakeBackendApi();
	/** @type {((message: ServerMessage) => void) | null} */
	let deliver = null;
	const soundboard = new Soundboard({
		engine: new FakeAudioEngine(clock, { defaultScript: { duration: 30, loadDelay: 0 } }),
		clock,
		api,
		logger,
		decoder: new FakeWaveformDecoder(),
		serverEvents: {
			connect: (onMessage) => {
				deliver = onMessage;
				return () => {};
			},
		},
	});
	await soundboard.start();
	let closed = 0;
	soundboard.on('app.closed', () => closed++);
	return {
		soundboard,
		api,
		closed: () => closed,
		/** @param {ServerMessage} message */
		send: (message) => /** @type {(message: ServerMessage) => void} */ (/** @type {unknown} */ (deliver))(message),
	};
}

describe('closing the soundboard', () => {
	it('sends the pending saves first, asks the server to close, and announces it once', async () => {
		const { soundboard, api, closed, send } = await started();
		soundboard.setVolume('master', 0.5);
		assert.equal(api.saves.length, 0);
		await soundboard.closeSoundboard();
		assert.deepEqual(api.saves.map((saved) => saved.volumes.master), [0.5]);
		assert.equal(api.closedSoundboard, true);
		assert.equal(closed(), 1);
		// The server's own message about it follows, and isn't announced again.
		send({ type: 'startup.closed' });
		assert.equal(closed(), 1);
	});

	it('announces a soundboard closed from another page', async () => {
		const { closed, send } = await started();
		send({ type: 'startup.closed' });
		assert.equal(closed(), 1);
	});

	it('rejects with the server’s message, announcing nothing', async () => {
		const { soundboard, api, closed } = await started();
		api.closeSoundboard = async () => {
			throw new Error('Not possible while the soundboard is loading.');
		};
		await assert.rejects(soundboard.closeSoundboard(), /while the soundboard is loading/);
		assert.equal(closed(), 0);
	});
});

describe('a remote when the soundboard closes', () => {
	it('stops following the host and announces it', () => {
		/** @type {((message: ServerMessage) => void) | null} */
		let deliver = null;
		let disconnects = 0;
		const remote = new RemoteController({
			api: new FakeBackendApi(),
			logger,
			serverEvents: {
				connect: (onMessage) => {
					deliver = onMessage;
					return () => {
						disconnects++;
					};
				},
			},
		});
		let closed = 0;
		remote.on('remote.closed', () => closed++);
		remote.start();
		/** @type {(message: ServerMessage) => void} */ (/** @type {unknown} */ (deliver))({ type: 'startup.closed' });
		assert.equal(closed, 1);
		assert.equal(disconnects, 1);
	});
});
