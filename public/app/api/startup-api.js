/** @typedef {import('../logic/startup-flow.js').StartupApi} StartupApi */

/**
 * The startup routes over HTTP (DESIGN.md §5.2). Failures reject with the server's own message, which the pages show.
 * @implements {StartupApi}
 */
export class HttpStartupApi {
	#baseUrl;

	/** @param {string} [baseUrl] empty in the browser, where requests go to the page's own server */
	constructor(baseUrl = '') {
		this.#baseUrl = baseUrl;
	}

	/** @type {StartupApi['fetchState']} */
	fetchState() {
		return this.#call('GET', '/api/startup');
	}

	/** @type {StartupApi['fetchPlaces']} */
	fetchPlaces() {
		return this.#call('GET', '/api/startup/folders');
	}

	/** @type {StartupApi['listFolder']} */
	listFolder(path) {
		return this.#call('GET', `/api/startup/folders?${new URLSearchParams({ path })}`);
	}

	/** @type {StartupApi['select']} */
	async select(path) {
		await this.#call('POST', '/api/startup/select', { path });
	}

	/** @type {StartupApi['answer']} */
	async answer(id, yes) {
		await this.#call('POST', '/api/startup/answer', { id, yes });
	}

	/** @type {StartupApi['back']} */
	async back() {
		await this.#call('POST', '/api/startup/back');
	}

	/** @type {StartupApi['retry']} */
	async retry() {
		await this.#call('POST', '/api/startup/retry');
	}

	/** @type {StartupApi['deleteAndRetry']} */
	async deleteAndRetry() {
		await this.#call('POST', '/api/startup/delete-and-retry');
	}

	/** @type {StartupApi['forgetRecent']} */
	async forgetRecent(path) {
		await this.#call('DELETE', '/api/startup/recent', { path });
	}

	/**
	 * @param {string} method
	 * @param {string} path
	 * @param {unknown} [body]
	 * @returns {Promise<any>}
	 */
	async #call(method, path, body) {
		const response = await fetch(this.#baseUrl + path, {
			method,
			cache: 'no-store',
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			const { error } = /** @type {{ error?: unknown }} */ (await response.json().catch(() => ({})));
			throw new Error(typeof error === 'string' ? error : `HTTP ${response.status}`);
		}
		return response.status === 204 ? undefined : response.json();
	}
}
