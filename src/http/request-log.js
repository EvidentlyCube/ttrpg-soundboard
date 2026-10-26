/**
 * @typedef {object} RequestLogEntry
 * @property {string} method
 * @property {string} url the raw request path, as the client sent it
 * @property {number} status
 * @property {string | undefined} range the Range header, if any
 * @property {number} durationMs
 * @property {boolean} aborted the client disconnected before the response finished
 */

/**
 * One line per request for `--verbose` (DESIGN.md §5.2), e.g. `GET /media/a.mp3 206 bytes=0-1023 12ms`.
 * @param {RequestLogEntry} entry
 */
export function formatRequestLog({ method, url, status, range, durationMs, aborted }) {
	const parts = [method, url, String(status)];
	if (range !== undefined) {
		parts.push(range);
	}
	parts.push(`${Math.round(durationMs)}ms`);
	if (aborted) {
		parts.push('(aborted)');
	}
	return parts.join(' ');
}

/**
 * Logs the request once its response has finished, or once the client has gone, whichever comes first.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {(line: string) => void} log
 */
export function logWhenDone(request, response, log) {
	const startedAt = performance.now();
	let logged = false;
	/** @param {boolean} aborted */
	const done = (aborted) => {
		if (logged) {
			return;
		}
		logged = true;
		log(formatRequestLog({
			method: request.method ?? '?',
			url: request.url ?? '/',
			status: response.statusCode,
			range: request.headers.range,
			durationMs: performance.now() - startedAt,
			aborted,
		}));
	};
	response.once('finish', () => done(false));
	response.once('close', () => done(!response.writableFinished));
}
