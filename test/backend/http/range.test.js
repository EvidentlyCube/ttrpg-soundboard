import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../../../src/http/range.js';

const SIZE = 1000;

describe('parseRange', () => {
	it('means the whole file when there is no header', () => {
		assert.deepEqual(parseRange(undefined, SIZE), { type: 'none' });
	});

	it('parses a closed range', () => {
		assert.deepEqual(parseRange('bytes=0-99', SIZE), { type: 'range', start: 0, end: 99 });
		assert.deepEqual(parseRange('bytes=500-500', SIZE), { type: 'range', start: 500, end: 500 });
	});

	it('clamps the end to the last byte', () => {
		assert.deepEqual(parseRange('bytes=900-5000', SIZE), { type: 'range', start: 900, end: 999 });
	});

	it('parses an open-ended range', () => {
		assert.deepEqual(parseRange('bytes=100-', SIZE), { type: 'range', start: 100, end: 999 });
	});

	it('parses a suffix range', () => {
		assert.deepEqual(parseRange('bytes=-100', SIZE), { type: 'range', start: 900, end: 999 });
		assert.deepEqual(parseRange('bytes=-5000', SIZE), { type: 'range', start: 0, end: 999 });
	});

	it('serves only the first of several ranges', () => {
		assert.deepEqual(parseRange('bytes=0-9, 20-29', SIZE), { type: 'range', start: 0, end: 9 });
	});

	it('tolerates whitespace and a differently cased unit', () => {
		assert.deepEqual(parseRange(' Bytes = 10 - 20 ', SIZE), { type: 'range', start: 10, end: 20 });
	});

	it('is unsatisfiable when the range starts past the end', () => {
		assert.deepEqual(parseRange('bytes=1000-', SIZE), { type: 'unsatisfiable' });
		assert.deepEqual(parseRange('bytes=1000-2000', SIZE), { type: 'unsatisfiable' });
		assert.deepEqual(parseRange('bytes=-0', SIZE), { type: 'unsatisfiable' });
		assert.deepEqual(parseRange('bytes=0-', 0), { type: 'unsatisfiable' });
	});

	it('ignores malformed headers and serves the whole file', () => {
		for (const header of ['', 'bytes', 'bytes=', 'bytes=-', 'bytes=abc', 'bytes=5-1', 'bytes=1-2-3', 'items=0-1', 'bytes=0x1-2', 'bytes=1.5-2']) {
			assert.deepEqual(parseRange(header, SIZE), { type: 'none' }, header);
		}
	});
});
