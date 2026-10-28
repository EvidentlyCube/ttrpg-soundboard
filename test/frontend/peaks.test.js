import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePeaks } from '../../public/app/logic/peaks.js';

describe('computePeaks', () => {
	it('keeps the lowest and highest sample of each bucket, scaled to bytes', () => {
		const peaks = computePeaks([Float32Array.of(0.5, -0.25, 1, -1)], 2);
		assert.deepEqual([...peaks], [-32, 64, -127, 127]);
	});

	it('takes the extremes across channels', () => {
		const peaks = computePeaks([Float32Array.of(0.5, -0.5), Float32Array.of(-1, 0.25)], 1);
		assert.deepEqual([...peaks], [-127, 64]);
	});

	it('gives every bucket a sample when the audio is shorter than the bucket count', () => {
		const peaks = computePeaks([Float32Array.of(1, -1)], 4);
		assert.deepEqual([...peaks], [0, 127, 0, 127, -127, 0, -127, 0]);
	});

	it('clips samples beyond full scale', () => {
		const peaks = computePeaks([Float32Array.of(3, -3)], 1);
		assert.deepEqual([...peaks], [-127, 127]);
	});

	it('returns flat peaks for silence and for no audio at all', () => {
		assert.deepEqual([...computePeaks([new Float32Array(100)], 3)], [0, 0, 0, 0, 0, 0]);
		assert.deepEqual([...computePeaks([], 2)], [0, 0, 0, 0]);
	});

	it('fills 1024 buckets by default', () => {
		assert.equal(computePeaks([new Float32Array(5000)]).length, 2048);
	});
});
