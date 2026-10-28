import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WaveformService } from '../../public/app/logic/waveform-service.js';
import { FakeBackendApi } from '../helpers/fake-backend-api.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { FakeWaveformDecoder } from '../helpers/fake-waveform-decoder.js';

function setup() {
	const clock = new FakeClock();
	const api = new FakeBackendApi();
	const decoder = new FakeWaveformDecoder();
	/** @type {import('../../public/app/logic/waveform-service.js').WaveformEvent[]} */
	const events = [];
	/** @type {unknown[][]} */
	const warnings = [];
	const service = new WaveformService({
		api,
		decoder,
		clock,
		logger: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
		emit: (event) => events.push(event),
		urlOf: (id) => (id === 'Gone.mp3' ? undefined : `/media/${id}`),
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	/** Lets decoding, uploading and the pause between files all finish. */
	const finish = async () => {
		for (let round = 0; round < 20; round++) {
			await settle();
			clock.advance(1000);
		}
		await settle();
	};
	return { api, decoder, events, warnings, service, settle, finish };
}

describe('WaveformService', () => {
	it('generates the missing waveforms in the order the server lists them', async () => {
		const { api, decoder, service, finish } = setup();
		api.missingWaveforms = ['Boom.mp3', 'Combat/1.mp3'];
		service.start();
		await finish();
		assert.deepEqual(decoder.decoded, ['/media/Boom.mp3', '/media/Combat/1.mp3']);
		assert.deepEqual([...api.waveforms.keys()], ['Boom.mp3', 'Combat/1.mp3']);
		assert.deepEqual(service.status, { running: false, done: 2, total: 2, failed: 0 });
	});

	it('reports progress and announces each finished waveform', async () => {
		const { api, events, service, finish } = setup();
		api.missingWaveforms = ['Boom.mp3', 'Rain.ogg'];
		service.start();
		await finish();
		assert.deepEqual(events.filter((event) => event.type === 'waveform.ready'), [
			{ type: 'waveform.ready', id: 'Boom.mp3' },
			{ type: 'waveform.ready', id: 'Rain.ogg' },
		]);
		const done = events.flatMap((event) => (event.type === 'waveforms.progress' ? [event.status.done] : []));
		assert.deepEqual(done, [0, 0, 1, 2, 2]);
	});

	it('decodes one file at a time, resting between files', async () => {
		const { api, decoder, service, settle, finish } = setup();
		api.missingWaveforms = ['Boom.mp3', 'Rain.ogg'];
		service.start();
		await settle();
		await settle();
		await settle();
		assert.equal(decoder.decoded.length, 1);
		await finish();
		assert.equal(decoder.decoded.length, 2);
	});

	it('counts a file that fails and carries on', async () => {
		const { api, decoder, warnings, service, finish } = setup();
		api.missingWaveforms = ['Boom.mp3', 'Rain.ogg', 'Gone.mp3'];
		decoder.failing.add('/media/Boom.mp3');
		service.start();
		await finish();
		assert.deepEqual([...api.waveforms.keys()], ['Rain.ogg']);
		assert.deepEqual(service.status, { running: false, done: 3, total: 3, failed: 2 });
		assert.equal(warnings.length, 2);
	});

	it('stops after the file being decoded and drops its result', async () => {
		const { api, decoder, service, settle, finish } = setup();
		api.missingWaveforms = ['Boom.mp3', 'Rain.ogg'];
		/** @type {() => void} */
		let release = () => {};
		decoder.gate = new Promise((resolve) => {
			release = resolve;
		});
		service.start();
		await settle();
		await settle();
		service.stop();
		release();
		await finish();
		assert.equal(decoder.decoded.length, 1);
		assert.equal(api.waveforms.size, 0);
		assert.equal(service.status.running, false);
	});

	it('starts again from what the server still lacks', async () => {
		const { api, decoder, service, finish } = setup();
		api.missingWaveforms = ['Boom.mp3', 'Rain.ogg'];
		decoder.failing.add('/media/Rain.ogg');
		service.start();
		await finish();
		decoder.failing.clear();
		service.start();
		await finish();
		assert.deepEqual(decoder.decoded, ['/media/Boom.mp3', '/media/Rain.ogg', '/media/Rain.ogg']);
		assert.deepEqual(service.status, { running: false, done: 1, total: 1, failed: 0 });
	});

	it('ignores start while already running', async () => {
		const { api, decoder, service, finish } = setup();
		api.missingWaveforms = ['Boom.mp3'];
		service.start();
		service.start();
		await finish();
		assert.equal(decoder.decoded.length, 1);
	});

	it('gives up quietly when the server cannot list what is missing', async () => {
		const { api, warnings, service, finish } = setup();
		api.waveformError = new Error('offline');
		service.start();
		await finish();
		assert.equal(service.status.running, false);
		assert.equal(warnings.length, 1);
	});

	it('serves a stored waveform, and a made one without asking again', async () => {
		const { api, service, finish } = setup();
		api.waveforms.set('Rain.ogg', Int8Array.of(-1, 1));
		assert.deepEqual([...(await service.get('Rain.ogg')) ?? []], [-1, 1]);
		assert.equal(await service.get('Boom.mp3'), null);
		api.missingWaveforms = ['Boom.mp3'];
		service.start();
		await finish();
		assert.ok(await service.get('Boom.mp3'));
	});
});
