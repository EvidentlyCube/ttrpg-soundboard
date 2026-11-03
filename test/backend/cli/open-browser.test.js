import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { browserCommand } from '../../../src/cli/open-browser.js';

describe('browserCommand', () => {
	it('uses each system’s own command for opening an address', () => {
		const url = 'http://localhost:13872';
		assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
		assert.deepEqual(browserCommand(url, 'win32'), ['cmd', ['/c', 'start', '""', url]]);
		assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
		assert.deepEqual(browserCommand(url, 'freebsd'), ['xdg-open', [url]]);
	});
});
