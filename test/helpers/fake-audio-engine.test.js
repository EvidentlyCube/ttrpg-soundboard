import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioEngine } from './fake-audio-engine.js';
import { FakeClock } from './fake-clock.js';

/**
 * A stream voice on a 10 s file that loads after 100 ms.
 * @param {{ startAt?: number, endAt?: number | null }} [clip]
 */
function setup(clip = {}) {
	const clock = new FakeClock();
	const engine = new FakeAudioEngine(clock, { defaultScript: { duration: 10, loadDelay: 0.1 } });
	const voice = engine.createStreamVoice({ url: '/media/a.mp3', bus: 'sfx', ...clip });
	let ended = 0;
	voice.on('ended', () => ended++);
	return { clock, voice, endedCount: () => ended };
}

describe('FakeAudioEngine start and end points', () => {
	it('starts playback at the start point', () => {
		const { clock, voice } = setup({ startAt: 2 });
		voice.play();
		clock.advance(100);
		assert.equal(voice.position, 2);
		clock.advance(500);
		assert.equal(voice.position, 2.5);
	});

	it('ends at the end point instead of the end of the file', () => {
		const { clock, voice, endedCount } = setup({ startAt: 2, endAt: 3 });
		voice.play();
		clock.advance(100 + 999);
		assert.equal(endedCount(), 0);
		clock.advance(1);
		assert.equal(endedCount(), 1);
		assert.equal(voice.position, 3);
		assert.equal(voice.playing, false);
	});

	it('plays to the end of the file without an end point', () => {
		const { clock, voice, endedCount } = setup({ startAt: 9 });
		voice.play();
		clock.advance(100 + 1000);
		assert.equal(endedCount(), 1);
		assert.equal(voice.position, 10);
	});

	it('keeps the end point after a pause and a resume', () => {
		const { clock, voice, endedCount } = setup({ endAt: 1 });
		voice.play();
		clock.advance(100 + 600);
		voice.pause();
		clock.advance(5000);
		assert.equal(endedCount(), 0);
		voice.play();
		clock.advance(400);
		assert.equal(endedCount(), 1);
	});

	it('keeps the end point after a seek, and ends at once when seeking past it', () => {
		const { clock, voice, endedCount } = setup({ endAt: 4 });
		voice.play();
		clock.advance(100);
		voice.seek(3.5);
		clock.advance(500);
		assert.equal(endedCount(), 1);

		const other = setup({ endAt: 4 });
		other.voice.play();
		other.clock.advance(100);
		other.voice.seek(6);
		other.clock.advance(0);
		assert.equal(other.endedCount(), 1);
	});

	it('ends at once when the start point is past the end of the file', () => {
		const { clock, voice, endedCount } = setup({ startAt: 12 });
		voice.play();
		clock.advance(100);
		assert.equal(endedCount(), 1);
	});

	it('loops back to the start point without firing ended while looping', () => {
		const { clock, voice, endedCount } = setup({ startAt: 2 });
		voice.setLooping(true);
		voice.play();
		clock.advance(100 + 8000);
		assert.equal(endedCount(), 0);
		assert.equal(voice.position, 2);
		assert.equal(voice.playing, true);
		clock.advance(3000);
		assert.equal(voice.position, 5);
	});

	it('plays to the end and fires ended once looping is turned off', () => {
		const { clock, voice, endedCount } = setup();
		voice.setLooping(true);
		voice.play();
		clock.advance(100 + 15_000);
		assert.equal(endedCount(), 0);
		voice.setLooping(false);
		clock.advance(4999);
		assert.equal(endedCount(), 0);
		clock.advance(1);
		assert.equal(endedCount(), 1);
	});

	it('takes start and end points for buffer voices too', async () => {
		const clock = new FakeClock();
		const engine = new FakeAudioEngine(clock, { defaultScript: { duration: 10, loadDelay: 0 } });
		const loading = engine.loadBuffer('/media/b.mp3');
		clock.advance(0);
		const voice = engine.createBufferVoice({ buffer: await loading, bus: 'sfx', startAt: 1, endAt: 1.5 });
		let ended = 0;
		voice.on('ended', () => ended++);
		voice.play();
		clock.advance(0);
		assert.equal(voice.position, 1);
		clock.advance(500);
		assert.equal(ended, 1);
	});
});
