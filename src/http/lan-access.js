import { isMediaPath } from './media.js';
import { HttpError } from './responses.js';

/** The cookie of a device that was allowed from this machine (`access-control.js`). */
export const DEVICE_COOKIE = 'soundboard-device';

/** What a banned address is told; the connect page tells it from other refusals by this text. */
export const BANNED_MESSAGE = 'This address is blocked';

/** What a device that is not allowed yet may fetch: the connect page and what it loads. */
const CONNECT_FILES = [
	'/connect.html',
	'/favicon.svg',
	'/app/connect.js',
	'/app/browser-clock.js',
	'/app/logic/access-requester.js',
	'/app/ui/dom.js',
];
const CONNECT_VENDOR_PREFIX = '/vendor/tailwindcss-browser';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('./access-control.js').AccessControl} AccessControl */

/**
 * @param {string | undefined} address a socket's remote address
 * @returns {boolean} whether the connection comes from this machine
 */
export function isLoopbackAddress(address) {
	return address === '127.0.0.1' || address === '::1' || address?.startsWith('127.') === true || address === '::ffff:127.0.0.1';
}

/**
 * With `--lan`, decides what a request from another machine may do (DESIGN.md §5.2). A banned address gets nothing.
 * A device that was allowed (it holds the cookie) may reach the static files, the remote routes and the event stream of
 * a remote. Any other device may only reach the connect page, where it asks to be paired. Everything else, deletions,
 * downloads, volumes and the audio included, is for the pages on this machine. Requests from this machine are not
 * checked.
 * @param {Request} request
 * @param {string} pathname
 * @param {{ control: AccessControl }} access
 * @returns {{ connect: true } | null} `connect` means the device is not allowed yet and the page it asked for is the
 * 	connect page
 * @throws {HttpError} 403
 */
export function checkAccess(request, pathname, { control }) {
	const address = request.socket.remoteAddress;
	if (isLoopbackAddress(address)) {
		return null;
	}
	if (address === undefined) {
		throw new HttpError(403, 'Request not allowed');
	}
	if (control.isBanned(address)) {
		throw new HttpError(403, BANNED_MESSAGE);
	}
	const url = new URL(request.url ?? '/', 'http://localhost');
	const device = cookieValue(request.headers.cookie, DEVICE_COOKIE);
	const isGet = request.method === 'GET' || request.method === 'HEAD';

	if (device === null || !control.isAllowed(device)) {
		if (isGet && (pathname === '/' || pathname === '/index.html')) {
			return { connect: true };
		}
		const connectRoute = (pathname === '/api/access/requests' && request.method === 'POST')
			|| (pathname === '/api/access/requests/mine' && request.method === 'GET');
		if (connectRoute || (isGet && (CONNECT_FILES.includes(pathname) || pathname.startsWith(CONNECT_VENDOR_PREFIX)))) {
			return null;
		}
		throw new HttpError(403, 'Request not allowed');
	}
	const allowed = (isGet && !pathname.startsWith('/api/') && !isMediaPath(pathname))
		|| pathname === '/api/remote'
		|| pathname.startsWith('/api/remote/')
		|| (pathname === '/api/events' && url.searchParams.get('role') === 'remote');
	if (!allowed) {
		throw new HttpError(403, 'Request not allowed');
	}
	return null;
}

/**
 * `Lax`, not `Strict`: a link opened from another app, such as a camera scanning a QR code, is a cross-site navigation,
 * and `Strict` would leave the cookie out of it, so an allowed device would be shown the connect page again.
 * @param {string} secret
 * @returns {string} the `Set-Cookie` value that keeps an allowed device's secret
 */
export function deviceCookie(secret) {
	return `${DEVICE_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax`;
}

/**
 * @param {string | undefined} header
 * @param {string} name
 * @returns {string | null}
 */
function cookieValue(header, name) {
	for (const part of header?.split(';') ?? []) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) {
			return rest.join('=');
		}
	}
	return null;
}
