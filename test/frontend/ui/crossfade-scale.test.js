import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crossfadeLimits, formatSeconds, parseSeconds } from '../../../public/app/ui/crossfade-scale.js';

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
		assert.deepEqual(crossfadeLimits(tracks([9.9])), { slider: 4.5, field: 4.95 });
	});
});

describe('formatSeconds', () => {
	it('shows Off for zero and seconds with one decimal otherwise', () => {
		assert.equal(formatSeconds(0), 'Off');
		assert.equal(formatSeconds(2.5), '2.5 s');
		assert.equal(formatSeconds(10), '10.0 s');
		assert.equal(formatSeconds(1.25), '1.3 s');
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
