import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceMonitor } from '../../public/app/logic/voice-monitor.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {Partial<import('../../public/app/logic/ports.js').VoiceOptions> & { url?: string }} StreamOptions */

/** @param {{ maxEntries?: number }} [options] */
function setup({ maxEntries } = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { defaultScript: { duration: 10, loadDelay: 0.1 } });
	let changes = 0;
	const monitor = new VoiceMonitor({ engine, clock, onChange: () => changes++, maxEntries });
	const stream = (/** @type {StreamOptions} */ options = {}) => monitor.createStreamVoice({
		url: '/media/a.mp3',
		bus: 'sfx',
		label: 'Boom',
		...options,
	});
	const only = () => monitor.voices()[0];
	return { clock, engine, monitor, stream, only, changes: () => changes };
}

describe('VoiceMonitor', () => {
	describe('what it lists', () => {
		it('lists a new voice as loading, with its label, bus and own volume', () => {
			const { stream, only } = setup();
			stream({ gain: 0.5, bus: 'music', label: 'Boss Theme' });
			assert.deepEqual(only(), { serial: 1, label: 'Boss Theme', bus: 'music', status: 'loading', volume: 0.5, finished: false, message: null });
		});

		it('lists voices oldest first, whichever bus they play on', () => {
			const { stream, monitor } = setup();
			stream({ label: 'A', bus: 'sfx' });
			stream({ label: 'B', bus: 'music' });
			stream({ label: 'C', bus: 'sfx' });
			assert.deepEqual(monitor.voices().map((voice) => [voice.serial, voice.label]), [[1, 'A'], [2, 'B'], [3, 'C']]);
		});

		it('also lists voices made from decoded buffers', async () => {
			const { monitor, engine, clock } = setup();
			const loading = engine.loadBuffer('/media/a.mp3');
			clock.advance(100);
			monitor.createBufferVoice({ buffer: await loading, bus: 'sfx', label: 'Click' });
			assert.equal(monitor.voices()[0].label, 'Click');
		});

		it('labels a voice without one as an empty string', () => {
			const { monitor, only } = setup();
			monitor.createStreamVoice({ url: '/x', bus: 'sfx' });
			assert.equal(only().label, '');
		});
	});

	describe('status', () => {
		it('is playing once the voice has loaded and was told to play', () => {
			const { stream, only, clock } = setup();
			const voice = stream();
			voice.play();
			assert.equal(only().status, 'loading', 'it has not loaded yet');
			clock.advance(100);
			assert.equal(only().status, 'playing');
		});

		it('is paused after loading when nothing asked it to play', () => {
			const { stream, only, clock } = setup();
			stream();
			clock.advance(100);
			assert.equal(only().status, 'paused');
		});

		it('follows pause and play', () => {
			const { stream, only, clock } = setup();
			const voice = stream();
			voice.play();
			clock.advance(100);
			voice.pause();
			assert.equal(only().status, 'paused');
			voice.play();
			assert.equal(only().status, 'playing');
		});

		it('shows a fade in and a fade out while they run', () => {
			const { stream, only, clock } = setup();
			const voice = stream();
			voice.rampGain(0, 0);
			voice.rampGain(1, 2);
			voice.play();
			clock.advance(100);
			assert.equal(only().status, 'fading in');
			clock.advance(2000);
			assert.equal(only().status, 'playing');
			voice.rampGain(0, 3);
			assert.equal(only().status, 'fading out');
			clock.advance(3000);
			assert.equal(only().status, 'playing', 'a finished fade is no longer shown');
		});

		it('is ended when the voice ends by itself', () => {
			const { stream, only, clock } = setup();
			stream({ endAt: 1 }).play();
			clock.advance(100 + 1000);
			assert.equal(only().status, 'ended');
			assert.equal(only().finished, true);
		});

		it('is stopped when the voice is stopped', () => {
			const { stream, only } = setup();
			stream().stop();
			assert.equal(only().status, 'stopped');
			assert.equal(only().finished, true);
		});

		it('is an error, with its message, when the voice fails', () => {
			const { stream, only, clock, engine } = setup();
			engine.script('/media/bad.mp3', { playError: 'Network down' });
			stream({ url: '/media/bad.mp3' }).play();
			clock.advance(0);
			assert.equal(only().status, 'error');
			assert.equal(only().message, 'Network down');
		});

		it('keeps the first way a voice finished, however often it is stopped afterwards', () => {
			const { stream, only, clock } = setup();
			const voice = stream({ endAt: 1 });
			voice.play();
			clock.advance(100 + 1000);
			voice.stop();
			voice.stop();
			assert.equal(only().status, 'ended', 'a player releases an ended voice by stopping it');
		});
	});

	describe('volume', () => {
		it("is the voice's own gain until something changes it", () => {
			const { stream, only } = setup();
			const voice = stream({ gain: 0.8 });
			assert.equal(only().volume, 0.8);
			voice.setGain(0.4);
			assert.equal(only().volume, 0.4);
		});

		it('is multiplied by the level of a fade, moving with the clock', () => {
			const { stream, only, clock } = setup();
			const voice = stream({ gain: 0.5 });
			voice.rampGain(0, 0);
			assert.equal(only().volume, 0);
			voice.rampGain(1, 2);
			clock.advance(1000);
			assert.equal(only().volume, 0.25);
			clock.advance(1000);
			assert.equal(only().volume, 0.5);
		});

		it('continues an interrupted fade from where it had got to', () => {
			const { stream, only, clock } = setup();
			const voice = stream();
			voice.rampGain(0, 0);
			voice.rampGain(1, 2);
			clock.advance(1000);
			voice.rampGain(0, 1);
			clock.advance(500);
			assert.equal(only().volume, 0.25);
		});

		it('stays where it was once the voice has finished', () => {
			const { stream, only, clock } = setup();
			const voice = stream({ gain: 0.5 });
			voice.rampGain(0, 0);
			voice.rampGain(1, 2);
			clock.advance(1000);
			voice.stop();
			clock.advance(1000);
			assert.equal(only().volume, 0.25);
		});
	});

	describe('lingering', () => {
		it('removes a finished voice 5 seconds after it finished', () => {
			const { stream, monitor, clock } = setup();
			stream().stop();
			clock.advance(4999);
			assert.equal(monitor.voices().length, 1);
			clock.advance(1);
			assert.equal(monitor.voices().length, 0);
		});

		it('counts the 5 seconds from the end, not from the start', () => {
			const { stream, monitor, clock } = setup();
			stream({ endAt: 3 }).play();
			clock.advance(100 + 3000 + 4999);
			assert.equal(monitor.voices().length, 1);
			clock.advance(1);
			assert.equal(monitor.voices().length, 0);
		});

		it('keeps listing voices that are still playing, however long', () => {
			const { stream, monitor, clock } = setup();
			stream().play();
			clock.advance(8000);
			assert.equal(monitor.voices().length, 1);
		});

		it('starts only one timer for a voice finished twice', () => {
			const { stream, clock } = setup();
			const voice = stream();
			voice.stop();
			voice.stop();
			assert.equal(clock.pendingTimerCount, 1);
		});

		it('does not reuse the number of a removed voice', () => {
			const { stream, monitor, clock } = setup();
			stream().stop();
			clock.advance(5000);
			stream();
			assert.equal(monitor.voices()[0].serial, 2);
		});
	});

	describe('changes', () => {
		it('announces a new voice, each change of its status and its removal', () => {
			const { stream, clock, changes } = setup();
			const voice = stream();
			assert.equal(changes(), 1, 'added');
			voice.play();
			clock.advance(100);
			assert.equal(changes(), 2, 'loaded');
			voice.pause();
			assert.equal(changes(), 3, 'paused');
			voice.stop();
			assert.equal(changes(), 4, 'stopped');
			voice.stop();
			assert.equal(changes(), 4, 'stopping again changes nothing');
			clock.advance(5000);
			assert.equal(changes(), 5, 'removed');
		});
	});

	describe('the limit', () => {
		it('drops the oldest finished voices first when there are too many', () => {
			const { stream, monitor } = setup({ maxEntries: 3 });
			const first = stream({ label: 'first' });
			stream({ label: 'second' });
			stream({ label: 'third' });
			first.stop();
			stream({ label: 'fourth' });
			assert.deepEqual(monitor.voices().map((voice) => voice.label), ['second', 'third', 'fourth']);
		});

		it('never drops a voice that is still playing', () => {
			const { stream, monitor } = setup({ maxEntries: 2 });
			stream({ label: 'a' });
			stream({ label: 'b' });
			stream({ label: 'c' });
			assert.equal(monitor.voices().length, 3);
		});
	});

	describe('as an audio engine', () => {
		it('hands the real voice every call it gets', () => {
			const { stream, engine, clock } = setup();
			const voice = stream({ startAt: 2 });
			voice.play();
			clock.advance(100);
			voice.seek(5);
			voice.setLooping(true);
			voice.rampGain(0.5, 1);
			voice.setGain(0.3);
			const real = engine.voices[0];
			assert.equal(real.playCalls, 1);
			assert.equal(real.looping, true);
			assert.deepEqual(real.gainRamps, [[0.5, 1]]);
			assert.equal(real.gain, 0.3);
			assert.equal(voice.position, 5);
			assert.equal(voice.duration, 10);
		});

		it("delivers the real voice's events to whoever listens to its wrapper", () => {
			const { stream, clock } = setup();
			const voice = stream({ endAt: 1 });
			/** @type {string[]} */
			const seen = [];
			voice.on('loaded', () => seen.push('loaded'));
			voice.on('ended', () => seen.push('ended'));
			voice.play();
			clock.advance(100 + 1000);
			assert.deepEqual(seen, ['loaded', 'ended']);
		});

		it('delivers errors to whoever listens', () => {
			const { stream, clock, engine } = setup();
			engine.script('/media/bad.mp3', { loadError: 'Not found' });
			/** @type {string[]} */
			const messages = [];
			stream({ url: '/media/bad.mp3' }).onError((error) => messages.push(error.message));
			clock.advance(100);
			assert.deepEqual(messages, ['Not found']);
		});

		it('passes the rest of the engine through', async () => {
			const { monitor, engine, clock } = setup();
			monitor.unlock();
			monitor.setBusGain('music', 0.5);
			assert.equal(engine.unlockCount, 1);
			assert.equal(engine.busGains.music, 0.5);
			assert.equal(monitor.canPlay('mp3'), true);
			const loading = monitor.loadBuffer('/media/a.mp3');
			clock.advance(100);
			assert.deepEqual(engine.bufferLoads, ['/media/a.mp3']);
			assert.equal((await loading).memoryBytes, 1000);
			let suspended = 0;
			monitor.on('suspended', () => suspended++);
			engine.simulate('suspended');
			assert.equal(suspended, 1);
		});
	});
});
