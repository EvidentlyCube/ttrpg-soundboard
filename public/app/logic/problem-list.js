/**
 * @typedef {object} ProblemJson
 * @property {string} id
 * @property {string} kind
 * @property {'error' | 'warning'} severity
 * @property {string} path the file, directory or download it is about
 * @property {string} message the latest message
 * @property {string | null} [code] what the page translates the message by (DESIGN.md §9.21)
 * @property {Readonly<Record<string, string | number>> | null} [params]
 * @property {number} count how often it happened; 1 for the server's problems
 */

/**
 * Everything wrong that the user can see in the Problems dialog (DESIGN.md §6.1): the server's own problems (§5.1),
 * which it keeps and can dismiss, and the ones that happen in this page, such as a track that fails to play.
 * Repeats of the same kind and path share a row.
 */
export class ProblemList {
	/** @type {ProblemJson[]} */
	#server = [];
	/** @type {Map<string, ProblemJson>} */
	#page = new Map();

	/** @returns {ProblemJson[]} the server's problems first, then this page's in the order they began */
	get list() {
		return [...this.#server, ...this.#page.values()];
	}

	/**
	 * @param {Omit<ProblemJson, 'count'>[]} problems
	 * @returns {boolean} whether the list changed
	 */
	setServer(problems) {
		const next = problems.map((problem) => ({ ...problem, count: 1 }));
		const same = next.length === this.#server.length && next.every((problem, index) => problem.id === this.#server[index].id);
		this.#server = next;
		return !same;
	}

	/**
	 * @param {{ kind: string, path: string, message: string, code?: string | null, params?: ProblemJson['params'],
	 * 	severity?: ProblemJson['severity'] }} problem errors unless said otherwise
	 */
	record({ kind, path, message, code = null, params = null, severity = 'error' }) {
		const id = `${kind}:${path}`;
		const known = this.#page.get(id);
		this.#page.set(id, { id, kind, severity, path, message, code, params, count: (known?.count ?? 0) + 1 });
	}

	/**
	 * @param {string} id
	 * @returns {'server' | 'page' | null} whose problem it was
	 */
	dismiss(id) {
		if (this.#page.delete(id)) {
			return 'page';
		}
		const before = this.#server.length;
		this.#server = this.#server.filter((problem) => problem.id !== id);
		return this.#server.length < before ? 'server' : null;
	}

	/** @returns {boolean} whether the server had any to dismiss */
	clear() {
		const hadServer = this.#server.length > 0;
		this.#server = [];
		this.#page.clear();
		return hadServer;
	}

	/**
	 * Forgets this page's problems about an item that is gone, and about everything inside it.
	 * @param {string} path
	 */
	forget(path) {
		for (const [id, problem] of this.#page) {
			if (problem.path === path || problem.path.startsWith(`${path}/`)) {
				this.#page.delete(id);
			}
		}
	}

	/**
	 * @param {string} kind
	 * @param {string} path
	 */
	resolve(kind, path) {
		this.#page.delete(`${kind}:${path}`);
	}
}
