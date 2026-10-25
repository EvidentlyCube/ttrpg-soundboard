import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORT, parseArguments, UsageError } from '../../../src/cli/args.js';

describe('parseArguments', () => {
	it('takes the directory and the default port', () => {
		assert.deepEqual(parseArguments(['/music']), { directory: '/music', port: DEFAULT_PORT });
		assert.equal(DEFAULT_PORT, 3000);
	});

	it('accepts --port in both forms', () => {
		assert.deepEqual(parseArguments(['/music', '--port', '8080']), { directory: '/music', port: 8080 });
		assert.deepEqual(parseArguments(['--port=8081', '/music']), { directory: '/music', port: 8081 });
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
