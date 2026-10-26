import { ValidationError } from '../library/errors.js';
import { isPlainObject, VOLUME_BUSES } from '../library/validate.js';
import { findMediaFile, isMediaPath, mediaUrl, serveMedia } from './media.js';
import { allowMethods, HttpError, sendJson } from './responses.js';
import { serveStaticFile } from './static-files.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../library/library.js').Library} Library */
/** @typedef {import('../library/settings-store.js').SettingsStore} SettingsStore */

/**
 * @typedef {object} RouterContext
 * @property {Library} library
 * @property {SettingsStore} settings
 * @property {string} publicDir
 * @property {(error: unknown) => void} logError called for unexpected failures, never for client mistakes
 */

const LIBRARY_FORMAT_VERSION = 1;
const MAX_BODY_BYTES = 16 * 1024;

/**
 * @param {RouterContext} context
 * @returns {(request: Request, response: Response) => Promise<void>}
 */
export function createRequestHandler(context) {
	return async (request, response) => {
		try {
			await route(request, response, context);
		} catch (error) {
			if (error instanceof HttpError) {
				sendJson(response, error.status, { error: error.message }, error.headers);
				return;
			}
			context.logError(error);
			if (response.headersSent) {
				response.destroy();
			} else {
				sendJson(response, 500, { error: 'Internal server error' });
			}
		}
	};
}

/**
 * @param {Request} request
 * @param {Response} response
 * @param {RouterContext} context
 */
async function route(request, response, { library, settings, publicDir }) {
	// The raw path is used on purpose: URL parsing would resolve `..` before the static file guard could see it.
	const pathname = (request.url ?? '/').split('?')[0];

	if (pathname === '/api/library') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, toLibraryJson(library));
	} else if (pathname === '/api/settings') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, settings.settings);
	} else if (pathname === '/api/settings/volumes') {
		allowMethods(request, ['PUT']);
		sendJson(response, 200, await updateVolumes(settings, await readJsonBody(request)));
	} else if (pathname.startsWith('/api/')) {
		throw new HttpError(404, 'Not found');
	} else if (isMediaPath(pathname)) {
		allowMethods(request, ['GET', 'HEAD']);
		await serveMedia(request, response, findMediaFile(library, pathname));
	} else {
		allowMethods(request, ['GET', 'HEAD']);
		await serveStaticFile(request, response, publicDir, pathname);
	}
}

/** @param {Library} library */
function toLibraryJson(library) {
	/** @param {import('../library/library.js').AudioFile} file */
	const toFileJson = ({ id, title, format, size, gain }) => ({ id, title, format, size, gain, url: mediaUrl(id) });
	return {
		version: LIBRARY_FORMAT_VERSION,
		playlists: library.playlists.map(({ id, title, tracks }) => ({ id, title, tracks: tracks.map(toFileJson) })),
		sounds: library.sounds.map(toFileJson),
	};
}

/**
 * @param {SettingsStore} settings
 * @param {unknown} body
 */
async function updateVolumes(settings, body) {
	if (!isPlainObject(body)) {
		throw new HttpError(400, 'Volumes must be a JSON object');
	}
	const unknown = Object.keys(body).find((key) => !VOLUME_BUSES.includes(/** @type {any} */ (key)));
	if (unknown !== undefined) {
		throw new HttpError(400, `Unknown volume "${unknown}"`);
	}
	try {
		return await settings.updateVolumes(body);
	} catch (error) {
		if (error instanceof ValidationError) {
			throw new HttpError(400, error.message);
		}
		throw error;
	}
}

/**
 * @param {Request} request
 * @returns {Promise<unknown>}
 */
async function readJsonBody(request) {
	/** @type {Buffer[]} */
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) {
			throw new HttpError(413, 'Request body too large');
		}
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		throw new HttpError(400, 'Request body is not valid JSON');
	}
}
