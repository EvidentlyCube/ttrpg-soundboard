import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccessControl } from '../../../src/http/access-control.js';
import { BANNED_MESSAGE, checkAccess, DEVICE_COOKIE, isLoopbackAddress } from '../../../src/http/lan-access.js';
import { HttpError } from '../../../src/http/responses.js';

const PHONE = '192.168.1.50';

/** @returns {{ control: AccessControl, cookie: string }} a control with one allowed device and that device's cookie */
function allowedDevice() {
	const control = new AccessControl();
	control.request(PHONE);
	control.answer(PHONE, 'allow');
	const { secret } = /** @type {{ secret: string }} */ (control.status(PHONE));
	return { control, cookie: `${DEVICE_COOKIE}=${secret}` };
}

/**
 * @param {AccessControl} control
 * @param {string} url
 * @param {{ address?: string, method?: string, cookie?: string }} [options]
 */
function check(control, url, { address = PHONE, method = 'GET', cookie } = {}) {
	const request = /** @type {import('node:http').IncomingMessage} */ (/** @type {unknown} */ ({
		url,
		method,
		headers: { cookie },
		socket: { remoteAddress: address },
	}));
	return checkAccess(request, url.split('?')[0], { control });
}

/**
 * @param {() => unknown} action
 * @param {string} [message]
 */
function assertRefused(action, message) {
	assert.throws(action, (error) => error instanceof HttpError && error.status === 403 && (message === undefined || error.message === message));
}

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
	it('lets requests from this machine through', () => {
		const control = new AccessControl();
		assert.equal(check(control, '/api/settings/volumes', { address: '127.0.0.1', method: 'PUT' }), null);
		assert.equal(check(control, '/media/Boom.mp3', { address: '::1' }), null);
	});

	it('shows the connect page to a device that is not allowed', () => {
		const control = new AccessControl();
		assert.deepEqual(check(control, '/'), { connect: true });
		assert.deepEqual(check(control, '/index.html'), { connect: true });
		assert.deepEqual(check(control, '/', { cookie: `${DEVICE_COOKIE}=wrong` }), { connect: true });
	});

	it('lets a device that is not allowed fetch only the connect page and ask to be paired', () => {
		const control = new AccessControl();
		for (const [url, method] of [
			['/connect.html', 'GET'],
			['/favicon.svg', 'GET'],
			['/app/connect.js', 'GET'],
			['/vendor/tailwindcss-browser-4.3.3.js', 'GET'],
			['/api/access/requests', 'POST'],
			['/api/access/requests/mine', 'GET'],
		]) {
			assert.equal(check(control, url, { method }), null, `${method} ${url}`);
		}
		for (const [url, method] of [
			['/app/main.js', 'GET'],
			['/api/remote', 'GET'],
			['/api/library', 'GET'],
			['/api/access/links', 'GET'],
			['/api/access/requests/answer', 'POST'],
			['/api/access/requests', 'GET'],
			['/api/events?role=remote', 'GET'],
			['/media/Boom.mp3', 'GET'],
		]) {
			assertRefused(() => check(control, url, { method }));
		}
	});

	it("lets the pages, the remote routes and a remote's event stream through for an allowed device", () => {
		const { control, cookie } = allowedDevice();
		for (const [url, method] of [
			['/', 'GET'],
			['/app/main.js', 'GET'],
			['/vendor/tailwindcss-browser-4.3.3.js', 'HEAD'],
			['/api/remote', 'GET'],
			['/api/remote/commands', 'POST'],
			['/api/remote/host', 'PUT'],
			['/api/events?role=remote', 'GET'],
		]) {
			assert.equal(check(control, url, { cookie, method }), null, `${method} ${url}`);
		}
	});

	it('keeps everything else for this machine, even for an allowed device', () => {
		const { control, cookie } = allowedDevice();
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
			['/api/access/links', 'GET'],
			['/api/access/requests/answer', 'POST'],
			['/media/Boom.mp3', 'GET'],
			['/', 'POST'],
			['/', 'DELETE'],
		]) {
			assertRefused(() => check(control, url, { cookie, method }));
		}
	});

	it('refuses a banned address everywhere and says why', () => {
		const { control, cookie } = allowedDevice();
		while (!control.strike(PHONE)) {
			// Asking too often is what gets an address banned.
		}
		assertRefused(() => check(control, '/', { cookie }), BANNED_MESSAGE);
		assertRefused(() => check(control, '/api/access/requests', { method: 'POST' }), BANNED_MESSAGE);
		assert.equal(check(control, '/', { address: '192.168.1.51' })?.connect, true);
	});
});
