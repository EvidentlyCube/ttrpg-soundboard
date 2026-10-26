import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BufferCache } from '../../public/app/logic/buffer-cache.js';
import { SoundPlayer } from '../../public/app/logic/sound-player.js';
import { FakeAudioEngine } from '../helpers/fake-audio-engine.js';
import { FakeClock } from '../helpers/fake-clock.js';

/** @typedef {import('../../public/app/logic/sound-player.js').SoundEvent} SoundEvent */
/** @typedef {import('../../public/app/logic/ports.js').AudioFileJson} AudioFileJson */

/**
 * @param {string} id
 * @param {number} size
 * @returns {AudioFileJson}
 */
function sound(id, size) {
	return { id, title: id, format: 'mp3', size, gain: 1, duration: 2, url: `/media/${id}` };
}

const SMALL = sound('Boom.mp3', 1000);
const LARGE = sound('Rain.mp3', 2 * 1024 * 1024);

/** @param {{ isPlayable?: (sound: AudioFileJson) => boolean }} [options] */
function setup({ isPlayable } = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { defaultScript: { duration: 2, loadDelay: 0.05 } });
	const cache = new BufferCache({ load: (url) => engine.loadBuffer(url) });
	/** @type {SoundEvent[]} */
	const events = [];
	const player = new SoundPlayer({ engine, cache, emit: (event) => events.push(event), isPlayable });
	/** Fires due timers, then lets promise callbacks (buffer decoding) run. */
	const advance = async (/** @type {number} */ seconds) => {
		clock.advance(seconds * 1000);
		await new Promise((resolve) => setImmediate(resolve));
	};
	const activity = () => events.filter((event) => event.type === 'sound.activeChanged');
	return { clock, engine, cache, events, player, advance, activity };
}

describe('SoundPlayer', () => {
	describe('small sounds', () => {
		it('decodes once into memory and plays from the buffer', async () => {
			const { player, engine, advance, activity } = setup();
			player.play(SMALL);
			assert.equal(engine.voices.length, 0);
			await advance(0.05);
			assert.deepEqual(engine.bufferLoads, ['/media/Boom.mp3']);
			assert.equal(engine.voices.length, 1);
			assert.equal(engine.voices[0].kind, 'buffer');
			assert.equal(engine.voices[0].bus, 'sfx');
			assert.equal(engine.voices[0].playCalls, 1);
			assert.deepEqual(activity(), [{ type: 'sound.activeChanged', soundId: 'Boom.mp3', active: true }]);
		});

		it('shares a decode in progress and reuses the cached buffer later', async () => {
			const { player, engine, advance } = setup();
			player.play(SMALL);
			player.play(SMALL);
			await advance(0.05);
			player.play(SMALL);
			await advance(0);
			assert.equal(engine.bufferLoads.length, 1);
			assert.equal(engine.liveVoices.length, 3);
		});

		it('cancels starts still waiting for decoding when stopped', async () => {
			const { player, engine, advance, events } = setup();
			player.play(SMALL);
			player.stop(SMALL.id);
			await advance(0.05);
			assert.equal(engine.voices.length, 0);
			assert.deepEqual(events, []);
		});

		it('still starts presses made after a stop during the same decode', async () => {
			const { player, engine, advance } = setup();
			player.play(SMALL);
			player.stop(SMALL.id);
			player.play(SMALL);
			await advance(0.05);
			assert.equal(engine.liveVoices.length, 1);
		});

		it('reports a failed decode and tries again on the next press', async () => {
			const { player, engine, advance, events } = setup();
			engine.script('/media/Boom.mp3', { bufferError: 'Unable to decode audio data' });
			player.play(SMALL);
			await advance(0.05);
			assert.deepEqual(events, [{ type: 'sound.error', soundId: 'Boom.mp3', message: 'Unable to decode audio data' }]);
			player.play(SMALL);
			await advance(0.05);
			assert.equal(engine.bufferLoads.length, 2);
		});
	});

	describe('large sounds', () => {
		it('streams and calls play() synchronously, inside the user gesture', () => {
			const { player, engine, activity } = setup();
			player.play(LARGE);
			assert.equal(engine.voices.length, 1);
			assert.equal(engine.voices[0].kind, 'stream');
			assert.equal(engine.voices[0].playCalls, 1);
			assert.equal(engine.bufferLoads.length, 0);
			assert.equal(activity().length, 1);
		});
	});

	describe('instances', () => {
		it('overlaps instances and reports inactive only when the last one ends', async () => {
			const { player, engine, advance, activity } = setup();
			player.play(LARGE);
			await advance(1);
			player.play(LARGE);
			assert.equal(engine.liveVoices.length, 2);
			assert.equal(player.isActive(LARGE.id), true);
			await advance(1.1);
			assert.equal(engine.liveVoices.length, 1);
			assert.equal(activity().length, 1);
			await advance(1.1);
			assert.equal(player.isActive(LARGE.id), false);
			assert.deepEqual(activity().map((event) => event.type === 'sound.activeChanged' && event.active), [true, false]);
			assert.equal(engine.liveVoices.length, 0);
		});

		it('keeps at most 8 instances of one sound, replacing the oldest', () => {
			const { player, engine, activity } = setup();
			for (let i = 0; i < 9; i++) {
				player.play(LARGE);
			}
			assert.equal(engine.liveVoices.length, 8);
			assert.equal(engine.voices[0].stopped, true);
			assert.equal(activity().length, 1);
		});

		it('keeps at most 24 streamed instances in total', () => {
			const { player, engine, activity } = setup();
			player.play(sound('First.mp3', LARGE.size));
			for (let i = 0; i < 24; i++) {
				player.play(sound(`Loop ${i % 4}.mp3`, LARGE.size));
			}
			assert.equal(engine.liveVoices.length, 24);
			assert.equal(engine.voices[0].stopped, true);
			assert.deepEqual(activity().find((event) => event.soundId === 'First.mp3' && !event.active), {
				type: 'sound.activeChanged',
				soundId: 'First.mp3',
				active: false,
			});
		});

		it('does not count buffered instances against the streaming limit', async () => {
			const { player, engine, advance } = setup();
			for (let i = 0; i < 4; i++) {
				player.play(sound(`Small ${i}.mp3`, 1000));
			}
			await advance(0.05);
			for (let i = 0; i < 24; i++) {
				player.play(sound(`Big ${i % 3}.mp3`, LARGE.size));
			}
			assert.equal(engine.liveVoices.length, 28);
		});
	});

	describe('stopping and failures', () => {
		it('stops every instance of a sound at once', () => {
			const { player, engine, activity } = setup();
			player.play(LARGE);
			player.play(LARGE);
			player.stop(LARGE.id);
			assert.equal(engine.liveVoices.length, 0);
			assert.equal(player.isActive(LARGE.id), false);
			assert.deepEqual(activity().map((event) => event.type === 'sound.activeChanged' && event.active), [true, false]);
		});

		it('ignores stop for a sound that is not playing', () => {
			const { player, events } = setup();
			player.stop(LARGE.id);
			assert.deepEqual(events, []);
		});

		it('reports a voice that fails and removes it', async () => {
			const { player, engine, advance, events } = setup();
			engine.script(LARGE.url, { loadError: 'Network error' });
			player.play(LARGE);
			await advance(0.05);
			assert.deepEqual(events.slice(1), [
				{ type: 'sound.error', soundId: 'Rain.mp3', message: 'Network error' },
				{ type: 'sound.activeChanged', soundId: 'Rain.mp3', active: false },
			]);
			assert.equal(engine.liveVoices.length, 0);
		});

		it('refuses formats this browser cannot play', () => {
			const { player, engine, events } = setup({ isPlayable: () => false });
			player.play(LARGE);
			assert.equal(engine.voices.length, 0);
			assert.deepEqual(events, [{ type: 'sound.error', soundId: 'Rain.mp3', message: 'This browser cannot play mp3 files' }]);
		});
	});

	describe('gain', () => {
		it('starts streamed and buffered instances at the sound\'s gain', async () => {
			const { player, engine, advance } = setup();
			player.play({ ...LARGE, gain: 2 });
			player.play({ ...SMALL, gain: 0.5 });
			await advance(0.05);
			assert.deepEqual(engine.voices.map((voice) => [voice.kind, voice.gain]), [['stream', 2], ['buffer', 0.5]]);
		});

		it('applies a change to every playing instance of that sound only', async () => {
			const { player, engine, advance } = setup();
			player.play(LARGE);
			player.play(LARGE);
			player.play(SMALL);
			await advance(0.05);
			player.setGain(LARGE.id, 3);
			assert.deepEqual(engine.voices.map((voice) => voice.gain), [3, 3, 1]);
		});

		it('starts later instances at the changed gain, even for a sound object from before the change', async () => {
			const { player, engine, advance } = setup();
			player.setGain(LARGE.id, 0.25);
			player.play(LARGE);
			assert.equal(engine.voices[0].gain, 0.25);

			player.play(SMALL);
			player.setGain(SMALL.id, 1.5);
			await advance(0.05);
			assert.equal(engine.voices[1].gain, 1.5, 'a press still waiting for its decode');
		});

		it('leaves stopped instances alone', async () => {
			const { player, engine, advance } = setup();
			player.play(LARGE);
			await advance(0.05);
			player.stop(LARGE.id);
			player.setGain(LARGE.id, 2);
			assert.equal(engine.voices[0].gain, 1);
		});
	});
});
