import { isPlainObject } from '../library/validate.js';
import { deviceCookie } from './lan-access.js';
import { allowMethods, HttpError, sendJson } from './responses.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('./access-control.js').AccessControl} AccessControl */

/**
 * The pairing routes (DESIGN.md §5.2). `checkAccess` has already let the request through: a device asks for itself, and
 * only this machine may answer.
 * @param {Request} request
 * @param {Response} response
 * @param {string} pathname one of the `/api/access/…` paths
 * @param {{ control: AccessControl, links: string[] }} access `links` are the addresses of this server, for this machine's pages
 * @param {(request: Request) => Promise<unknown>} readJsonBody
 */
export async function serveAccess(request, response, pathname, { control, links }, readJsonBody) {
	const address = request.socket.remoteAddress ?? '';
	if (pathname === '/api/access/links') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, { links }, { 'Cache-Control': 'no-store' });
	} else if (pathname === '/api/access/requests') {
		allowMethods(request, ['POST']);
		sendJson(response, 200, control.request(address), { 'Cache-Control': 'no-store' });
	} else if (pathname === '/api/access/requests/mine') {
		allowMethods(request, ['GET']);
		const { secret, ...status } = /** @type {{ secret?: string, status: string }} */ (control.status(address));
		sendJson(response, 200, status, secret === undefined
			? { 'Cache-Control': 'no-store' }
			: {
					'Cache-Control': 'no-store',
					'Set-Cookie': deviceCookie(secret),
				});
	} else if (pathname === '/api/access/requests/answer') {
		allowMethods(request, ['POST']);
		const body = await readJsonBody(request);
		if (!isPlainObject(body) || typeof body.address !== 'string' || (body.decision !== 'allow' && body.decision !== 'deny')) {
			throw new HttpError(400, 'An "address" and a "decision" (allow or deny) are needed');
		}
		if (!control.answer(body.address, body.decision)) {
			throw new HttpError(404, 'No such request');
		}
		sendJson(response, 200, {});
	} else {
		throw new HttpError(404, 'Not found');
	}
}
