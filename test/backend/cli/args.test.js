import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT, parseArguments, UsageError } from '../../../src/cli/args.js';

describe('parseArguments', () => {
	it('takes the directory, the default port and quiet output', () => {
		assert.deepEqual(parseArguments(['/music']), { directory: '/music', port: DEFAULT_PORT, verbose: false, lan: null });
		assert.equal(DEFAULT_PORT, 3000);
	});

	it('accepts --port in both forms', () => {
		assert.deepEqual(parseArguments(['/music', '--port', '8080']), { directory: '/music', port: 8080, verbose: false, lan: null });
		assert.deepEqual(parseArguments(['--port=8081', '/music']), { directory: '/music', port: 8081, verbose: false, lan: null });
	});

	it('accepts --verbose', () => {
		assert.deepEqual(parseArguments(['/music', '--verbose']), { directory: '/music', port: DEFAULT_PORT, verbose: true, lan: null });
	});

	it('accepts --lan alone, for every interface, and with an address to listen on', () => {
		assert.deepEqual(parseArguments(['/music', '--lan']).lan, { address: null });
		assert.deepEqual(parseArguments(['--lan', '/music']).lan, { address: null });
		assert.deepEqual(parseArguments(['--lan', '192.168.1.20', '/music']), { directory: '/music', port: DEFAULT_PORT, verbose: false, lan: { address: '192.168.1.20' } });
		assert.deepEqual(parseArguments(['/music', '--lan=192.168.1.20']).lan, { address: '192.168.1.20' });
		assert.deepEqual(parseArguments(['/music', '--lan', '::1']).lan, { address: '::1' });
	});

	it('rejects a --lan address that is not one', () => {
		assert.throws(() => parseArguments(['/music', '--lan=nonsense']), new UsageError('Invalid address for --lan: "nonsense".'));
	});

	it('requires exactly one directory', () => {
		assert.throws(() => parseArguments([]), new UsageError('Missing the audio directory.'));
		assert.throws(() => parseArguments(['/a', '/b']), new UsageError('Expected exactly one audio directory.'));
	});

	it('rejects invalid ports', () => {
		for (const port of ['0', '65536', 'abc', '3e3', '-1', '']) {
			assert.throws(() => parseArguments(['/music', `--port=${port}`]), new UsageError(`Invalid port: "${port}". Use a number from 1 to 65535.`));
		}
	});

	it('rejects unknown options', () => {
		assert.throws(() => parseArguments(['/music', '--yes']), UsageError);
	});
});
