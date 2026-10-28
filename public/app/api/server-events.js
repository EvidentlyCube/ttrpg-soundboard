/** @typedef {import('../logic/ports.js').ServerEvents} ServerEvents */

/**
 * Receives the server's pushed messages from `GET /api/events` (server-sent events). `EventSource` reconnects by
 * itself, and the server sends its current state on every connection, so nothing is missed while it was away.
 * @implements {ServerEvents}
 */
export class EventSourceServerEvents {
	#url;

	/** @param {string} [baseUrl] empty in the browser, where requests go to the page's own server */
	constructor(baseUrl = '') {
		this.#url = `${baseUrl}/api/events`;
	}

	/** @type {ServerEvents['connect']} */
	connect(onMessage) {
		const source = new EventSource(this.#url);
		source.addEventListener('message', (event) => onMessage(JSON.parse(event.data)));
		return () => source.close();
	}
}
