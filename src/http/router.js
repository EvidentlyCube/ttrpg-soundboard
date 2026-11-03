import { relative, sep } from 'node:path';
import { DownloadBusyError, InvalidDownloadError, ToolsUnavailableError, UnusableLinkError } from '../downloads/errors.js';
import { ValidationError } from '../library/errors.js';
import { UnknownPlaylistError, UnknownSoundError, UnknownTrackError } from '../library/library-editor.js';
import { readTrash, UnknownTrashItemError } from '../library/trash.js';
import { isPlainObject, VOLUME_BUSES } from '../library/validate.js';
import { checkRequest } from './request-guard.js';
import { findMediaFile, isMediaPath, serveMedia } from './media.js';
import { InvalidWaveformError, UnknownWaveformFileError } from '../library/waveform-store.js';
import { serveEvents, toMessage } from './events.js';
import { toFileJson, toLibraryJson, toPlaylistJson } from './library-json.js';
import { allowMethods, HttpError, sendJson } from './responses.js';
import { serveStaticFile } from './static-files.js';
import { serveAccess } from './access-routes.js';
import { checkAccess } from './lan-access.js';
import { serveRemote } from './remote-routes.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../library/library.js').Library} Library */
/** @typedef {import('../library/settings-store.js').SettingsStore} SettingsStore */
/** @typedef {import('../library/library-editor.js').LibraryEditor} LibraryEditor */
/** @typedef {import('../library/library-editor.js').OptionChanges} OptionChanges */
/** @typedef {import('../library/waveform-store.js').WaveformStore} WaveformStore */

/** @typedef {import('../library/bootstrap-service.js').RefreshOutcome} RefreshOutcome */
/** @typedef {import('../library/change-watcher.js').ChangeWatcher} ChangeWatcher */
/** @typedef {import('../downloads/download-service.js').DownloadService} DownloadService */

/**
 * @typedef {object} RouterContext
 * @property {Library} library replaced by a refresh, like the three below; read them per request
 * @property {SettingsStore} settings
 * @property {LibraryEditor} editor
 * @property {WaveformStore} waveforms
 * @property {string} publicDir
 * @property {{ hosts: string[], port: number }} guard the names and port the server answers to (`request-guard.js`)
 * @property {(error: unknown) => void} logError called for unexpected failures, never for client mistakes
 * @property {ChangeWatcher} [watcher] notices external changes; without it there never are any
 * @property {import('./library-changes.js').LibraryChanges} [libraryChanges] tells the event streams about deletions and moves
 * @property {import('../library/trash.js').Trash} [trash] the trash's summary for the event streams
 * @property {import('../library/problems.js').Problems} [problems] what startup found wrong, for the event streams
 * @property {{ control: import('./access-control.js').AccessControl, links: string[] }} [access] with `--lan`: what requests
 * 	from other machines need (`lan-access.js`)
 * @property {import('./access-control.js').AccessControl} [pairing] with `--lan`: the requests the pages on this machine answer
 * @property {import('../remote/remote-relay.js').RemoteRelay} [relay] connects the remotes to the host page
 * @property {() => Promise<RefreshOutcome>} [refresh] rebuilds the library and swaps it into this context
 * @property {Promise<RefreshOutcome> | null} refreshing the refresh running now
 * @property {DownloadService} [downloads] without it, downloads are not available
 * @property {AppInfo} info the versions `GET /api/info` reports
 * @property {Set<() => void>} streams ends each open event stream, for when the soundboard closes
 */

/**
 * @typedef {object} AppInfo
 * @property {string} app the app's version
 * @property {boolean} checking set while the tools are looked for and yt-dlp updated (DESIGN.md §3.4)
 * @property {import('../downloads/tools.js').Tools} tools
 * @property {import('../downloads/yt-dlp-update.js').YtDlpUpdate | null} update null when it didn't run
 */

const MAX_BODY_BYTES = 16 * 1024;
const MAX_WAVEFORM_BODY_BYTES = 4 * 1024;
const WAVEFORMS_PREFIX = '/api/waveforms/';
const SOUNDS_PREFIX = '/api/sounds/';
const PLAYLISTS_PREFIX = '/api/playlists/';
const TRACKS_PREFIX = '/api/tracks/';
const PROBLEMS_PREFIX = '/api/problems/';

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
async function route(request, response, context) {
	// The raw path is used on purpose: URL parsing would resolve `..` before the static file guard could see it.
	let pathname = (request.url ?? '/').split('?')[0];

	checkRequest(request.headers, context.guard);
	if (context.access) {
		const entry = checkAccess(request, pathname, context.access);
		if (entry) {
			pathname = '/connect.html';
		}
	}

	if (pathname === '/api/events') {
		allowMethods(request, ['GET']);
		serveEvents(request, response, context);
		return;
	}
	if (pathname.startsWith('/api/access/')) {
		if (!context.access) {
			throw new HttpError(404, 'Not found');
		}
		await serveAccess(request, response, pathname, context.access, readJsonBody);
		return;
	}
	if (pathname === '/api/remote' || pathname.startsWith('/api/remote/')) {
		if (!context.relay) {
			throw new HttpError(404, 'Not found');
		}
		await serveRemote(request, response, pathname, context.relay, readJsonBody);
		return;
	}
	if (pathname === '/api/refresh') {
		allowMethods(request, ['POST']);
		await refresh(response, context);
		return;
	}
	// A request made during a refresh waits for it, so a save can't land in the library being replaced.
	if (pathname.startsWith('/api/') && context.refreshing) {
		await context.refreshing.catch(() => {});
	}
	const { library, settings, editor, waveforms, publicDir } = context;

	if (pathname === '/api/changes/check') {
		allowMethods(request, ['POST']);
		sendJson(response, 200, { externalChanges: (await context.watcher?.check()) ?? false });
	} else if (pathname === '/api/info') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, infoJson(context.info));
	} else if (pathname === '/api/library') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, toLibraryJson(library));
	} else if (pathname === '/api/settings') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, settings.settings);
	} else if (pathname === '/api/settings/volumes') {
		allowMethods(request, ['PUT']);
		sendJson(response, 200, await updateVolumes(settings, await readJsonBody(request)));
	} else if (pathname === '/api/waveforms') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, { missing: await waveforms.missing() });
	} else if (pathname.startsWith(WAVEFORMS_PREFIX)) {
		allowMethods(request, ['GET', 'PUT']);
		await serveWaveform(request, response, waveforms, pathname);
	} else if (pathname.startsWith(SOUNDS_PREFIX)) {
		allowMethods(request, ['PATCH', 'DELETE']);
		if (request.method === 'DELETE') {
			await sendChanges(response, context, await editItem(pathname, SOUNDS_PREFIX, (id) => editor.deleteSound(id)));
			return;
		}
		const body = /** @type {OptionChanges} */ (await readJsonBody(request));
		sendJson(response, 200, toFileJson(await editItem(pathname, SOUNDS_PREFIX, (id) => editor.updateSound(id, body))));
	} else if (pathname.startsWith(PLAYLISTS_PREFIX)) {
		allowMethods(request, ['PATCH', 'DELETE']);
		if (request.method === 'DELETE') {
			await sendChanges(response, context, await editItem(pathname, PLAYLISTS_PREFIX, (id) => editor.deletePlaylist(id)));
			return;
		}
		const body = /** @type {OptionChanges} */ (await readJsonBody(request));
		sendJson(response, 200, toPlaylistJson(await editItem(pathname, PLAYLISTS_PREFIX, (id) => editor.updatePlaylist(id, body))));
	} else if (pathname.startsWith(TRACKS_PREFIX)) {
		allowMethods(request, ['PATCH', 'DELETE']);
		// Decoding the whole rest of the path keeps literal slashes, so ids encoded whole or per segment both work.
		if (request.method === 'DELETE') {
			await sendChanges(response, context, await editItem(pathname, TRACKS_PREFIX, (id) => editor.deleteTrack(id)));
			return;
		}
		const body = /** @type {OptionChanges} */ (await readJsonBody(request));
		sendJson(response, 200, toFileJson(await editItem(pathname, TRACKS_PREFIX, (id) => editor.updateTrack(id, body))));
	} else if (pathname === '/api/move') {
		allowMethods(request, ['POST']);
		await sendChanges(response, context, await moveItem(library, editor, await readJsonBody(request)));
	} else if (pathname === '/api/problems') {
		allowMethods(request, ['DELETE']);
		context.problems?.dismissAll();
		response.writeHead(204, { 'Cache-Control': 'no-store' });
		response.end();
	} else if (pathname.startsWith(PROBLEMS_PREFIX)) {
		allowMethods(request, ['DELETE']);
		let id;
		try {
			id = decodeURIComponent(pathname.slice(PROBLEMS_PREFIX.length));
		} catch {
			throw new HttpError(404, 'Not found');
		}
		if (!context.problems?.dismiss(id)) {
			throw new HttpError(404, 'Unknown problem');
		}
		response.writeHead(204, { 'Cache-Control': 'no-store' });
		response.end();
	} else if (pathname === '/api/trash') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, toTrashJson(await readTrash(library.root)));
	} else if (pathname === '/api/trash/restore') {
		allowMethods(request, ['POST']);
		const item = trashItemOf(await readJsonBody(request));
		await sendChanges(response, context, await trashCall(() => editor.restoreFromTrash(item)));
	} else if (pathname === '/api/trash/delete') {
		allowMethods(request, ['POST']);
		const item = trashItemOf(await readJsonBody(request));
		await trashCall(() => editor.purgeFromTrash(item));
		await sendChanges(response, context, { changes: [] });
	} else if (pathname === '/api/download') {
		allowMethods(request, ['GET', 'POST', 'DELETE']);
		await serveDownload(request, response, context.downloads);
	} else if (pathname === '/api/download/probe') {
		allowMethods(request, ['POST']);
		await probeLink(request, response, context.downloads);
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

/**
 * Whether a path asks for a page rather than a script, style or icon: `/`, a path ending in `.html`, or one without an
 * extension.
 * @param {string} pathname
 */
export function isPagePath(pathname) {
	return pathname.endsWith('/') || pathname.endsWith('.html') || !pathname.slice(pathname.lastIndexOf('/')).includes('.');
}

/**
 * What `GET /api/info` answers (DESIGN.md §5.2).
 * @param {AppInfo} info
 */
export function infoJson({ app, checking, tools, update }) {
	return { app, checking, ytDlp: { version: tools.ytDlp, update }, ffmpeg: tools.ffmpeg };
}

/**
 * Rebuilds the library as a restart would. Requests that arrive meanwhile share the refresh already running.
 * @param {Response} response
 * @param {RouterContext} context
 */
async function refresh(response, context) {
	const run = context.refresh;
	if (!run) {
		throw new HttpError(503, 'Refreshing is not available');
	}
	if (!context.refreshing) {
		const refreshing = run();
		context.refreshing = refreshing;
		const forget = () => {
			if (context.refreshing === refreshing) {
				context.refreshing = null;
			}
		};
		refreshing.then(forget, forget);
	}
	const outcome = await context.refreshing;
	switch (outcome.status) {
		case 'ready':
			sendJson(response, 200, {});
			return;
		case 'invalid': {
			const root = context.library.root;
			const errors = outcome.errors.flatMap((error) => error.problems.map((message) => ({
				path: error.filePath === null ? '' : relative(root, error.filePath).split(sep).join('/'),
				message,
			})));
			sendJson(response, 422, { error: 'Some options files are invalid', errors });
			return;
		}
		case 'noSettings':
			throw new HttpError(503, 'The .soundboard file is gone. Restart the app.');
	}
}

/**
 * `GET` reports the tools and the current job, `POST` starts a job, `DELETE` cancels or dismisses it (DESIGN.md §5.2).
 * @param {Request} request
 * @param {Response} response
 * @param {DownloadService | undefined} downloads
 */
async function serveDownload(request, response, downloads) {
	if (request.method === 'GET') {
		sendJson(response, 200, { tools: downloads?.tools ?? { ytDlp: null, ffmpeg: null }, job: downloads?.current() ?? null });
		return;
	}
	const service = requireDownloads(downloads);
	if (request.method === 'DELETE') {
		service.dismiss();
		response.writeHead(204, { 'Cache-Control': 'no-store' });
		response.end();
		return;
	}
	const body = await readJsonBody(request);
	if (!isPlainObject(body) || typeof body.probeId !== 'string' || !isPlainObject(body.target)) {
		throw new HttpError(400, 'A download needs "probeId" and "target"');
	}
	sendJson(response, 202, downloadCall(() => service.start(/** @type {import('../downloads/download-service.js').StartRequest} */ (/** @type {unknown} */ (body)))));
}

/**
 * @param {Request} request
 * @param {Response} response
 * @param {DownloadService | undefined} downloads
 */
async function probeLink(request, response, downloads) {
	const service = requireDownloads(downloads);
	const body = await readJsonBody(request);
	if (!isPlainObject(body) || typeof body.url !== 'string') {
		throw new HttpError(400, 'A lookup needs a "url"');
	}
	const url = body.url;
	sendJson(response, 200, await downloadCall(() => service.probe(url, { playlist: body.playlist === true })));
}

/**
 * @param {DownloadService | undefined} downloads
 * @returns {DownloadService}
 */
function requireDownloads(downloads) {
	if (!downloads) {
		throw new HttpError(503, 'Downloads are not available');
	}
	return downloads;
}

/**
 * Turns the download domain's errors into HTTP errors.
 * @template T
 * @param {() => T} call
 * @returns {T}
 */
function downloadCall(call) {
	/** @param {unknown} error */
	const translate = (error) => {
		if (error instanceof ToolsUnavailableError) {
			return new HttpError(503, error.message);
		}
		if (error instanceof UnusableLinkError) {
			return new HttpError(422, error.message);
		}
		if (error instanceof DownloadBusyError) {
			return new HttpError(409, error.message);
		}
		if (error instanceof InvalidDownloadError) {
			return new HttpError(400, error.message);
		}
		return error;
	};
	let result;
	try {
		result = call();
	} catch (error) {
		throw translate(error);
	}
	if (result instanceof Promise) {
		return /** @type {T} */ (result.catch((error) => {
			throw translate(error);
		}));
	}
	return result;
}

/**
 * Moves a sound into a playlist, or a track into another playlist or out to the sounds (`to: null`).
 * @param {Library} library
 * @param {LibraryEditor} editor
 * @param {unknown} body
 */
async function moveItem(library, editor, body) {
	if (
		!isPlainObject(body)
		|| typeof body.id !== 'string'
		|| !(typeof body.to === 'string' || body.to === null)
	) {
		throw new HttpError(400, 'A move needs an "id" and "to", a playlist id or null');
	}
	const { id, to } = /** @type {{ id: string, to: string | null }} */ (body);
	const isSound = library.sounds.some((sound) => sound.id === id);
	if (isSound && to === null) {
		throw new HttpError(400, 'The sound is already a sound effect');
	}
	return editItem('', '', () => (isSound ? editor.moveSound(id, /** @type {string} */ (to)) : editor.moveTrack(id, to)));
}

/**
 * Tells every page about a deletion, a move or a change to the trash, and answers with the same messages, so the page
 * that asked can apply them at once. Each of them may change the trash, which is read again first.
 * @param {Response} response
 * @param {RouterContext} context
 * @param {{ changes: import('../library/library-editor.js').LibraryChange[] }} result
 */
async function sendChanges(response, context, { changes }) {
	await context.trash?.reload();
	for (const change of changes) {
		if (change.type === 'library.removed') {
			context.problems?.removeFor('soundId' in change ? change.soundId : 'trackId' in change ? change.trackId : change.playlistId);
		}
	}
	context.libraryChanges?.emit(changes);
	sendJson(response, 200, { changes: changes.map(toMessage) });
}

/**
 * @param {unknown} body `{ kind, id }` or `{ all: true }`
 * @returns {import('../library/trash.js').TrashItem | 'all'}
 */
function trashItemOf(body) {
	if (isPlainObject(body) && body.all === true) {
		return 'all';
	}
	if (
		!isPlainObject(body)
		|| !(body.kind === 'sound' || body.kind === 'track' || body.kind === 'playlist')
		|| typeof body.id !== 'string'
	) {
		throw new HttpError(400, 'Name a "kind" (sound, track or playlist) and an "id", or send "all": true');
	}
	return { kind: body.kind, id: body.id };
}

/**
 * Turns the trash's errors into HTTP errors.
 * @template T
 * @param {() => Promise<T>} call
 * @returns {Promise<T>}
 */
async function trashCall(call) {
	try {
		return await call();
	} catch (error) {
		if (error instanceof UnknownTrashItemError) {
			throw new HttpError(404, error.message);
		}
		if (error instanceof ValidationError) {
			throw new HttpError(400, error.message);
		}
		throw error;
	}
}

/** @param {import('../library/trash.js').TrashListing} listing */
function toTrashJson({ size, playlists, sounds }) {
	/** @param {import('../library/trash.js').TrashedFile} file */
	const toFile = ({ id, title, size: fileSize }) => ({ id, title, size: fileSize });
	return {
		size,
		playlists: playlists.map((playlist) => ({ id: playlist.id, title: playlist.title, size: playlist.size, tracks: playlist.tracks.map(toFile) })),
		sounds: sounds.map(toFile),
	};
}

/**
 * Runs an edit of the item named by the rest of the path, turning domain errors into HTTP errors.
 * @template T
 * @param {string} pathname
 * @param {string} prefix
 * @param {(id: string) => Promise<T>} edit
 * @returns {Promise<T>}
 */
async function editItem(pathname, prefix, edit) {
	let id;
	try {
		id = decodeURIComponent(pathname.slice(prefix.length));
	} catch {
		throw new HttpError(404, 'Not found');
	}
	try {
		return await edit(id);
	} catch (error) {
		if (error instanceof UnknownSoundError || error instanceof UnknownPlaylistError || error instanceof UnknownTrackError) {
			throw new HttpError(404, error.message);
		}
		if (error instanceof ValidationError) {
			throw new HttpError(400, error.message);
		}
		throw error;
	}
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
 * A page on another site can only send a few content types without asking the server first, and JSON is not one of
 * them, so insisting on the right type is a second defense behind the Origin check.
 * @param {Request} request
 * @param {string} expected
 */
function requireContentType(request, expected) {
	const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
	if (type !== expected) {
		throw new HttpError(415, `Send ${expected}`);
	}
}

/**
 * @param {Request} request
 * @returns {Promise<unknown>}
 */
export async function readJsonBody(request, limit = MAX_BODY_BYTES) {
	requireContentType(request, 'application/json');
	/** @type {Buffer[]} */
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > limit) {
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

/**
 * `GET` sends a waveform's peaks as raw bytes; `PUT` stores them (DESIGN.md §5.2).
 * @param {Request} request
 * @param {Response} response
 * @param {WaveformStore} waveforms
 * @param {string} pathname
 */
async function serveWaveform(request, response, waveforms, pathname) {
	let id;
	try {
		id = decodeURIComponent(pathname.slice(WAVEFORMS_PREFIX.length));
	} catch {
		throw new HttpError(404, 'Not found');
	}
	try {
		if (request.method === 'PUT') {
			await waveforms.write(id, await readRawBody(request, MAX_WAVEFORM_BODY_BYTES));
			response.writeHead(204, { 'Cache-Control': 'no-store' });
			response.end();
			return;
		}
		const peaks = await waveforms.read(id);
		if (!peaks) {
			throw new HttpError(404, 'No waveform yet');
		}
		response.writeHead(200, {
			'Content-Type': 'application/octet-stream',
			'Content-Length': peaks.length,
			'Cache-Control': 'no-store',
		});
		response.end(peaks);
	} catch (error) {
		if (error instanceof UnknownWaveformFileError) {
			throw new HttpError(404, error.message);
		}
		if (error instanceof InvalidWaveformError) {
			throw new HttpError(400, error.message);
		}
		throw error;
	}
}

/**
 * @param {Request} request
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
async function readRawBody(request, limit) {
	requireContentType(request, 'application/octet-stream');
	/** @type {Buffer[]} */
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > limit) {
			throw new HttpError(413, 'Request body too large');
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}
