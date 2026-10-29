import { toFileJson, toPlaylistJson } from './library-json.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../library/change-watcher.js').ChangeWatcher} ChangeWatcher */
/** @typedef {import('../downloads/download-service.js').DownloadService} DownloadService */
/** @typedef {import('../downloads/download-service.js').DownloadEvent} DownloadEvent */
/** @typedef {import('../library/library-editor.js').LibraryChange} LibraryChange */
/** @typedef {import('./library-changes.js').LibraryChanges} LibraryChanges */

/** Proxies and browsers may drop a stream that stays silent too long. */
const KEEP_ALIVE_MS = 30_000;

/**
 * Streams typed messages as server-sent events (DESIGN.md §5.2): `externalChanges` on connect and whenever it
 * changes, and the download's progress, log and additions while one runs. The stream stays open until the page goes
 * away or the server stops.
 * @param {Request} request
 * @param {Response} response
 * @param {{ watcher?: ChangeWatcher, downloads?: DownloadService, libraryChanges?: LibraryChanges }} sources without
 * 	them, nothing ever changes
 */
export function serveEvents(request, response, { watcher, downloads, libraryChanges }) {
	response.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-store',
		'Connection': 'keep-alive',
	});
	/** @param {unknown} message */
	const send = (message) => response.write(`data: ${JSON.stringify(message)}\n\n`);
	const sendExternalChanges = () => send({ type: 'externalChanges', pending: watcher?.externalChanges ?? false });
	sendExternalChanges();
	if (downloads) {
		// The page may have missed the log while it was disconnected, so every connection starts with all of it.
		const current = downloads.current();
		if (current) {
			const { log, ...job } = current;
			send({ type: 'download', job, log });
		} else {
			send({ type: 'download', job: null, log: [] });
		}
	}
	const unsubscribeWatcher = watcher?.onChange(sendExternalChanges);
	const unsubscribeDownloads = downloads?.onEvent((event) => send(toMessage(event)));
	const unsubscribeLibrary = libraryChanges?.onChange((change) => send(toMessage(change)));
	const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
	request.on('close', () => {
		clearInterval(keepAlive);
		unsubscribeWatcher?.();
		unsubscribeDownloads?.();
		unsubscribeLibrary?.();
	});
}

/**
 * Additions carry the item in the `/api/library` format.
 * @param {DownloadEvent | LibraryChange} event
 */
export function toMessage(event) {
	if (event.type !== 'library.added') {
		return event;
	}
	return 'sound' in event
		? { type: 'library.added', sound: toFileJson(event.sound) }
		: { type: 'library.added', playlist: toPlaylistJson(event.playlist) };
}
