import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLAYBACK_RULES, planTrack, resolvePlaybackRules } from '../../public/app/logic/playback-rules.js';
import { isTransition, resolveTransition } from '../../public/app/logic/transitions.js';

const FADING_RULES = { ...DEFAULT_PLAYBACK_RULES, fadeIn: 2, fadeOut: 3, crossfade: 4 };

describe('playback rules', () => {
	it('defaults to sequential, looping and no fades', () => {
		assert.deepEqual(DEFAULT_PLAYBACK_RULES, { order: 'sequential', loop: true, fadeIn: 0, fadeOut: 0, crossfade: 0 });
		assert.equal(resolvePlaybackRules({ id: 'Combat', title: 'Combat', gain: 1, tracks: [] }), DEFAULT_PLAYBACK_RULES);
	});

	it('plans every track to play from start to end', () => {
		const track = { id: 'a.mp3', title: 'a', format: /** @type {const} */ ('mp3'), size: 1, gain: 1, duration: 1, url: '/media/a.mp3' };
		assert.deepEqual(planTrack(track, DEFAULT_PLAYBACK_RULES), { startAt: 0, endAt: null });
	});
});

describe('resolveTransition', () => {
	it('makes instant transitions immediate and kills fading voices, whatever the rules say', () => {
		for (const action of /** @type {const} */ (['play', 'stop', 'change'])) {
			assert.deepEqual(resolveTransition(action, 'instant', FADING_RULES), { fadeInSeconds: 0, fadeOutSeconds: 0, killRetiring: true });
		}
	});

	it('takes default timings from the rules', () => {
		assert.deepEqual(resolveTransition('play', 'default', FADING_RULES), { fadeInSeconds: 2, fadeOutSeconds: 0, killRetiring: false });
		assert.deepEqual(resolveTransition('stop', 'default', FADING_RULES), { fadeInSeconds: 0, fadeOutSeconds: 3, killRetiring: false });
		assert.deepEqual(resolveTransition('change', 'default', FADING_RULES), { fadeInSeconds: 4, fadeOutSeconds: 4, killRetiring: false });
	});

	it('behaves like instant with the current default rules, apart from killing', () => {
		assert.deepEqual(resolveTransition('change', 'default', DEFAULT_PLAYBACK_RULES), { fadeInSeconds: 0, fadeOutSeconds: 0, killRetiring: false });
	});
});

describe('isTransition', () => {
	it('accepts only the two transitions', () => {
		assert.equal(isTransition('default'), true);
		assert.equal(isTransition('instant'), true);
		assert.equal(isTransition('fade'), false);
		assert.equal(isTransition(undefined), false);
	});
});
