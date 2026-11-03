/** @typedef {import('../logic/ports.js').BackendApi} BackendApi */
/** @typedef {import('../logic/ports.js').LibraryJson} LibraryJson */
/** @typedef {import('../logic/ports.js').Volumes} Volumes */
/** @typedef {import('../logic/ports.js').ItemOptions} ItemOptions */
/** @typedef {import('../logic/ports.js').RefreshResult} RefreshResult */

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

	/** @returns {Promise<import('../logic/ports.js').SettingsJson>} */
	fetchSettings() {
		return this.#request('GET', '/api/settings');
	}

	/**
	 * @param {string | null} name
	 * @param {{ keepalive: boolean }} options
	 */
	async saveName(name, { keepalive }) {
		await this.#request('PUT', '/api/settings/name', { body: { name }, keepalive });
	}

	/**
	 * @param {Volumes} volumes
	 * @param {{ keepalive: boolean }} options keepalive lets the request finish after the page has closed
	 */
	async saveVolumes(volumes, { keepalive }) {
		await this.#request('PUT', '/api/settings/volumes', { body: volumes, keepalive });
	}

	/**
	 * @param {string} soundId
	 * @param {ItemOptions} options
	 * @param {{ keepalive: boolean }} request
	 */
	async saveSoundOptions(soundId, options, { keepalive }) {
		await this.#request('PATCH', `/api/sounds/${encodeURIComponent(soundId)}`, { body: options, keepalive });
	}

	/**
	 * @param {string} playlistId
	 * @param {ItemOptions} options
	 * @param {{ keepalive: boolean }} request
	 */
	async savePlaylistOptions(playlistId, options, { keepalive }) {
		await this.#request('PATCH', `/api/playlists/${encodeURIComponent(playlistId)}`, { body: options, keepalive });
	}

	/**
	 * @param {string} trackId
	 * @param {ItemOptions} options
	 * @param {{ keepalive: boolean }} request
	 */
	async saveTrackOptions(trackId, options, { keepalive }) {
		await this.#request('PATCH', `/api/tracks/${encodeURIComponent(trackId)}`, { body: options, keepalive });
	}

	/** @returns {Promise<string[]>} */
	async fetchMissingWaveforms() {
		const { missing } = await this.#request('GET', '/api/waveforms');
		return missing;
	}

	/**
	 * @param {string} id
	 * @returns {Promise<Int8Array | null>}
	 */
	async fetchWaveform(id) {
		const response = await fetch(`${this.#baseUrl}/api/waveforms/${encodeURIComponent(id)}`);
		if (response.status === 404) {
			return null;
		}
		if (!response.ok) {
			throw new Error(`GET waveform failed: ${await errorMessageOf(response)}`);
		}
		return new Int8Array(await response.arrayBuffer());
	}

	/**
	 * @param {string} id
	 * @param {Int8Array} peaks
	 */
	async saveWaveform(id, peaks) {
		const response = await fetch(`${this.#baseUrl}/api/waveforms/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/octet-stream' },
			body: /** @type {any} */ (peaks),
		});
		if (!response.ok) {
			throw new Error(`PUT waveform failed: ${await errorMessageOf(response)}`);
		}
	}

	/** @returns {Promise<boolean>} */
	async checkExternalChanges() {
		const { externalChanges } = await this.#request('POST', '/api/changes/check');
		return externalChanges;
	}

	/** @returns {Promise<RefreshResult>} */
	async refresh() {
		const response = await fetch(`${this.#baseUrl}/api/refresh`, { method: 'POST' });
		if (response.ok) {
			return { status: 'refreshed' };
		}
		if (response.status === 422) {
			const { errors } = /** @type {{ errors: { path: string, message: string }[] }} */ (await response.json());
			return { status: 'invalid', errors };
		}
		if (response.status === 503) {
			return { status: 'restartNeeded', message: await errorMessageOf(response) };
		}
		throw new Error(`POST /api/refresh failed: ${await errorMessageOf(response)}`);
	}

	/** @type {BackendApi['fetchDownload']} */
	async fetchDownload() {
		return this.#request('GET', '/api/download');
	}

	/** @type {BackendApi['probeLink']} */
	async probeLink(url, { playlist }) {
		return this.#request('POST', '/api/download/probe', { body: { url, playlist }, plainErrors: true });
	}

	/** @type {BackendApi['startDownload']} */
	async startDownload(request) {
		return this.#request('POST', '/api/download', { body: request, plainErrors: true });
	}

	/** @type {BackendApi['dismissDownload']} */
	async dismissDownload() {
		const response = await fetch(`${this.#baseUrl}/api/download`, { method: 'DELETE' });
		if (!response.ok) {
			throw new Error(await errorMessageOf(response));
		}
	}

	/** @type {BackendApi['deleteItem']} */
	async deleteItem({ kind, id }) {
		const { changes } = await this.#request('DELETE', `/api/${kind}s/${encodeURIComponent(id)}`, { plainErrors: true });
		return changes;
	}

	/** @type {BackendApi['moveItem']} */
	async moveItem(id, to) {
		const { changes } = await this.#request('POST', '/api/move', { body: { id, to }, plainErrors: true });
		return changes;
	}

	/** @type {BackendApi['fetchInfo']} */
	async fetchInfo() {
		return this.#request('GET', '/api/info', { plainErrors: true });
	}

	/** @type {BackendApi['fetchTrash']} */
	async fetchTrash() {
		return this.#request('GET', '/api/trash', { plainErrors: true });
	}

	/** @type {BackendApi['restoreFromTrash']} */
	async restoreFromTrash(target) {
		const { changes } = await this.#request('POST', '/api/trash/restore', { body: trashBody(target), plainErrors: true });
		return changes;
	}

	/** @type {BackendApi['deleteFromTrash']} */
	async deleteFromTrash(target) {
		await this.#request('POST', '/api/trash/delete', { body: trashBody(target), plainErrors: true });
	}

	/** @type {BackendApi['dismissProblem']} */
	async dismissProblem(id) {
		await this.#delete(`/api/problems/${encodeURIComponent(id)}`);
	}

	/** @type {BackendApi['dismissAllProblems']} */
	async dismissAllProblems() {
		await this.#delete('/api/problems');
	}

	/** @type {BackendApi['fetchHostStatus']} */
	async fetchHostStatus() {
		const { host } = await this.#request('GET', '/api/remote', { plainErrors: true });
		return host;
	}

	/** @type {BackendApi['claimHost']} */
	async claimHost(pageId, { replace }) {
		const response = await fetch(`${this.#baseUrl}/api/remote/host`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pageId, replace }),
		});
		if (response.status === 409) {
			return 'taken';
		}
		if (!response.ok) {
			throw new Error(await errorMessageOf(response));
		}
		return 'claimed';
	}

	/** @type {BackendApi['releaseHost']} */
	async releaseHost(pageId, { keepalive }) {
		await this.#request('DELETE', `/api/remote/host?page=${encodeURIComponent(pageId)}`, { keepalive, plainErrors: true });
	}

	/** @type {BackendApi['sendRemoteState']} */
	async sendRemoteState(pageId, state) {
		await this.#request('PUT', '/api/remote/state', { body: { pageId, state }, plainErrors: true });
	}

	/** @type {BackendApi['sendRemoteCommand']} */
	async sendRemoteCommand(command) {
		await this.#request('POST', '/api/remote/commands', { body: command, plainErrors: true });
	}

	/** @type {BackendApi['fetchConnectLinks']} */
	async fetchConnectLinks() {
		const response = await fetch(`${this.#baseUrl}/api/access/links`, { cache: 'no-store' });
		if (response.status === 404) {
			return [];
		}
		if (!response.ok) {
			throw new Error(await errorMessageOf(response));
		}
		const { links } = /** @type {{ links: string[] }} */ (await response.json());
		return links;
	}

	/** @type {BackendApi['answerAccessRequest']} */
	async answerAccessRequest(address, decision) {
		await this.#request('POST', '/api/access/requests/answer', { body: { address, decision }, plainErrors: true });
	}

	/** @type {BackendApi['closeSoundboard']} */
	async closeSoundboard() {
		const response = await fetch(`${this.#baseUrl}/api/startup/close`, { method: 'POST' });
		if (!response.ok) {
			throw new Error(await errorMessageOf(response));
		}
	}

	/** @param {string} path */
	async #delete(path) {
		const response = await fetch(this.#baseUrl + path, { method: 'DELETE' });
		if (!response.ok) {
			throw new Error(await errorMessageOf(response));
		}
	}

	/**
	 * @param {'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE'} method
	 * @param {string} path
	 * @param {{ body?: unknown, keepalive?: boolean, plainErrors?: boolean }} [options] `plainErrors`: the server's
	 * 	message alone, for errors the page shows the user
	 * @returns {Promise<any>}
	 */
	async #request(method, path, { body, keepalive = false, plainErrors = false } = {}) {
		const response = await fetch(this.#baseUrl + path, {
			method,
			keepalive,
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			const message = await errorMessageOf(response);
			throw new Error(plainErrors ? message : `${method} ${path} failed: ${message}`);
		}
		return response.json();
	}
}

/** @param {import('../logic/ports.js').TrashTarget} target */
function trashBody(target) {
	return target === 'all' ? { all: true } : target;
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
