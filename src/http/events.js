/** @typedef {import('node:http').IncomingMessage} Request */
/** @typedef {import('node:http').ServerResponse} Response */
/** @typedef {import('../library/change-watcher.js').ChangeWatcher} ChangeWatcher */

/** Proxies and browsers may drop a stream that stays silent too long. */
const KEEP_ALIVE_MS = 30_000;

/**
 * Streams `{ externalChanges }` as server-sent events: the current value on connect, then every change of it. The
 * stream stays open until the page goes away or the server stops.
 * @param {Request} request
 * @param {Response} response
 * @param {ChangeWatcher | undefined} watcher without one, nothing ever changes
 */
export function serveEvents(request, response, watcher) {
	response.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-store',
		'Connection': 'keep-alive',
	});
	const send = () => response.write(`data: ${JSON.stringify({ externalChanges: watcher?.externalChanges ?? false })}\n\n`);
	send();
	const unsubscribe = watcher?.onChange(send);
	const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
	request.on('close', () => {
		clearInterval(keepAlive);
		unsubscribe?.();
	});
}
