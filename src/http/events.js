import { toPlaylistJson, toSoundJson } from './library-json.js';

/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../library/change-watcher.js').ChangeWatcher} ChangeWatcher */
/** @typedef {import('../downloads/download-service.js').DownloadService} DownloadService */
/** @typedef {import('../downloads/download-service.js').DownloadEvent} DownloadEvent */
/** @typedef {import('../library/library-editor.js').LibraryChange} LibraryChange */
/** @typedef {import('./library-changes.js').LibraryChanges} LibraryChanges */
/** @typedef {import('../remote/remote-relay.js').RemoteRelay} RemoteRelay */

/** Proxies and browsers may drop a stream that stays silent too long. */
const KEEP_ALIVE_MS = 30_000;

/**
 * Streams typed messages as server-sent events (DESIGN.md §5.2): `externalChanges` and `problems` on connect and whenever it
 * changes, and the download's progress, log and additions while one runs. The stream stays open until the page goes
 * away or the server stops. A remote's stream (`?role=remote`) carries only what the relay says about the host; a
 * page that plays says which one it is (`?page=<id>`), so the relay can reach it (DESIGN.md §5).
 * @param {Request} request
 * @param {Response} response
 * @param {{ watcher?: ChangeWatcher, downloads?: DownloadService, libraryChanges?: LibraryChanges,
 * 	trash?: import('../library/trash.js').Trash, problems?: import('../library/problems.js').Problems, relay?: RemoteRelay,
 * 	pairing?: import('./access-control.js').AccessControl, streams?: Set<() => void> }} sources without them, nothing
 * 	ever changes. `streams` collects a function per open stream that sends `startup.closed` and ends it, for when the
 * 	soundboard closes (DESIGN.md §3)
 */
export function serveEvents(request, response, { watcher, downloads, libraryChanges, trash, problems, relay, pairing, streams }) {
	response.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-store',
		'Connection': 'keep-alive',
	});
	// A closed soundboard ends the stream before the client goes away, and sources may still report until it does.
	/** @param {string} text */
	const write = (text) => {
		if (!response.writableEnded) {
			response.write(text);
		}
	};
	/** @param {unknown} message */
	const send = (message) => write(`data: ${JSON.stringify(message)}\n\n`);
	const end = () => {
		send({ type: 'startup.closed' });
		response.end();
	};
	streams?.add(end);
	request.on('close', () => streams?.delete(end));
	const { searchParams } = new URL(request.url ?? '/', 'http://localhost');
	const isRemote = searchParams.get('role') === 'remote';
	const pageId = searchParams.get('page');
	if (isRemote && relay) {
		const detachRemote = relay.attachRemote(send);
		const keepAliveRemote = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);
		request.on('close', () => {
			clearInterval(keepAliveRemote);
			detachRemote();
		});
		return;
	}
	const detachPage = relay && pageId ? relay.attachPage(pageId, send) : undefined;
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
	const sendTrash = (/** @type {import('../library/trash.js').TrashSummary} */ summary) => send({ type: 'trash', ...summary });
	if (trash) {
		sendTrash(trash.summary);
	}
	const sendProblems = (/** @type {import('../library/problems.js').Problem[]} */ list) => send({ type: 'problems', problems: list });
	if (problems) {
		sendProblems(problems.list);
	}
	const sendRequests = () => send({ type: 'access.requests', requests: pairing?.pending() ?? [] });
	if (pairing) {
		sendRequests();
	}
	const unsubscribePairing = pairing?.onChange(sendRequests);
	const unsubscribeProblems = problems?.onChange(sendProblems);
	const unsubscribeTrash = trash?.onChange(sendTrash);
	const unsubscribeWatcher = watcher?.onChange(sendExternalChanges);
	const unsubscribeDownloads = downloads?.onEvent((event) => send(toMessage(event)));
	const unsubscribeLibrary = libraryChanges?.onChange((change) => send(toMessage(change)));
	const keepAlive = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);
	request.on('close', () => {
		clearInterval(keepAlive);
		detachPage?.();
		unsubscribeWatcher?.();
		unsubscribeDownloads?.();
		unsubscribeLibrary?.();
		unsubscribeTrash?.();
		unsubscribeProblems?.();
		unsubscribePairing?.();
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
		? { type: 'library.added', sound: toSoundJson(event.sound) }
		: { type: 'library.added', playlist: toPlaylistJson(event.playlist) };
}
