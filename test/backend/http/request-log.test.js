import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRequestLog } from '../../../src/http/request-log.js';

describe('formatRequestLog', () => {
	it('shows method, raw path, status and rounded duration', () => {
		assert.equal(
			formatRequestLog({ method: 'GET', url: '/api/library', status: 200, range: undefined, durationMs: 3.6, aborted: false }),
			'GET /api/library 200 4ms',
		);
	});

	it('includes the range header when there was one', () => {
		assert.equal(
			formatRequestLog({ method: 'GET', url: '/media/Combat/01%20Battle.mp3', status: 206, range: 'bytes=0-1023', durationMs: 12, aborted: false }),
			'GET /media/Combat/01%20Battle.mp3 206 bytes=0-1023 12ms',
		);
	});

	it('marks requests whose client disconnected first', () => {
		assert.equal(
			formatRequestLog({ method: 'GET', url: '/media/a.ogg', status: 200, range: undefined, durationMs: 40.2, aborted: true }),
			'GET /media/a.ogg 200 40ms (aborted)',
		);
	});
});
