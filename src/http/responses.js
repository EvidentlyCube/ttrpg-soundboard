import { pipeline } from 'node:stream/promises';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */

/** A request that cannot be served; the message is sent to the client. */
export class HttpError extends Error {
	/**
	 * @param {number} status
	 * @param {string} message
	 * @param {Record<string, string>} [headers]
	 */
	constructor(status, message, headers = {}) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.headers = headers;
	}
}

/**
 * @param {Response} response
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(response, status, body, headers = {}) {
	const json = JSON.stringify(body);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(json),
		'Cache-Control': 'no-store',
		...headers,
	});
	response.end(json);
}

/**
 * Throws 405 unless the request uses one of the allowed methods.
 * @param {Request} request
 * @param {string[]} methods
 */
export function allowMethods(request, methods) {
	if (!methods.includes(request.method ?? '')) {
		throw new HttpError(405, 'Method not allowed', { Allow: methods.join(', ') });
	}
}

/**
 * Pipes a file stream into the response. A client that disconnects mid-stream is normal for media
 * (seeking, skipping tracks), so that error is swallowed; the file stream is closed either way.
 * @param {NodeJS.ReadableStream} source
 * @param {Response} response
 */
export async function streamTo(source, response) {
	try {
		await pipeline(source, response);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
			throw error;
		}
	}
}
