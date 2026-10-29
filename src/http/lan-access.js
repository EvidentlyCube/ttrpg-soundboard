import { timingSafeEqual } from 'node:crypto';
import { isMediaPath } from './media.js';
import { HttpError } from './responses.js';

/** The cookie that keeps the token after the first visit through the link that carries it. */
export const TOKEN_COOKIE = 'soundboard-token';

/** @typedef {import('node:http').IncomingMessage} Request */

/**
 * @param {string | undefined} address a socket's remote address
 * @returns {boolean} whether the connection comes from this machine
 */
export function isLoopbackAddress(address) {
	return address === '127.0.0.1' || address === '::1' || address?.startsWith('127.') === true || address === '::ffff:127.0.0.1';
}

/**
 * With `--lan`, decides what a request from another machine may do (DESIGN.md §5.2): it needs the token, and may only
 * reach the static files, the remote routes and the event stream of a remote. Everything else, deletions, downloads,
 * volumes and the audio included, is for the pages on this machine. Requests from this machine are not checked.
 * @param {Request} request
 * @param {string} pathname
 * @param {{ token: string }} access
 * @returns {{ redirectTo: string, cookie: string } | null} set when the token came in the link: the request is answered
 * 	with a redirect to the same address without it, which also sets the cookie
 * @throws {HttpError} 403
 */
export function checkAccess(request, pathname, { token }) {
	if (isLoopbackAddress(request.socket.remoteAddress)) {
		return null;
	}
	const url = new URL(request.url ?? '/', 'http://localhost');
	const fromCookie = cookieValue(request.headers.cookie, TOKEN_COOKIE);
	const fromLink = url.searchParams.get('token');
	const isGet = request.method === 'GET' || request.method === 'HEAD';
	const isPage = isGet && !pathname.startsWith('/api/') && !isMediaPath(pathname);

	const linkIsValid = fromLink !== null && sameToken(fromLink, token);
	if (!linkIsValid && !(fromCookie !== null && sameToken(fromCookie, token))) {
		throw new HttpError(403, 'Request not allowed');
	}
	const allowed = isPage
		|| pathname === '/api/remote'
		|| pathname.startsWith('/api/remote/')
		|| (pathname === '/api/events' && url.searchParams.get('role') === 'remote');
	if (!allowed) {
		throw new HttpError(403, 'Request not allowed');
	}
	if (linkIsValid && isPage) {
		url.searchParams.delete('token');
		return {
			redirectTo: `${url.pathname}${url.search}`,
			cookie: `${TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`,
		};
	}
	return null;
}

/**
 * @param {string} given
 * @param {string} expected
 */
function sameToken(given, expected) {
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
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
