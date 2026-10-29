import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shapeLevels, waveformColumns } from '../../../public/app/ui/waveform-draw.js';

/** @param {number[]} values */
const shaped = (values) => [...shapeLevels(Float32Array.from(values))];

describe('waveformColumns', () => {
	it('scales to the loudest peak, then shapes the levels', () => {
		const columns = waveformColumns(Int8Array.of(-20, 40, -10, 20), 2);
		assert.deepEqual([...columns], shaped([-0.5, 1, -0.25, 0.5]));
	});

	it('merges buckets when there are fewer columns', () => {
		const columns = waveformColumns(Int8Array.of(-10, 5, -40, 20, -5, 40, -1, 1), 2);
		assert.deepEqual([...columns], shaped([-1, 0.5, -0.125, 1]));
	});

	it('repeats buckets when there are more columns', () => {
		const columns = waveformColumns(Int8Array.of(-10, 10), 3);
		assert.deepEqual([...columns], shaped([-1, 1, -1, 1, -1, 1]));
	});

	it('draws silence flat', () => {
		assert.deepEqual([...waveformColumns(new Int8Array(8), 2)], [0, 0, 0, 0]);
	});
});

describe('shapeLevels', () => {
	it('keeps silence at zero and the signs of the others', () => {
		const [silent, low, high] = shaped([0, -0.5, 0.5]);
		assert.equal(silent, 0);
		assert.ok(low < 0 && high > 0);
		assert.equal(low, -high);
	});

	it('keeps the order of levels, with the loudest close to full height', () => {
		const levels = shaped([0.05, 0.2, 0.5, 0.9, 1]);
		assert.deepEqual(levels, levels.toSorted((a, b) => a - b));
		assert.ok(levels[4] > 0.85, `loudest ${levels[4]}`);
	});

	it('lifts quiet stretches well above a linear scale', () => {
		const [quiet] = shaped([0.02, 1, 1, 1]);
		// Linear would be 0.02.
		assert.ok(quiet > 0.1, `quiet ${quiet}`);
	});

	it('spreads a track that is loud throughout over more of the height', () => {
		const levels = shaped([0.8, 0.85, 0.9, 0.95, 1]);
		assert.ok(levels[4] - levels[0] > 0.3, `from ${levels[0]} to ${levels[4]}`);
	});

	it('draws a track of one loudness at one height, not as a ramp', () => {
		assert.equal(new Set(shaped([0.5, 0.5, 0.5, 0.5])).size, 1);
	});
});
