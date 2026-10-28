import { createServer } from 'node:http';
import { join } from 'node:path';
import { LibraryEditor } from '../library/library-editor.js';
import { WaveformStore } from '../library/waveform-store.js';
import { logWhenDone } from './request-log.js';
import { createRequestHandler } from './router.js';

export const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const HOST = '127.0.0.1';

/**
 * @typedef {object} ServerOptions
 * @property {import('../library/library.js').Library} library
 * @property {import('../library/settings-store.js').SettingsStore} settings
 * @property {number} port 0 picks a free port
 * @property {string} [publicDir]
 * @property {(error: unknown) => void} logError
 * @property {(line: string) => void} [logRequest] receives one line per request; requests are not logged without it
 * @property {import('../library/change-watcher.js').ChangeWatcher} [watcher] notices external changes and records the
 * 	app's own saves; without it there never are any
 * @property {() => Promise<import('../library/bootstrap-service.js').RefreshOutcome>} [refresh] rebuilds the library
 * 	after external changes; without it `POST /api/refresh` is unavailable
 */

/**
 * Starts the HTTP server on the loopback address. Rejects with the listen error, such as EADDRINUSE.
 * @param {ServerOptions} options
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startServer({ library, settings, port, publicDir = PUBLIC_DIR, logError, logRequest, watcher, refresh }) {
	const updateFile = watcher?.updateFile;
	/** @param {import('../library/library.js').Library} current */
	const servicesFor = (current) => ({
		library: current,
		editor: new LibraryEditor(current, { updateFile }),
		waveforms: new WaveformStore(current),
	});
	/** @type {import('./router.js').RouterContext} */
	const context = {
		...servicesFor(library),
		settings,
		publicDir,
		logError,
		watcher,
		refreshing: null,
		refresh: refresh && (async () => {
			const outcome = await refresh();
			if (outcome.status === 'ready') {
				Object.assign(context, servicesFor(outcome.library), { settings: outcome.settings });
			}
			return outcome;
		}),
	};
	const handle = createRequestHandler(context);
	const server = createServer((request, response) => {
		if (logRequest) {
			logWhenDone(request, response, logRequest);
		}
		handle(request, response);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, HOST, () => {
			server.off('error', reject);
			resolve(undefined);
		});
	});

	const address = server.address();
	const actualPort = typeof address === 'object' && address !== null ? address.port : port;
	return {
		url: `http://${HOST}:${actualPort}`,
		close: () => new Promise((resolve) => {
			server.close(() => resolve());
			// Media streams and keep-alive connections would otherwise hold the server open.
			server.closeAllConnections();
		}),
	};
}
