import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRequest, LOOPBACK_HOSTS } from '../../../src/http/request-guard.js';
import { HttpError } from '../../../src/http/responses.js';

const OPTIONS = { hosts: LOOPBACK_HOSTS, port: 3000 };

/** @param {import('node:http').IncomingHttpHeaders} headers */
function rejected(headers) {
	return assert.throws(() => checkRequest(headers, OPTIONS), (error) => {
		assert.ok(error instanceof HttpError);
		assert.equal(error.status, 403);
		assert.equal(error.message, 'Request not allowed');
		return true;
	});
}

describe('checkRequest', () => {
	describe('Host', () => {
		it('accepts each loopback name with the server port', () => {
			for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000']) {
				checkRequest({ host }, OPTIONS);
			}
		});

		it('ignores the case of the name', () => {
			checkRequest({ host: 'LocalHost:3000' }, OPTIONS);
		});

		it('rejects a missing Host', () => {
			rejected({});
		});

		it('rejects a wrong port, or none', () => {
			rejected({ host: '127.0.0.1:3001' });
			rejected({ host: '127.0.0.1' });
		});

		it('rejects other names, including ones that only look like loopback', () => {
			rejected({ host: 'evil.example:3000' });
			rejected({ host: 'localhost.evil.example:3000' });
			rejected({ host: 'evil-localhost:3000' });
			rejected({ host: 'localhost.:3000' });
			rejected({ host: '127.0.0.2:3000' });
		});
	});

	describe('Origin', () => {
		const host = '127.0.0.1:3000';

		it('passes a request without one', () => {
			checkRequest({ host }, OPTIONS);
		});

		it('accepts the server own origin, under any of its names', () => {
			checkRequest({ host, origin: 'http://127.0.0.1:3000' }, OPTIONS);
			checkRequest({ host: 'localhost:3000', origin: 'http://localhost:3000' }, OPTIONS);
			checkRequest({ host: '[::1]:3000', origin: 'http://[::1]:3000' }, OPTIONS);
		});

		it('rejects a foreign origin', () => {
			rejected({ host, origin: 'https://evil.example' });
			rejected({ host, origin: 'http://127.0.0.1:3001' });
			rejected({ host, origin: 'http://127.0.0.1:3000.evil.example' });
		});

		it('rejects the opaque origin and other schemes', () => {
			rejected({ host, origin: 'null' });
			rejected({ host, origin: 'https://127.0.0.1:3000' });
			rejected({ host, origin: '' });
		});
	});

	it('takes the accepted names from its options', () => {
		const options = { hosts: ['192.168.1.20'], port: 3000 };
		checkRequest({ host: '192.168.1.20:3000', origin: 'http://192.168.1.20:3000' }, options);
		assert.throws(() => checkRequest({ host: '127.0.0.1:3000' }, options), HttpError);
	});
});
