import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { progressFraction, seekPosition, trackAction, trackPlayback } from '../../../public/app/ui/track-playback.js';

describe('trackPlayback', () => {
	it('is idle for every track while the playlist is idle', () => {
		assert.equal(trackPlayback('idle', 1, 1), 'idle');
	});

	it('is idle for tracks other than the current one', () => {
		assert.equal(trackPlayback('playing', 2, 1), 'idle');
	});

	it('is playing for the current track while loading or playing', () => {
		assert.equal(trackPlayback('loading', 1, 1), 'playing');
		assert.equal(trackPlayback('playing', 1, 1), 'playing');
	});

	it('is paused for the current track while paused', () => {
		assert.equal(trackPlayback('paused', 1, 1), 'paused');
	});

	it('is idle when the playlist has no current track', () => {
		assert.equal(trackPlayback('playing', null, 0), 'idle');
	});
});

describe('trackAction', () => {
	it('starts an idle track, resumes a paused one and stops a playing one', () => {
		assert.equal(trackAction('idle'), 'start');
		assert.equal(trackAction('paused'), 'resume');
		assert.equal(trackAction('playing'), 'stop');
	});
});

describe('progressFraction', () => {
	it('is the share of the duration, clamped to 0..1', () => {
		assert.equal(progressFraction(30, 120), 0.25);
		assert.equal(progressFraction(-1, 120), 0);
		assert.equal(progressFraction(130, 120), 1);
	});

	it('is 0 without a usable duration', () => {
		assert.equal(progressFraction(5, null), 0);
		assert.equal(progressFraction(5, 0), 0);
	});
});

describe('seekPosition', () => {
	it('maps a pointer position on the bar to seconds', () => {
		assert.equal(seekPosition(150, { left: 100, width: 200 }, 80), 20);
	});

	it('clamps a pointer outside the bar', () => {
		assert.equal(seekPosition(50, { left: 100, width: 200 }, 80), 0);
		assert.equal(seekPosition(400, { left: 100, width: 200 }, 80), 80);
	});

	it('is null without a duration or a width', () => {
		assert.equal(seekPosition(150, { left: 100, width: 200 }, null), null);
		assert.equal(seekPosition(150, { left: 100, width: 0 }, 80), null);
	});
});
