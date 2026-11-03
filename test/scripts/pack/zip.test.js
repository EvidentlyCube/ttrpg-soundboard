import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createZip, EXECUTABLE_MODE, FILE_MODE } from '../../../scripts/pack/zip.js';
import { readZip } from '../../helpers/zip-reader.js';

const DATE = new Date('2026-11-03T12:34:56Z');

describe('createZip', () => {
	it('stores every entry with its path and contents', () => {
		const files = readZip(createZip([
			{ path: 'top/a.txt', data: Buffer.from('hello '.repeat(100)) },
			{ path: 'top/sub/Start Sound€.sh', data: Buffer.from('#!/bin/sh\n') },
			{ path: 'top/empty', data: Buffer.alloc(0) },
		], DATE));

		assert.deepEqual(files.map(({ path, data }) => [path, data.toString('utf8')]), [
			['top/a.txt', 'hello '.repeat(100)],
			['top/sub/Start Sound€.sh', '#!/bin/sh\n'],
			['top/empty', ''],
		]);
	});

	it('keeps Unix permissions, a plain file by default', () => {
		const files = readZip(createZip([
			{ path: 'node', data: Buffer.from('binary'), mode: EXECUTABLE_MODE },
			{ path: 'LICENSE', data: Buffer.from('text') },
		], DATE));

		assert.deepEqual(files.map(({ mode, madeOnUnix }) => [mode, madeOnUnix]), [[EXECUTABLE_MODE, true], [FILE_MODE, true]]);
	});

	it('deflates what shrinks and stores what does not', () => {
		const files = readZip(createZip([
			{ path: 'text', data: Buffer.from('a'.repeat(1000)) },
			{ path: 'noise', data: randomBytes(1000) },
		], DATE));

		assert.deepEqual(files.map(({ method }) => method), [8, 0]);
	});

	it('gives every entry the date, in UTC', () => {
		const files = readZip(createZip([{ path: 'a', data: Buffer.from('a') }, { path: 'b', data: Buffer.from('b') }], DATE));

		assert.deepEqual(files.map(({ date }) => date.toISOString()), ['2026-11-03T12:34:56.000Z', '2026-11-03T12:34:56.000Z']);
	});

	it('gives the same bytes for the same input', () => {
		const entries = [{ path: 'a', data: Buffer.from('same') }];

		assert.deepEqual(createZip(entries, DATE), createZip(entries, DATE));
	});

	it('refuses a date a zip cannot hold', () => {
		assert.throws(() => createZip([], new Date('1979-12-31T00:00:00Z')), /between 1980 and 2107/);
	});
});
