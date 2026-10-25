/** @typedef {import('../logic/ports.js').BackendApi} BackendApi */
/** @typedef {import('../logic/ports.js').LibraryJson} LibraryJson */
/** @typedef {import('../logic/ports.js').Volumes} Volumes */

/**
 * Talks to the soundboard server's JSON API (DESIGN.md §5.2).
 * @implements {BackendApi}
 */
export class HttpBackendApi {
	#baseUrl;

	/** @param {string} [baseUrl] empty in the browser, where requests go to the page's own server */
	constructor(baseUrl = '') {
		this.#baseUrl = baseUrl;
	}

	/** @returns {Promise<LibraryJson>} */
	fetchLibrary() {
		return this.#request('GET', '/api/library');
	}

	/** @returns {Promise<{ volumes: Volumes }>} */
	fetchSettings() {
		return this.#request('GET', '/api/settings');
	}

	/**
	 * @param {Volumes} volumes
	 * @param {{ keepalive: boolean }} options keepalive lets the request finish after the page has closed
	 */
	async saveVolumes(volumes, { keepalive }) {
		await this.#request('PUT', '/api/settings/volumes', { body: volumes, keepalive });
	}

	/**
	 * @param {'GET' | 'PUT'} method
	 * @param {string} path
	 * @param {{ body?: unknown, keepalive?: boolean }} [options]
	 * @returns {Promise<any>}
	 */
	async #request(method, path, { body, keepalive = false } = {}) {
		const response = await fetch(this.#baseUrl + path, {
			method,
			keepalive,
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`${method} ${path} failed: ${await errorMessageOf(response)}`);
		}
		return response.json();
	}
}

/** @param {Response} response */
async function errorMessageOf(response) {
	try {
		const { error } = /** @type {{ error?: unknown }} */ (await response.json());
		if (typeof error === 'string') {
			return error;
		}
	} catch {
		// Not a JSON error body; fall back to the status line.
	}
	return `HTTP ${response.status}`;
}
