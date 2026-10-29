import { HostTakenError, NoHostError, NotRelayableError, UnknownPageError } from '../remote/remote-relay.js';
import { isPlainObject } from '../library/validate.js';
import { allowMethods, HttpError, sendJson } from './responses.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../remote/remote-relay.js').RemoteRelay} RemoteRelay */

/** A state carries the whole library's titles, so it may be larger than the other bodies. */
export const MAX_STATE_BYTES = 512 * 1024;
const MAX_PAGE_ID_LENGTH = 100;

/**
 * The host and relay routes (DESIGN.md §5.2). They answer `200 {}` when they worked, so the page's request helper can
 * read every answer as JSON.
 * @param {Request} request
 * @param {Response} response
 * @param {string} pathname one of the `/api/remote…` paths
 * @param {RemoteRelay} relay
 * @param {(request: Request, limit?: number) => Promise<unknown>} readJsonBody
 */
export async function serveRemote(request, response, pathname, relay, readJsonBody) {
	if (pathname === '/api/remote') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, { host: relay.hasHost });
	} else if (pathname === '/api/remote/host') {
		allowMethods(request, ['PUT', 'DELETE']);
		if (request.method === 'DELETE') {
			const pageId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('page');
			relay.releaseHost(pageIdOf(pageId));
			sendJson(response, 200, {});
			return;
		}
		const body = objectOf(await readJsonBody(request));
		try {
			relay.claimHost(pageIdOf(body.pageId), { replace: body.replace === true });
		} catch (error) {
			throw relayError(error);
		}
		sendJson(response, 200, {});
	} else if (pathname === '/api/remote/state') {
		allowMethods(request, ['PUT']);
		const body = objectOf(await readJsonBody(request, MAX_STATE_BYTES));
		if (!isPlainObject(body.state)) {
			throw new HttpError(400, 'A state must be an object');
		}
		if (!relay.updateState(pageIdOf(body.pageId), body.state)) {
			throw new HttpError(409, 'This page is not the host');
		}
		sendJson(response, 200, {});
	} else if (pathname === '/api/remote/commands') {
		allowMethods(request, ['POST']);
		try {
			relay.sendCommand(await readJsonBody(request));
		} catch (error) {
			throw relayError(error);
		}
		sendJson(response, 200, {});
	} else {
		throw new HttpError(404, 'Not found');
	}
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function pageIdOf(value) {
	if (typeof value !== 'string' || value === '' || value.length > MAX_PAGE_ID_LENGTH) {
		throw new HttpError(400, 'A "pageId" is needed');
	}
	return value;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>}
 */
function objectOf(body) {
	if (!isPlainObject(body)) {
		throw new HttpError(400, 'The body must be an object');
	}
	return body;
}

/**
 * @param {unknown} error
 * @returns {unknown} an `HttpError` for the relay's own errors, the error itself for anything else
 */
function relayError(error) {
	if (error instanceof NotRelayableError) {
		return new HttpError(400, error.message);
	}
	if (error instanceof HostTakenError || error instanceof NoHostError) {
		return new HttpError(409, error.message);
	}
	if (error instanceof UnknownPageError) {
		return new HttpError(400, error.message);
	}
	return error;
}
