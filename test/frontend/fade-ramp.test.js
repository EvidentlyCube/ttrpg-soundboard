import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FULL, levelAt, rampTo } from '../../public/app/logic/fade-ramp.js';

describe('fade ramps', () => {
	it('start at full level', () => {
		assert.equal(levelAt(FULL, 0), 1);
		assert.equal(levelAt(FULL, 1000), 1);
	});

	it('follow a linear ramp and hold its target afterwards', () => {
		const ramp = rampTo(FULL, 0, 2, 10);
		assert.deepEqual(ramp, { from: 1, to: 0, start: 10, end: 12 });
		assert.equal(levelAt(ramp, 10), 1);
		assert.equal(levelAt(ramp, 11), 0.5);
		assert.equal(levelAt(ramp, 12), 0);
		assert.equal(levelAt(ramp, 99), 0);
	});

	it('jump at once for a zero-length ramp, so a fade-in scheduled straight after starts from silence', () => {
		const silent = rampTo(FULL, 0, 0, 5);
		assert.equal(levelAt(silent, 5), 0);
		const fadeIn = rampTo(silent, 1, 2, 5);
		assert.deepEqual(fadeIn, { from: 0, to: 1, start: 5, end: 7 });
		assert.equal(levelAt(fadeIn, 6), 0.5);
	});

	it('continue from the level reached when a ramp is interrupted', () => {
		const fadeIn = rampTo(rampTo(FULL, 0, 0, 0), 1, 4, 0);
		const fadeOut = rampTo(fadeIn, 0, 2, 1);
		assert.deepEqual(fadeOut, { from: 0.25, to: 0, start: 1, end: 3 });
	});
});
