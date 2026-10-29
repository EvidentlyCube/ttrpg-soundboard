import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccess, isLoopbackAddress, TOKEN_COOKIE } from '../../../src/http/lan-access.js';
import { HttpError } from '../../../src/http/responses.js';

const TOKEN = 'a1b2c3';

/**
 * @param {string} url
 * @param {{ address?: string, method?: string, cookie?: string }} [options]
 */
function check(url, { address = '192.168.1.50', method = 'GET', cookie } = {}) {
	const request = /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ ({
		url,
		method,
		headers: { cookie },
		socket: { remoteAddress: address },
	}));
	return checkAccess(request, url.split('?')[0], { token: TOKEN });
}

/** @param {() => unknown} action */
function assertRefused(action) {
	assert.throws(action, (error) => error instanceof HttpError && error.status === 403);
}

const withCookie = { cookie: `${TOKEN_COOKIE}=${TOKEN}` };

describe('isLoopbackAddress', () => {
	it('knows the addresses of this machine', () => {
		for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.5']) {
			assert.equal(isLoopbackAddress(address), true, address);
		}
		for (const address of ['192.168.1.50', '10.0.0.2', '::ffff:10.0.0.2', undefined]) {
			assert.equal(isLoopbackAddress(address), false, String(address));
		}
	});
});

describe('checkAccess', () => {
	it('lets requests from this machine through without a token', () => {
		assert.equal(check('/api/settings/volumes', { address: '127.0.0.1', method: 'PUT' }), null);
		assert.equal(check('/media/Boom.mp3', { address: '::1' }), null);
	});

	it('refuses a request from another machine without the token', () => {
		assertRefused(() => check('/'));
		assertRefused(() => check('/api/remote'));
		assertRefused(() => check('/', { cookie: `${TOKEN_COOKIE}=wrong` }));
		assertRefused(() => check('/?token=wrong'));
		assertRefused(() => check('/', { cookie: `${TOKEN_COOKIE}=` }));
	});

	it('turns the token in a link into a cookie and a redirect without it', () => {
		assert.deepEqual(check(`/?token=${TOKEN}`), {
			redirectTo: '/',
			cookie: `${TOKEN_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`,
		});
	});

	it('lets the pages, the remote routes and a remote\'s event stream through with the cookie', () => {
		for (const [url, method] of [
			['/', 'GET'],
			['/app/main.js', 'GET'],
			['/vendor/tailwindcss-browser-4.3.3.js', 'HEAD'],
			['/api/remote', 'GET'],
			['/api/remote/commands', 'POST'],
			['/api/remote/host', 'PUT'],
			['/api/events?role=remote', 'GET'],
		]) {
			assert.equal(check(url, { ...withCookie, method }), null, `${method} ${url}`);
		}
	});

	it('keeps everything else for this machine, even with the cookie', () => {
		for (const [url, method] of [
			['/api/library', 'GET'],
			['/api/settings', 'GET'],
			['/api/settings/volumes', 'PUT'],
			['/api/sounds/Boom.mp3', 'DELETE'],
			['/api/move', 'POST'],
			['/api/download', 'POST'],
			['/api/refresh', 'POST'],
			['/api/trash/delete', 'POST'],
			['/api/events', 'GET'],
			['/api/events?role=host', 'GET'],
			['/api/remotely', 'GET'],
			['/media/Boom.mp3', 'GET'],
			['/', 'POST'],
			['/', 'DELETE'],
		]) {
			assertRefused(() => check(url, { ...withCookie, method }));
		}
	});

	it('does not accept the token in a link for anything but a page', () => {
		assertRefused(() => check(`/api/library?token=${TOKEN}`));
		assert.equal(check(`/api/remote?token=${TOKEN}`), null);
	});
});
