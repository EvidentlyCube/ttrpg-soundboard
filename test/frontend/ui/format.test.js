import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatMegabytes, formatTime } from '../../../public/app/ui/format.js';

describe('formatMegabytes', () => {
	it('shows megabytes below a gigabyte, with one decimal below 10', () => {
		assert.equal(formatMegabytes(4_210_000), '4.2 MB');
		assert.equal(formatMegabytes(340_400_000), '340 MB');
	});

	it('switches to gigabytes from 1 GB on', () => {
		assert.equal(formatMegabytes(1_000_000_000), '1.0 GB');
		assert.equal(formatMegabytes(12_600_000_000), '13 GB');
	});

	it('never shows less than 0.1 MB', () => {
		assert.equal(formatMegabytes(12), '0.1 MB');
	});
});

describe('formatBytes', () => {
	it('uses decimal units, with a decimal below 10', () => {
		assert.equal(formatBytes(0), '0 B');
		assert.equal(formatBytes(999), '999 B');
		assert.equal(formatBytes(252_182), '252 KB');
		assert.equal(formatBytes(1_400_000_000), '1.4 GB');
		assert.equal(formatBytes(45_600_000), '46 MB');
	});
});

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
