import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readTarGz } from '../../../scripts/pack/tar.js';
import { gnuLongName, paxPath, tarGz } from '../../helpers/tar-builder.js';

describe('readTarGz', () => {
	it('returns the regular files with their paths, permissions and contents', () => {
		const files = readTarGz(tarGz([
			{ path: 'node-v1/bin/node', data: 'x'.repeat(1000), mode: 0o755 },
			{ path: 'node-v1/LICENSE', data: 'license' },
		]));

		assert.deepEqual(files.map(({ path, mode, data }) => [path, mode, data.toString('utf8')]), [
			['node-v1/bin/node', 0o755, 'x'.repeat(1000)],
			['node-v1/LICENSE', 0o644, 'license'],
		]);
	});

	it('skips links and folders', () => {
		const files = readTarGz(tarGz([
			{ path: 'node-v1/', type: '5' },
			{ path: 'node-v1/bin/npm', type: '2' },
			{ path: 'node-v1/LICENSE', data: 'license' },
		]));

		assert.deepEqual(files.map(({ path }) => path), ['node-v1/LICENSE']);
	});

	it('reads long paths from GNU and pax headers, and the ustar prefix', () => {
		const long = `node-v1/${'n'.repeat(120)}`;
		const files = readTarGz(tarGz([
			gnuLongName(long),
			{ path: long.slice(0, 100), data: 'gnu' },
			paxPath(`${long}-pax`),
			{ path: 'cut', data: 'pax' },
			{ path: 'file', prefix: 'node-v1/deep', data: 'prefix' },
			{ path: 'after', data: 'plain' },
		]));

		assert.deepEqual(files.map(({ path, data }) => [path, data.toString('utf8')]), [
			[long, 'gnu'],
			[`${long}-pax`, 'pax'],
			['node-v1/deep/file', 'prefix'],
			['after', 'plain'],
		]);
	});
});
