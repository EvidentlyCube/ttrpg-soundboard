import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crossfadeLimits, formatSeconds, parseSeconds, SECONDS_LIMITS } from '../../../public/app/ui/seconds-scale.js';

/** @param {(number | null)[]} durations */
const tracks = (durations) => durations.map((duration) => ({ duration }));

describe('crossfadeLimits', () => {
	it('allows up to 10 s on the slider and 30 s typed when tracks are long', () => {
		assert.deepEqual(crossfadeLimits(tracks([180, 240])), { slider: 10, field: 30 });
	});

	it('allows at most half of the shortest track', () => {
		assert.deepEqual(crossfadeLimits(tracks([180, 12, 240])), { slider: 6, field: 6 });
		assert.deepEqual(crossfadeLimits(tracks([180, 30])), { slider: 10, field: 15 });
	});

	it('ignores tracks whose duration is unknown', () => {
		assert.deepEqual(crossfadeLimits(tracks([null, 8])), { slider: 4, field: 4 });
		assert.deepEqual(crossfadeLimits(tracks([null])), { slider: 10, field: 30 });
	});

	it('rounds the limit down to the slider step', () => {
		assert.deepEqual(crossfadeLimits(tracks([9.9])), { slider: 4.9, field: 4.95 });
	});

	it('never loses a whole step to floating-point noise', () => {
		// 0.3 / 0.1 is 2.9999… in floating point.
		assert.deepEqual(crossfadeLimits(tracks([0.6])), { slider: 0.3, field: 0.3 });
	});
});

describe('SECONDS_LIMITS', () => {
	it('are the limits for fades: 10 s on the slider, 30 s typed', () => {
		assert.deepEqual(SECONDS_LIMITS, { slider: 10, field: 30 });
	});
});

describe('formatSeconds', () => {
	it('shows Off for zero and seconds with three decimals otherwise', () => {
		assert.equal(formatSeconds(0), 'Off');
		assert.equal(formatSeconds(2.5), '2.500 s');
		assert.equal(formatSeconds(10), '10.000 s');
		assert.equal(formatSeconds(0.03), '0.030 s');
	});
});

describe('parseSeconds', () => {
	it('reads seconds with an optional unit and comma, and off', () => {
		assert.equal(parseSeconds('2.5'), 2.5);
		assert.equal(parseSeconds(' 3,5 s '), 3.5);
		assert.equal(parseSeconds('12s'), 12);
		assert.equal(parseSeconds('off'), 0);
		assert.equal(parseSeconds('Off'), 0);
		assert.equal(parseSeconds('0'), 0);
	});

	it('returns null for anything else', () => {
		for (const text of ['', '-1', 'two', '1e3', '3 ms']) {
			assert.equal(parseSeconds(text), null, text);
		}
	});
});
