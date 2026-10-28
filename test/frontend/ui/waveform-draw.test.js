import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waveformColumns } from '../../../public/app/ui/waveform-draw.js';

describe('waveformColumns', () => {
	it('scales the loudest peak to full height', () => {
		const columns = waveformColumns(Int8Array.of(-20, 40, -10, 20), 2);
		assert.deepEqual([...columns], [-0.5, 1, -0.25, 0.5]);
	});

	it('merges buckets when there are fewer columns', () => {
		const columns = waveformColumns(Int8Array.of(-10, 5, -40, 20, -5, 40, -1, 1), 2);
		assert.deepEqual([...columns], [-1, 0.5, -0.125, 1]);
	});

	it('repeats buckets when there are more columns', () => {
		const columns = waveformColumns(Int8Array.of(-10, 10), 3);
		assert.deepEqual([...columns], [-1, 1, -1, 1, -1, 1]);
	});

	it('draws silence flat', () => {
		assert.deepEqual([...waveformColumns(new Int8Array(8), 2)], [0, 0, 0, 0]);
	});
});
