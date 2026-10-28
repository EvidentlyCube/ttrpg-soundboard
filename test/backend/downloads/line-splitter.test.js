import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LineSplitter } from '../../../src/downloads/line-splitter.js';

/** @param {string[]} chunks */
function split(chunks) {
	/** @type {[string, boolean][]} */
	const lines = [];
	const splitter = new LineSplitter((text, transient) => lines.push([text, transient]));
	chunks.forEach((chunk) => splitter.push(chunk));
	splitter.end();
	return lines;
}

describe('LineSplitter', () => {
	it('reports lines ended by a newline', () => {
		assert.deepEqual(split(['one\ntwo\n']), [['one', false], ['two', false]]);
	});

	it('marks a line ended by a carriage return alone as transient, as a terminal overwrites it', () => {
		assert.deepEqual(split(['10%\r20%\rdone\n']), [['10%', true], ['20%', true], ['done', false]]);
	});

	it('treats \\r\\n as an ordinary line end, even split across chunks', () => {
		assert.deepEqual(split(['one\r', '\ntwo\r\n']), [['one', false], ['two', false]]);
	});

	it('joins lines split across chunks and reports what is left at the end', () => {
		assert.deepEqual(split(['par', 'tial\nlast']), [['partial', false], ['last', false]]);
	});

	it('skips empty progress updates between carriage returns', () => {
		assert.deepEqual(split(['a\r\r\rb\n']), [['a', true], ['b', false]]);
	});
});
