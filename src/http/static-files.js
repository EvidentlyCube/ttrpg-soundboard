import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { relative, resolve, sep, isAbsolute } from 'node:path';
import { contentTypeFor } from './mime.js';
import { HttpError, streamTo } from './responses.js';

/**
 * Serves a file from the public directory. The path is decoded and resolved first, then checked to still be
 * inside the public directory, so encoded `..` segments cannot escape it.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} publicDir
 * @param {string} pathname raw request path, not normalized
 */
export async function serveStaticFile(request, response, publicDir, pathname) {
	const path = resolvePublicPath(publicDir, pathname);
	const stats = await stat(path).catch(() => null);
	if (!stats?.isFile()) {
		throw new HttpError(404, 'Not found');
	}

	response.writeHead(200, {
		'Content-Type': contentTypeFor(path),
		'Content-Length': stats.size,
		'Cache-Control': 'no-cache',
	});
	if (request.method === 'HEAD') {
		response.end();
		return;
	}
	await streamTo(createReadStream(path), response);
}

/**
 * @param {string} publicDir
 * @param {string} pathname
 */
function resolvePublicPath(publicDir, pathname) {
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		throw new HttpError(404, 'Not found');
	}
	if (decoded.includes('\0')) {
		throw new HttpError(404, 'Not found');
	}

	const root = resolve(publicDir);
	const path = resolve(root, `.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`);
	const inside = relative(root, path);
	if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
		throw new HttpError(404, 'Not found');
	}
	return path;
}
