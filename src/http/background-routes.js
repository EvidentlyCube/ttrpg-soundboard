import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchImage, ImageLinkError, imageLinkOf } from '../downloads/image-download.js';
import { workspaceOf } from '../downloads/workspace.js';
import {
	checkClaimedFormat,
	formatOfPath,
	formatOfType,
	IMAGE_FORMATS,
	InvalidImageError,
	inspectImageFile,
	MAX_IMAGE_BYTES,
	tooLargeError,
} from '../library/image-info.js';
import { UnknownPlaylistError } from '../library/library-editor.js';
import { largeBackgroundWarning, problemOfWarning } from '../library/problems.js';
import { isPlainObject } from '../library/validate.js';
import { toPlaylistJson } from './library-json.js';
import { allowMethods, HttpError, sendJson, streamTo } from './responses.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('./router.js').RouterContext} RouterContext */
/** @typedef {import('../library/backgrounds.js').Background} Background */

/** Where the page asks for a playlist's image; the remote's route is the same with another prefix. */
export const REMOTE_BACKGROUNDS_PREFIX = '/api/remote/backgrounds/';

/**
 * The URL a playlist's image is served at. The version changes with the file, so a replaced image is fetched again.
 * @param {string} playlistId
 * @param {Background} background
 */
export function backgroundUrl(playlistId, background) {
	return `/api/playlists/${encodeURIComponent(playlistId)}/background?v=${backgroundVersion(background)}`;
}

/** @param {Background} background */
export function backgroundVersion({ size, modified }) {
	return `${size.toString(16)}-${Date.parse(modified).toString(16)}`;
}

/**
 * `/api/playlists/<id>/background` and `/api/playlists/<id>/background/download` (DESIGN.md §5.2).
 * @param {Request} request
 * @param {Response} response
 * @param {string} playlistId already decoded
 * @param {string} action `background` or `background/download`
 * @param {RouterContext} context
 * @param {(request: Request) => Promise<unknown>} readJsonBody
 */
export async function serveBackgroundRoute(request, response, playlistId, action, context, readJsonBody) {
	if (action === 'background/download') {
		allowMethods(request, ['POST']);
		const body = await readJsonBody(request);
		if (!isPlainObject(body) || typeof body.url !== 'string') {
			throw new HttpError(400, 'A download needs a "url"');
		}
		const url = body.url;
		await answerChange(response, context, () => downloadBackground(context, playlistId, url));
		return;
	}
	if (action !== 'background') {
		throw new HttpError(404, 'Not found');
	}
	allowMethods(request, ['GET', 'HEAD', 'PUT', 'DELETE']);
	if (request.method === 'PUT') {
		await answerChange(response, context, () => uploadBackground(request, context, playlistId));
	} else if (request.method === 'DELETE') {
		await answerChange(response, context, () => context.editor.removePlaylistBackground(playlistId));
	} else {
		await serveBackgroundImage(request, response, context, playlistId);
	}
}

/**
 * Sends a playlist's image with headers that keep a browser from treating it as anything but that format: a polyglot
 * file can't be sniffed into a page, and if it were opened as one, it could run nothing.
 * @param {Request} request
 * @param {Response} response
 * @param {RouterContext} context
 * @param {string} playlistId
 */
export async function serveBackgroundImage(request, response, context, playlistId) {
	const background = context.library.playlists.find((playlist) => playlist.id === playlistId)?.background;
	if (!background) {
		throw new HttpError(404, 'Not found');
	}
	const etag = `"${backgroundVersion(background)}"`;
	const headers = {
		'Content-Type': IMAGE_FORMATS[background.format].type,
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': "default-src 'none'; sandbox",
		'Cache-Control': 'no-cache',
		'ETag': etag,
	};
	if (request.headers['if-none-match'] === etag) {
		response.writeHead(304, headers);
		response.end();
		return;
	}
	response.writeHead(200, { ...headers, 'Content-Length': background.size });
	if (request.method === 'HEAD') {
		response.end();
		return;
	}
	await streamTo(createReadStream(background.absolutePath), response);
}

/**
 * Stores the request body as the playlist's image. Its `Content-Type` is what the browser took from the file's
 * extension, so it stands for the extension the bytes must match.
 * @param {Request} request
 * @param {RouterContext} context
 * @param {string} playlistId
 */
async function uploadBackground(request, context, playlistId) {
	const claimed = formatOfType(request.headers['content-type'] ?? '');
	if (claimed === null) {
		throw new HttpError(415, 'Send a JPEG, PNG, GIF, WebP or AVIF image');
	}
	if (Number(request.headers['content-length']) > MAX_IMAGE_BYTES) {
		throw HttpError.from(413, tooLargeError());
	}
	requirePlaylist(context, playlistId);
	return withWorkFile(context, async (path) => {
		await saveBody(request, path);
		const info = await inspectImageFile(path);
		checkClaimedFormat(info, claimed);
		return context.editor.setPlaylistBackground(playlistId, path, info.format);
	});
}

/**
 * Downloads a link as the playlist's image. The bytes decide the format; a link whose path names one must match it
 * only when the server's type names that same format, since many servers send WebP or AVIF for a `.jpg` link.
 * @param {RouterContext} context
 * @param {string} playlistId
 * @param {string} text
 */
async function downloadBackground(context, playlistId, text) {
	const url = imageLinkOf(text);
	requirePlaylist(context, playlistId);
	const busy = context.backgroundDownloads;
	if (busy.has(playlistId)) {
		throw new HttpError(409, 'This playlist is already downloading an image');
	}
	busy.add(playlistId);
	try {
		return await withWorkFile(context, async (path) => {
			const { contentType } = await fetchImage(url.href, path, { signal: new AbortController().signal });
			const info = await inspectImageFile(path);
			const linked = formatOfPath(url.pathname);
			if (linked !== null && formatOfType(contentType) === linked) {
				checkClaimedFormat(info, linked);
			}
			return context.editor.setPlaylistBackground(playlistId, path, info.format);
		});
	} finally {
		busy.delete(playlistId);
	}
}

/**
 * Runs a change, keeps the problems list in step with it, and answers with the playlist.
 * @param {Response} response
 * @param {RouterContext} context
 * @param {() => Promise<import('../library/library-editor.js').BackgroundChange>} change
 */
async function answerChange(response, context, change) {
	let result;
	try {
		result = await change();
	} catch (error) {
		if (error instanceof UnknownPlaylistError) {
			throw HttpError.from(404, error);
		}
		if (error instanceof InvalidImageError || error instanceof ImageLinkError) {
			throw HttpError.from(error instanceof InvalidImageError && error.messageCode === 'image.tooLarge' ? 413 : 422, error);
		}
		throw error;
	}
	const { playlist, removed, added } = result;
	for (const path of removed) {
		context.problems?.removeFor(path);
	}
	const warning = added && playlist.background && largeBackgroundWarning(added, playlist.background);
	if (warning) {
		context.problems?.add(problemOfWarning(warning));
	}
	sendJson(response, 200, toPlaylistJson(playlist));
}

/**
 * Gives the work a file of its own in the downloads folder, which the scanner never reads, and deletes whatever is
 * left of it afterwards: everything, when the image was refused.
 * @template T
 * @param {RouterContext} context
 * @param {(path: string) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withWorkFile(context, work) {
	const directory = join(workspaceOf(context.library.root), 'images');
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${randomUUID()}.part`);
	try {
		return await work(path);
	} finally {
		await rm(path, { force: true });
	}
}

/**
 * Writes the body to a file, stopping at the first byte past the limit, so a large upload is never held in memory.
 * @param {Request} request
 * @param {string} path
 */
async function saveBody(request, path) {
	const file = await open(path, 'w');
	let size = 0;
	try {
		for await (const chunk of request) {
			size += chunk.length;
			if (size > MAX_IMAGE_BYTES) {
				throw HttpError.from(413, tooLargeError());
			}
			await file.write(chunk);
		}
	} finally {
		await file.close();
	}
}

/**
 * @param {RouterContext} context
 * @param {string} playlistId
 */
function requirePlaylist(context, playlistId) {
	if (!context.editor.playlist(playlistId)) {
		throw HttpError.from(404, new UnknownPlaylistError(playlistId));
	}
}
