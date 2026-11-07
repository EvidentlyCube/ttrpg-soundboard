import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DownloadService } from '../downloads/download-service.js';
import { Ffmpeg } from '../downloads/ffmpeg.js';
import { httpLinkFetcher } from '../downloads/link-fetcher.js';
import { runProcess } from '../downloads/process-runner.js';
import { YtDlp } from '../downloads/yt-dlp.js';
import { updateProblem } from '../downloads/yt-dlp-update.js';
import { RemoteRelay } from '../remote/remote-relay.js';
import { LibraryEditor } from '../library/library-editor.js';
import { Problems } from '../library/problems.js';
import { Trash } from '../library/trash.js';
import { WaveformStore } from '../library/waveform-store.js';
import { AccessControl } from './access-control.js';
import { LibraryChanges } from './library-changes.js';
import { LOOPBACK_HOSTS } from './request-guard.js';
import { logWhenDone } from './request-log.js';
import { createRequestHandler } from './router.js';

export const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const PACKAGE_JSON = join(import.meta.dirname, '..', '..', 'package.json');
const LOOPBACK = '127.0.0.1';

/** @returns {Promise<string>} the app's version, from `package.json` */
export async function appVersion() {
	return /** @type {{ version: string }} */ (JSON.parse(await readFile(PACKAGE_JSON, 'utf8'))).version;
}

/**
 * @typedef {object} BoardOptions
 * @property {import('../library/library.js').Library} library
 * @property {import('../library/settings-store.js').SettingsStore} settings
 * @property {import('../library/problems.js').Problem[]} [problems] what startup found wrong (DESIGN.md §5.1)
 * @property {number} port the port the server listens on, which requests must name
 * @property {string} [publicDir]
 * @property {(error: unknown) => void} logError
 * @property {import('../library/change-watcher.js').ChangeWatcher} [watcher] notices external changes and records the
 * 	app's own saves; without it there never are any
 * @property {() => Promise<import('../library/bootstrap-service.js').RefreshOutcome>} [refresh] rebuilds the library
 * 	after external changes; without it `POST /api/refresh` is unavailable
 * @property {DownloadPorts} [downloads] without it, downloads are not available
 * @property {LanOptions} [lan] without it, the server listens on the loopback address only
 * @property {import('./access-control.js').AccessControl} [accessControl] who is allowed in with `--lan`; the server
 * 	keeps one across soundboards so bans last
 * @property {import('./router.js').AppInfo} [info] shared with the server, which fills in the tools once they are known
 */

/**
 * @typedef {BoardOptions & { logRequest?: (line: string) => void }} ServerOptions `logRequest` receives one line per
 * 	request; requests are not logged without it
 */

/**
 * Opens the server to the local network (DESIGN.md §1, §5.2).
 * @typedef {object} LanOptions
 * @property {string} address the address to listen on; `0.0.0.0` for every interface
 * @property {string[]} addresses this machine's addresses on the network, which the connect links use
 * @property {string[]} names the addresses and host names other machines use to reach the server
 * @property {(request: import('./access-control.js').PendingRequest) => void} [onRequest] called for every new pairing request
 */

/**
 * @typedef {object} DownloadPorts
 * @property {import('../downloads/tools.js').Tools} tools what startup found
 * @property {import('../downloads/yt-dlp-update.js').YtDlpUpdate | null} [update] what `yt-dlp -U` did at startup,
 * 	null when it didn't run
 * @property {import('../downloads/process-runner.js').ProcessRunner} [run]
 * @property {import('../downloads/link-fetcher.js').LinkFetcher} [fetcher]
 */

/**
 * Starts an HTTP server on the loopback address that serves one soundboard, without the startup phases (DESIGN.md §3).
 * The tests use it; the app uses `createBoard` inside `startApp`. Rejects with the listen error, such as EADDRINUSE.
 * @param {ServerOptions} options `port` 0 picks a free port
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startServer({ logRequest, ...options }) {
	const board = await createBoard(options);
	const server = createServer((request, response) => {
		if (logRequest) {
			logWhenDone(request, response, logRequest);
		}
		board.handle(request, response);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.port, options.lan?.address ?? LOOPBACK, () => {
			server.off('error', reject);
			resolve(undefined);
		});
	});
	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : options.port;
	board.setPort(port);
	return {
		url: `http://${LOOPBACK}:${port}`,
		close: async () => {
			await board.close();
			await new Promise((resolve) => {
				server.close(() => resolve(undefined));
				// Media streams and keep-alive connections would otherwise hold the server open.
				server.closeAllConnections();
			});
		},
	};
}

/**
 * Everything that serves one loaded soundboard: its services and its request handler. Closing it ends its event
 * streams with `startup.closed`, cancels a running download and forgets every allowed device (DESIGN.md §3).
 * @param {BoardOptions} options
 * @returns {Promise<import('../startup/startup-session.js').Board & { setPort: (port: number) => void }>}
 */
export async function createBoard({ library, settings, problems = [], port, publicDir = PUBLIC_DIR, logError, watcher, refresh, downloads, lan, accessControl, info }) {
	const updateFile = watcher?.updateFile;
	/** @type {import('../library/library-editor.js').FilesWriter} */
	const writeFiles = (task) => (watcher ? watcher.writeFiles(task) : task());
	/** @param {import('../library/library.js').Library} current */
	const servicesFor = (current) => ({
		library: current,
		editor: new LibraryEditor(current, { updateFile, writeFiles }),
		waveforms: new WaveformStore(current),
	});
	// The trash is not watched (DESIGN.md §2.5): it is read now and after the app's own changes to it.
	const trash = new Trash(library.root);
	await trash.reload();
	const control = accessControl ?? new AccessControl();
	if (!accessControl && lan?.onRequest) {
		control.onRequest(lan.onRequest);
	}
	/** @type {import('./router.js').RouterContext} */
	const context = {
		...servicesFor(library),
		settings,
		publicDir,
		// The port is known only once the server listens.
		guard: { hosts: [...LOOPBACK_HOSTS, ...(lan?.names ?? [])], port },
		access: lan && { control, links: /** @type {string[]} */ ([]) },
		relay: new RemoteRelay(),
		pairing: lan && control,
		logError,
		watcher,
		libraryChanges: new LibraryChanges(),
		trash,
		problems: new Problems(problems),
		info: info ?? { app: await appVersion(), checking: false, tools: { ytDlp: null, ffmpeg: null }, update: null },
		streams: new Set(),
		backgroundDownloads: new Set(),
		refreshing: null,
		refresh: refresh && (async () => {
			const outcome = await refresh();
			if (outcome.status === 'ready') {
				context.problems?.replace(outcome.problems);
				Object.assign(context, servicesFor(outcome.library), { settings: outcome.settings });
			}
			return outcome;
		}),
	};
	/** @param {DownloadPorts} ports */
	const startDownloads = ({ tools, update = null, run = runProcess, fetcher = httpLinkFetcher }) => {
		context.info.tools = tools;
		context.info.update = update;
		const problem = update && updateProblem(update);
		if (problem) {
			context.problems?.addLasting(problem);
		}
		context.downloads = new DownloadService({
			root: library.root,
			tools,
			ytDlp: new YtDlp(run),
			ffmpeg: new Ffmpeg(run),
			fetcher,
			// Read when a file is added, so an addition after a refresh lands in the new library.
			editor: () => context.editor,
			writeFiles,
		});
	};
	if (downloads) {
		startDownloads(downloads);
	}
	/** @param {number} actualPort */
	const setPort = (actualPort) => {
		context.guard.port = actualPort;
		if (context.access && lan) {
			context.access.links = lan.addresses.map((name) => `http://${name.includes(':') ? `[${name}]` : name}:${actualPort}/`);
		}
	};
	setPort(port);
	const handle = createRequestHandler(context);
	let closed = false;
	return {
		handle,
		setPort,
		close: async () => {
			if (closed) {
				return;
			}
			closed = true;
			for (const end of [...context.streams]) {
				end();
			}
			context.downloads?.cancel();
			control.revokeAll();
		},
	};
}
