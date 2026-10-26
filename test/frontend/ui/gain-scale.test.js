import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BARS_SHARE, formatDb, gainToPosition, parseDb, positionToGain, stepGain } from '../../../public/app/ui/gain-scale.js';
import { MAX_GAIN } from '../../../public/app/logic/volume.js';

/**
 * @param {number} actual
 * @param {number} expected
 */
function near(actual, expected) {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

describe('gainToPosition', () => {
	it('spreads gain 0 to 1 linearly over the bars', () => {
		near(gainToPosition(0), 0);
		near(gainToPosition(0.5), BARS_SHARE / 2);
		near(gainToPosition(1), BARS_SHARE);
	});

	it('spreads the boost from 1 to the maximum over the rest', () => {
		near(gainToPosition((1 + MAX_GAIN) / 2), BARS_SHARE + (1 - BARS_SHARE) / 2);
		near(gainToPosition(MAX_GAIN), 1);
	});

	it('clamps out-of-range gains', () => {
		near(gainToPosition(-1), 0);
		near(gainToPosition(MAX_GAIN + 1), 1);
	});
});

describe('positionToGain', () => {
	it('is the inverse of gainToPosition away from the snap zone', () => {
		for (const gain of [0, 0.25, 0.5, 0.9, 1.5, 2.5, MAX_GAIN]) {
			near(positionToGain(gainToPosition(gain)), gain);
		}
	});

	it('snaps to exactly 1 within 2 % of the width around the 100 % mark', () => {
		assert.equal(positionToGain(BARS_SHARE - 0.019), 1);
		assert.equal(positionToGain(BARS_SHARE + 0.019), 1);
		assert.notEqual(positionToGain(BARS_SHARE - 0.021), 1);
		assert.notEqual(positionToGain(BARS_SHARE + 0.021), 1);
	});

	it('clamps positions outside the widget', () => {
		assert.equal(positionToGain(-0.5), 0);
		assert.equal(positionToGain(1.5), MAX_GAIN);
	});
});

describe('formatDb', () => {
	it('shows decibels with one decimal, a sign, and a real minus', () => {
		assert.equal(formatDb(1), '0.0 dB');
		assert.equal(formatDb(2), '+6.0 dB');
		assert.equal(formatDb(0.5), '−6.0 dB');
		assert.equal(formatDb(MAX_GAIN), '+12.0 dB');
	});

	it('never shows a negative zero', () => {
		assert.equal(formatDb(0.99999), '0.0 dB');
	});

	it('shows silence as minus infinity', () => {
		assert.equal(formatDb(0), '−∞ dB');
	});
});

describe('parseDb', () => {
	it('reads numbers with an optional sign and unit', () => {
		near(/** @type {number} */ (parseDb('0')), 1);
		near(/** @type {number} */ (parseDb('+6')), 10 ** (6 / 20));
		near(/** @type {number} */ (parseDb('-6 dB')), 10 ** (-6 / 20));
		near(/** @type {number} */ (parseDb('  −3.5db ')), 10 ** (-3.5 / 20));
		near(/** @type {number} */ (parseDb('-2,5')), 10 ** (-2.5 / 20));
	});

	it('clamps to the maximum gain', () => {
		assert.equal(parseDb('20'), MAX_GAIN);
	});

	it('treats -60 dB and below, and minus infinity, as silence', () => {
		assert.equal(parseDb('-60'), 0);
		assert.equal(parseDb('-90'), 0);
		assert.equal(parseDb('-inf'), 0);
		assert.equal(parseDb('−∞ dB'), 0);
	});

	it('returns null for anything else', () => {
		for (const text of ['', 'loud', '1e', '--3', '3 dBs']) {
			assert.equal(parseDb(text), null, text);
		}
	});
});

describe('stepGain', () => {
	it('moves by whole decibels', () => {
		near(stepGain(1, 1), 10 ** (1 / 20));
		near(stepGain(1, -1), 10 ** (-1 / 20));
		near(stepGain(10 ** (-6.4 / 20), 1), 10 ** (-5 / 20));
	});

	it('steps out of silence to -59 dB and back into it below -59 dB', () => {
		near(stepGain(0, 1), 10 ** (-59 / 20));
		assert.equal(stepGain(10 ** (-59 / 20), -1), 0);
		assert.equal(stepGain(0, -1), 0);
	});

	it('stops at the maximum', () => {
		assert.equal(stepGain(MAX_GAIN, 1), MAX_GAIN);
	});
});
