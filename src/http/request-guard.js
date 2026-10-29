import { HttpError } from './responses.js';

/** The names the server answers to when it only listens on the loopback address (DESIGN.md §5.2). */
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Throws 403 unless the request is addressed to the server itself and does not come from another web page. The
 * `Host` check stops DNS rebinding; the `Origin` check stops cross-site requests, which browsers always mark.
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {{ hosts: string[], port: number }} options the names the server answers to, and its port
 */
export function checkRequest(headers, { hosts, port }) {
	const own = new Set(hosts.map((host) => `${host.toLowerCase()}:${port}`));
	const { host, origin } = headers;
	if (
		host === undefined
		|| !own.has(host.toLowerCase())
		|| (origin !== undefined && !own.has(originAuthority(origin)))
	) {
		throw new HttpError(403, 'Request not allowed');
	}
}

/**
 * @param {string} origin
 * @returns {string} what follows `http://`, or an empty string for any other origin
 */
function originAuthority(origin) {
	return origin.toLowerCase().startsWith('http://') ? origin.slice('http://'.length).toLowerCase() : '';
}
