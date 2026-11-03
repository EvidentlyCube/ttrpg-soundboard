import { createServer } from 'node:http';
import { FolderRefusedError, StartupStateError } from '../startup/errors.js';
import { FolderNotAllowedError, FolderUnreadableError, listFolder, startingPlaces } from '../startup/folders.js';
import { isPlainObject } from '../library/validate.js';
import { availableLanguages } from '../startup/app-settings.js';
import { isLoopbackAddress } from './lan-access.js';
import { LOOPBACK_HOSTS, checkRequest } from './request-guard.js';
import { logWhenDone } from './request-log.js';
import { allowMethods, HttpError, sendJson } from './responses.js';
import { infoJson, isPagePath, readJsonBody } from './router.js';
import { PUBLIC_DIR } from './server.js';
import { serveStaticFile } from './static-files.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../startup/startup-session.js').StartupSession} StartupSession */
/** @typedef {import('../startup/app-settings.js').AppSettings} AppSettings */

/** How many ports are tried, one after the other, when the first is taken. */
export const PORT_ATTEMPTS = 10;
const LOOPBACK = '127.0.0.1';

/** What a device on the network may fetch before a soundboard is open: the waiting page and what it loads. */
const WAITING_FILES = ['/waiting.html', '/favicon.svg', '/app/language.js', '/app/ui/text.js', '/app/logic/i18n.js'];
const VENDOR_PREFIX = '/vendor/tailwindcss-browser';
const LANGUAGES_PREFIX = '/app/i18n/';
const STARTUP_PREFIX = '/api/startup/';

/**
 * @typedef {object} AppServerOptions
 * @property {StartupSession} session
 * @property {number} port the first port tried; 0 picks a free one
 * @property {import('../startup/folder-rules.js').Platform} platform
 * @property {import('./router.js').AppInfo} info filled in by the caller once the tools are known
 * @property {import('./server.js').LanOptions} [lan]
 * @property {boolean} [lanManager] `--UNSAFE-lan-manager`: other devices may use the Selector and the Initializer
 * 	without pairing (DESIGN.md §1.1)
 * @property {AppSettings} settings
 * @property {string} [publicDir]
 * @property {(error: unknown) => void} logError
 * @property {(line: string) => void} [logRequest]
 */

/**
 * Starts the app's HTTP server (DESIGN.md §3, §5.2). What it answers follows the session's phase: the Selector and
 * the Initializer with their routes, then the soundboard's own handler. Other devices get only the waiting page until
 * a soundboard is open, unless `lanManager` is set. When the port is taken, the next ones are tried. Rejects with the
 * last listen error.
 * @param {AppServerOptions} options
 * @returns {Promise<{ port: number, url: string, close: () => Promise<void> }>}
 */
export async function startApp({ session, port, platform, info, lan, lanManager = false, settings, publicDir = PUBLIC_DIR, logError, logRequest }) {
	const guard = { hosts: [...LOOPBACK_HOSTS, ...(lan?.names ?? [])], port };
	// Read once: language files are part of the app, not something added while it runs.
	const languages = await availableLanguages(publicDir).catch(() => ['en']);
	const context = { session, platform, info, lan, lanManager, settings, languages, publicDir, guard };
	const server = createServer(async (request, response) => {
		if (logRequest) {
			logWhenDone(request, response, logRequest);
		}
		try {
			await route(request, response, context);
		} catch (error) {
			if (error instanceof HttpError) {
				sendJson(response, error.status, { error: error.message }, error.headers);
				return;
			}
			logError(error);
			if (response.headersSent) {
				response.destroy();
			} else {
				sendJson(response, 500, { error: 'Internal server error' });
			}
		}
	});
	const actualPort = await listenOnFreePort(server, port, lan?.address ?? LOOPBACK);
	guard.port = actualPort;
	return {
		port: actualPort,
		url: `http://localhost:${actualPort}`,
		close: () => new Promise((resolve) => {
			server.close(() => resolve());
			// Media streams and keep-alive connections would otherwise hold the server open.
			server.closeAllConnections();
		}),
	};
}

/**
 * @param {import('node:http').Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<number>} the port it listens on
 */
async function listenOnFreePort(server, port, host) {
	for (let attempt = 0; ; attempt++) {
		try {
			await new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen(port + attempt, host, () => {
					server.off('error', reject);
					resolve(undefined);
				});
			});
			const address = server.address();
			return typeof address === 'object' && address !== null ? address.port : port + attempt;
		} catch (error) {
			const code = /** @type {NodeJS.ErrnoException} */ (error).code;
			if (code !== 'EADDRINUSE' || port === 0 || attempt + 1 >= PORT_ATTEMPTS || port + attempt + 1 > 65535) {
				throw error;
			}
		}
	}
}

/**
 * @typedef {object} RouteContext
 * @property {StartupSession} session
 * @property {import('../startup/folder-rules.js').Platform} platform
 * @property {import('./router.js').AppInfo} info
 * @property {import('./server.js').LanOptions} [lan]
 * @property {boolean} lanManager
 * @property {AppSettings} settings
 * @property {string[]} languages the codes of the language files
 * @property {string} publicDir
 * @property {{ hosts: string[], port: number }} guard
 */

/**
 * @param {Request} request
 * @param {Response} response
 * @param {RouteContext} context
 */
async function route(request, response, context) {
	// The raw path is used on purpose: URL parsing would resolve `..` before the static file guard could see it.
	const pathname = (request.url ?? '/').split('?')[0];
	checkRequest(request.headers, context.guard);
	const { session, publicDir } = context;
	const board = session.phase === 'ready' ? session.board : null;

	if (pathname === '/api/startup/ready') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, { ready: board !== null });
		return;
	}
	// Every page needs it before drawing anything, the waiting page and the remote page too.
	if (pathname === '/api/language') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, { language: await context.settings.language(), available: context.languages });
		return;
	}
	if (context.lan && !isLoopbackAddress(request.socket.remoteAddress) && (board || !context.lanManager)) {
		if (board) {
			await board.handle(request, response);
			return;
		}
		await serveWaiting(request, response, publicDir, pathname);
		return;
	}
	if (pathname === '/api/info') {
		allowMethods(request, ['GET']);
		sendJson(response, 200, infoJson(context.info));
		return;
	}
	if (pathname === '/api/startup' || pathname.startsWith(STARTUP_PREFIX)) {
		await serveStartup(request, response, pathname, context);
		return;
	}
	if (board) {
		await board.handle(request, response);
		return;
	}
	if (pathname.startsWith('/api/')) {
		throw new HttpError(503, 'No soundboard is loaded.');
	}
	allowMethods(request, ['GET', 'HEAD']);
	const page = session.phase === 'selecting' ? '/selector.html' : '/initializer.html';
	await serveStaticFile(request, response, publicDir, isPagePath(pathname) ? page : pathname);
}

/**
 * A device on the network before a soundboard is open: the waiting page, which reloads once one is.
 * @param {Request} request
 * @param {Response} response
 * @param {string} publicDir
 * @param {string} pathname
 */
async function serveWaiting(request, response, publicDir, pathname) {
	if (pathname.startsWith('/api/')) {
		throw new HttpError(503, 'No soundboard is open.', { 'Retry-After': '2' });
	}
	allowMethods(request, ['GET', 'HEAD']);
	if (isPagePath(pathname)) {
		await serveStaticFile(request, response, publicDir, '/waiting.html');
		return;
	}
	if (!WAITING_FILES.includes(pathname) && !pathname.startsWith(VENDOR_PREFIX) && !pathname.startsWith(LANGUAGES_PREFIX)) {
		throw new HttpError(403, 'Request not allowed');
	}
	await serveStaticFile(request, response, publicDir, pathname);
}

/**
 * The Selector's and the Initializer's routes (DESIGN.md §5.2).
 * @param {Request} request
 * @param {Response} response
 * @param {string} pathname
 * @param {RouteContext} context
 */
async function serveStartup(request, response, pathname, { session, platform, info, settings, languages }) {
	try {
		switch (pathname) {
			case '/api/startup':
				allowMethods(request, ['GET']);
				sendJson(response, 200, { ...(await session.state()), tools: infoJson(info) });
				return;
			case '/api/startup/folders': {
				allowMethods(request, ['GET']);
				if (session.hasGivenPaths) {
					throw new HttpError(403, 'Only the folders given when the app was started can be opened.');
				}
				const path = new URL(request.url ?? '/', 'http://localhost').searchParams.get('path');
				if (!path) {
					sendJson(response, 200, { places: await startingPlaces(platform), browsed: await session.browsed() });
					return;
				}
				const listing = await listFolder(path, platform);
				await session.rememberBrowsed(listing.path);
				sendJson(response, 200, listing);
				return;
			}
			case '/api/startup/select':
				allowMethods(request, ['POST']);
				await session.select(stringField(await readJsonBody(request), 'path'));
				break;
			case '/api/startup/answer': {
				allowMethods(request, ['POST']);
				const body = await readJsonBody(request);
				const id = isPlainObject(body) ? body.id : undefined;
				const yes = isPlainObject(body) ? body.yes : undefined;
				if (typeof id !== 'number' || typeof yes !== 'boolean') {
					throw new HttpError(400, 'Expected { id: number, yes: boolean }');
				}
				session.answer(id, yes);
				break;
			}
			case '/api/startup/back':
				allowMethods(request, ['POST']);
				session.back();
				break;
			case '/api/startup/retry':
				allowMethods(request, ['POST']);
				session.retry();
				break;
			case '/api/startup/delete-and-retry':
				allowMethods(request, ['POST']);
				await session.deleteAndRetry();
				break;
			case '/api/startup/recent':
				allowMethods(request, ['DELETE']);
				await session.forgetRecent(stringField(await readJsonBody(request), 'path'));
				break;
			case '/api/startup/close':
				allowMethods(request, ['POST']);
				await session.close();
				break;
			case '/api/startup/language': {
				allowMethods(request, ['PUT']);
				const body = await readJsonBody(request);
				const language = isPlainObject(body) ? body.language : undefined;
				if (language !== null && !(typeof language === 'string' && languages.includes(language))) {
					throw new HttpError(400, `Expected { language: null | ${languages.map((code) => `'${code}'`).join(' | ')} }`);
				}
				await settings.setLanguage(language);
				break;
			}
			default:
				throw new HttpError(404, 'Not found');
		}
	} catch (error) {
		if (error instanceof StartupStateError) {
			throw new HttpError(409, error.message);
		}
		if (error instanceof FolderRefusedError) {
			throw new HttpError(400, error.message);
		}
		if (error instanceof FolderUnreadableError) {
			throw new HttpError(404, error.message);
		}
		if (error instanceof FolderNotAllowedError) {
			throw new HttpError(403, error.message);
		}
		throw error;
	}
	response.writeHead(204, { 'Cache-Control': 'no-store' });
	response.end();
}

/**
 * @param {unknown} body
 * @param {string} name
 * @returns {string}
 */
function stringField(body, name) {
	const value = isPlainObject(body) ? body[name] : undefined;
	if (typeof value !== 'string' || value === '') {
		throw new HttpError(400, `Expected { ${name}: string }`);
	}
	return value;
}
