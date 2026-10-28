import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trackAction, trackPlayback } from '../../../public/app/ui/track-playback.js';

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
