import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT, parseArguments, UsageError } from '../../../src/cli/args.js';

const DEFAULTS = { directories: ['/music'], port: DEFAULT_PORT, verbose: false, open: true, lan: null };

describe('parseArguments', () => {
	it('takes the directory, the default port, quiet output and opening the browser', () => {
		assert.deepEqual(parseArguments(['/music']), DEFAULTS);
		assert.equal(DEFAULT_PORT, 13872);
	});

	it('takes no directory, or several', () => {
		assert.deepEqual(parseArguments([]).directories, []);
		assert.deepEqual(parseArguments(['/a', '/b']).directories, ['/a', '/b']);
	});

	it('accepts --port in both forms', () => {
		assert.deepEqual(parseArguments(['/music', '--port', '8080']), { ...DEFAULTS, port: 8080 });
		assert.deepEqual(parseArguments(['--port=8081', '/music']), { ...DEFAULTS, port: 8081 });
	});

	it('accepts --verbose and --no-open', () => {
		assert.deepEqual(parseArguments(['/music', '--verbose']), { ...DEFAULTS, verbose: true });
		assert.deepEqual(parseArguments(['/music', '--no-open']), { ...DEFAULTS, open: false });
	});

	it('accepts --lan alone, for every interface, and with an address to listen on', () => {
		assert.deepEqual(parseArguments(['/music', '--lan']).lan, { address: null });
		assert.deepEqual(parseArguments(['--lan', '/music']).lan, { address: null });
		assert.deepEqual(parseArguments(['--lan', '192.168.1.20', '/music']), { ...DEFAULTS, lan: { address: '192.168.1.20' } });
		assert.deepEqual(parseArguments(['/music', '--lan=192.168.1.20']).lan, { address: '192.168.1.20' });
		assert.deepEqual(parseArguments(['/music', '--lan', '::1']).lan, { address: '::1' });
	});

	it('reads the wildcard addresses as every interface, so the links list real addresses', () => {
		assert.deepEqual(parseArguments(['/music', '--lan=0.0.0.0']).lan, { address: null });
		assert.deepEqual(parseArguments(['--lan', '::', '/music']).lan, { address: null });
	});

	it('rejects a --lan address that is not one', () => {
		assert.throws(() => parseArguments(['/music', '--lan=nonsense']), new UsageError('Invalid address for --lan: "nonsense".'));
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
