import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** @typedef {{ contentType: string, size: number | null, name: string | null }} LinkInfo */

/**
 * @typedef {object} LinkFetcher fetches direct links (DESIGN.md §5.4)
 * @property {(url: string) => Promise<LinkInfo | null>} inspect the headers of a link; null when it doesn't answer
 * 	successfully, so yt-dlp can try it instead
 * @property {(url: string, path: string, options: DownloadOptions) => Promise<void>} download
 */

/**
 * @typedef {object} DownloadOptions
 * @property {AbortSignal} signal
 * @property {number | null} expectedSize the announced size; more bytes than that stop the download
 * @property {(received: number) => void} onProgress
 */

/** Fetches direct links with Node's own `fetch`. @type {LinkFetcher} */
export const httpLinkFetcher = {
	async inspect(url) {
		const controller = new AbortController();
		let response;
		try {
			response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
		} catch {
			return null;
		}
		// Only the headers are wanted here; the download asks again.
		controller.abort();
		if (!response.ok) {
			return null;
		}
		return {
			contentType: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
			size: parseSize(response.headers.get('content-length')),
			name: nameFromDisposition(response.headers.get('content-disposition')) ?? nameFromUrl(response.url || url),
		};
	},

	async download(url, path, { signal, expectedSize, onProgress }) {
		const response = await fetch(url, { signal, redirect: 'follow' });
		if (!response.ok || response.body === null) {
			throw new Error(`The server answered ${response.status} ${response.statusText}`.trim());
		}
		let received = 0;
		const counter = new Transform({
			transform(chunk, _encoding, callback) {
				received += chunk.length;
				if (expectedSize !== null && received > expectedSize) {
					callback(new Error('The file is larger than the server said it would be.'));
					return;
				}
				onProgress(received);
				callback(null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), counter, createWriteStream(path), { signal });
	},
};

/** @param {string | null} header */
function parseSize(header) {
	const size = header === null ? NaN : Number(header);
	return Number.isInteger(size) && size >= 0 ? size : null;
}

/**
 * @param {string | null} header such as `attachment; filename*=UTF-8''Rain%20loop.mp3` or `attachment; filename="Rain.mp3"`
 * @returns {string | null}
 */
export function nameFromDisposition(header) {
	if (header === null) {
		return null;
	}
	const encoded = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header);
	if (encoded) {
		try {
			return decodeURIComponent(encoded[1].trim());
		} catch {
			// Fall back to the plain name.
		}
	}
	const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
	const name = plain ? (plain[2] ?? plain[1]).trim() : '';
	return name === '' ? null : name;
}

/**
 * @param {string} url
 * @returns {string | null} the last part of the path, decoded
 */
export function nameFromUrl(url) {
	const last = new URL(url).pathname.split('/').findLast((part) => part !== '') ?? '';
	try {
		return decodeURIComponent(last) || null;
	} catch {
		return last || null;
	}
}
