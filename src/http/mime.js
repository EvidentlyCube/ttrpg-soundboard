import { extname } from 'node:path';

/** @type {Record<import('../library/classify.js').AudioFormat, string>} */
export const AUDIO_CONTENT_TYPES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg; codecs=opus' };

/** @type {Record<string, string>} */
const STATIC_CONTENT_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
};

/** @param {string} path */
export function contentTypeFor(path) {
	return STATIC_CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
