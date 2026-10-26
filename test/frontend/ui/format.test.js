import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime } from '../../../public/app/ui/format.js';

describe('formatTime', () => {
	it('shows minutes and zero-padded seconds', () => {
		assert.equal(formatTime(0), '0:00');
		assert.equal(formatTime(5.9), '0:05');
		assert.equal(formatTime(72), '1:12');
		assert.equal(formatTime(599), '9:59');
	});

	it('adds hours for long tracks', () => {
		assert.equal(formatTime(3600), '1:00:00');
		assert.equal(formatTime(3725), '1:02:05');
	});

	it('shows placeholders when the time is unknown', () => {
		assert.equal(formatTime(null), '--:--');
		assert.equal(formatTime(Number.NaN), '--:--');
		assert.equal(formatTime(Number.POSITIVE_INFINITY), '--:--');
		assert.equal(formatTime(-1), '--:--');
	});
});
