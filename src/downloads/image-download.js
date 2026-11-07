import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { IMAGE_FORMATS, MAX_IMAGE_BYTES, tooLargeError } from '../library/image-info.js';

/** How long an image download may take in all, headers and body (DESIGN.md §5.4). */
export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;

/** Asked for, so a server that negotiates sends one of the formats the app takes. */
const ACCEPT = Object.values(IMAGE_FORMATS).map((format) => format.type).join(', ');

/**
 * @typedef {(url: string, path: string, options: { signal: AbortSignal, timeoutMs?: number }) => Promise<{ contentType: string }>}
 * 	ImageFetcher saves a link's body to a file, never more than `MAX_IMAGE_BYTES`; `timeoutMs` is for tests
 */

/** A link the image can't be downloaded from; the message is meant for the user. */
export class ImageLinkError extends Error {
	/**
	 * @param {string} message
	 * @param {'imageLink.notHttp' | 'imageLink.failed' | 'imageLink.timeout' | 'imageLink.unreachable'} code
	 * @param {Record<string, string | number>} [params]
	 */
	constructor(message, code, params = {}) {
		super(message);
		this.name = 'ImageLinkError';
		this.messageCode = code;
		this.messageParams = params;
	}
}

/**
 * The link as a URL, when it is one the app may fetch: `http:` or `https:` only.
 * @param {string} text
 */
export function imageLinkOf(text) {
	let url;
	try {
		url = new URL(text.trim());
	} catch {
		throw new ImageLinkError('That is not a link.', 'imageLink.notHttp');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ImageLinkError('Only http and https links can be downloaded.', 'imageLink.notHttp');
	}
	return url;
}

/**
 * Downloads with Node's `fetch`. It asks for no compression, so the bytes counted are the bytes that arrive, and it
 * counts them itself: a server that lies about the length, or sends none, is stopped at the first byte past the limit.
 * `fetch` only follows redirects to http and https.
 * @type {ImageFetcher}
 */
export async function fetchImage(url, path, { signal, timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS }) {
	const timeout = AbortSignal.timeout(timeoutMs);
	const both = AbortSignal.any([signal, timeout]);
	/** @param {unknown} error */
	const translate = (error) => {
		if (error instanceof ImageLinkError || (error instanceof Error && error.name === 'InvalidImageError')) {
			return error;
		}
		if (timeout.aborted) {
			return new ImageLinkError('The download took too long.', 'imageLink.timeout', { seconds: timeoutMs / 1000 });
		}
		return new ImageLinkError('The link could not be reached.', 'imageLink.unreachable');
	};
	try {
		const response = await fetch(url, {
			signal: both,
			redirect: 'follow',
			credentials: 'omit',
			headers: { 'Accept': ACCEPT, 'Accept-Encoding': 'identity' },
		});
		if (!response.ok || response.body === null) {
			throw new ImageLinkError(`The server answered ${response.status}.`, 'imageLink.failed', { status: response.status });
		}
		const length = Number(response.headers.get('content-length'));
		if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
			throw tooLargeError();
		}
		let received = 0;
		const counter = new Transform({
			transform(chunk, _encoding, callback) {
				received += chunk.length;
				callback(received > MAX_IMAGE_BYTES ? tooLargeError() : null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), counter, createWriteStream(path), { signal: both });
		return { contentType: response.headers.get('content-type') ?? '' };
	} catch (error) {
		throw translate(error);
	}
}
