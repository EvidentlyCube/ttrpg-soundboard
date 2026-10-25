import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { AUDIO_CONTENT_TYPES } from './mime.js';
import { parseRange } from './range.js';
import { HttpError, streamTo } from './responses.js';

/** @typedef {import('../library/library.js').AudioFile} AudioFile */
/** @typedef {import('../library/library.js').Library} Library */

const MEDIA_PREFIX = '/media/';

/**
 * Builds the URL a library file is served at, percent-encoding each path segment.
 * @param {string} id
 */
export function mediaUrl(id) {
	return MEDIA_PREFIX + id.split('/').map(encodeURIComponent).join('/');
}

/**
 * Finds the library file for a `/media/...` path. Only indexed files can be found, so the URL never reaches the file system.
 * @param {Library} library
 * @param {string} pathname
 * @returns {AudioFile}
 */
export function findMediaFile(library, pathname) {
	let id;
	try {
		id = pathname.slice(MEDIA_PREFIX.length).split('/').map(decodeURIComponent).join('/');
	} catch {
		throw new HttpError(404, 'Not found');
	}
	const file = library.files.get(id);
	if (!file) {
		throw new HttpError(404, 'Not found');
	}
	return file;
}

/** @param {string} pathname */
export function isMediaPath(pathname) {
	return pathname.startsWith(MEDIA_PREFIX);
}

/**
 * Streams a library file, honoring a single byte range.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {AudioFile} file
 */
export async function serveMedia(request, response, file) {
	let stats;
	try {
		stats = await stat(file.absolutePath);
	} catch {
		throw new HttpError(404, 'Not found');
	}

	const { size } = stats;
	/** @type {Record<string, string | number>} */
	const headers = {
		'Accept-Ranges': 'bytes',
		'Content-Type': AUDIO_CONTENT_TYPES[file.format],
		'Last-Modified': stats.mtime.toUTCString(),
		'ETag': `"${size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
	};

	const range = parseRange(request.headers.range, size);
	if (range.type === 'unsatisfiable') {
		response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
		response.end();
		return;
	}

	const { start, end } = range.type === 'range' ? range : { start: 0, end: size - 1 };
	if (range.type === 'range') {
		headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
	}
	headers['Content-Length'] = end - start + 1;
	response.writeHead(range.type === 'range' ? 206 : 200, headers);

	if (request.method === 'HEAD' || size === 0) {
		response.end();
		return;
	}
	await streamTo(createReadStream(file.absolutePath, { start, end }), response);
}
