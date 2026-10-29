/** @typedef {import('./scanner.js').ScanWarning} ScanWarning */

/**
 * @typedef {object} Problem
 * @property {string} id stable for the same kind and path, so a dismissal can be told apart from a new problem
 * @property {string} kind
 * @property {'error' | 'warning'} severity
 * @property {string} path root-relative path of the file or directory, using `/`
 * @property {string} message
 */

/** @type {Record<ScanWarning['kind'], string>} */
const WARNING_MESSAGES = {
	'unsupported-audio': 'Not a supported audio format, so it is ignored.',
	'orphan-options': 'This options file has no audio file next to it.',
	'symlink': 'Symbolic links are ignored.',
	'empty-playlist': 'This playlist has no audio files, so it is hidden.',
};

/**
 * What bootstrap found wrong with the directory (DESIGN.md §3.1): the scan's warnings, and the files whose duration
 * could not be measured (§3.5).
 * @param {ScanWarning[]} warnings
 * @param {import('./library.js').Library} library
 * @returns {Problem[]}
 */
export function startupProblems(warnings, library) {
	/** @type {Problem[]} */
	const problems = warnings.map(({ kind, path }) => problemOf(kind, 'warning', path, WARNING_MESSAGES[kind]));
	const files = [...library.sounds, ...library.playlists.flatMap((playlist) => playlist.tracks)];
	for (const file of files) {
		if (file.duration === null) {
			problems.push(problemOf('unknown-duration', 'error', file.id, 'Its duration could not be measured, so start and end points and crossfades are unavailable.'));
		}
	}
	return problems;
}

/**
 * @param {string} kind
 * @param {Problem['severity']} severity
 * @param {string} path
 * @param {string} message
 * @returns {Problem}
 */
function problemOf(kind, severity, path, message) {
	return { id: `${kind}:${path}`, kind, severity, path, message };
}

/**
 * The problems found at startup or by a refresh, which pages can dismiss (DESIGN.md §5.1). Problems that happen
 * while the page runs are the page's own (§6.1).
 */
export class Problems {
	/** @type {Problem[]} */
	#list;
	/** @type {Set<(list: Problem[]) => void>} */
	#listeners = new Set();

	/** @param {Problem[]} [list] */
	constructor(list = []) {
		this.#list = list;
	}

	get list() {
		return this.#list;
	}

	/** @param {Problem[]} list */
	replace(list) {
		this.#set(list);
	}

	/**
	 * @param {string} id
	 * @returns {boolean} whether there was such a problem
	 */
	dismiss(id) {
		const known = this.#list.some((problem) => problem.id === id);
		if (known) {
			this.#set(this.#list.filter((problem) => problem.id !== id));
		}
		return known;
	}

	dismissAll() {
		this.#set([]);
	}

	/**
	 * Forgets the problems of a file, or of everything inside a directory, that has been deleted or moved away.
	 * @param {string} path
	 */
	removeFor(path) {
		this.#set(this.#list.filter((problem) => problem.path !== path && !problem.path.startsWith(`${path}/`)));
	}

	/**
	 * @param {(list: Problem[]) => void} listener
	 * @returns {() => void} unsubscribes
	 */
	onChange(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** @param {Problem[]} list */
	#set(list) {
		if (list.length === this.#list.length && list.every((problem, index) => problem.id === this.#list[index].id)) {
			return;
		}
		this.#list = list;
		for (const listener of this.#listeners) {
			listener(list);
		}
	}
}
