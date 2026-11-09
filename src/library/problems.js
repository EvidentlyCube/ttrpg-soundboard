import { backgroundOwnerOf } from './backgrounds.js';
import { isLargerThanFullHd } from './image-info.js';

/** @typedef {import('./scanner.js').ScanWarning} ScanWarning */

/**
 * @typedef {object} Problem
 * @property {string} id stable for the same kind and path, so a dismissal can be told apart from a new problem
 * @property {string} kind
 * @property {'error' | 'warning'} severity
 * @property {string} path root-relative path of the file or directory, using `/`
 * @property {string} message
 * @property {string} [code] what the page translates the message by (DESIGN.md §9.21)
 * @property {Record<string, string | number>} [params]
 */

/** @type {Record<ScanWarning['kind'], (params: Record<string, string | number>) => string>} */
const WARNING_MESSAGES = {
	'unsupported-audio': () => 'Not a supported audio format, so it is ignored.',
	'orphan-options': () => 'This options file has no audio file next to it.',
	'symlink': () => 'Symbolic links are ignored.',
	'empty-playlist': () => 'This playlist has no audio files, so it is hidden.',
	'invalid-background': ({ reason }) => `This image can't be shown: ${reason}`,
	'duplicate-background': () => 'This playlist or sound has more than one image, so none is shown. Delete all but one.',
	'large-background': ({ width, height }) => `This image is ${width} × ${height} px. 1920 × 1080 is plenty; larger images use more memory.`,
};

/**
 * The warning a background larger than 1080p leaves (DESIGN.md §5.1), or null for one that isn't.
 * @param {string} path root-relative
 * @param {{ width: number, height: number }} size
 * @returns {ScanWarning | null}
 */
export function largeBackgroundWarning(path, size) {
	return isLargerThanFullHd(size) ? { kind: 'large-background', path, params: { width: size.width, height: size.height } } : null;
}

/**
 * @param {ScanWarning} warning
 * @returns {Problem}
 */
export function problemOfWarning({ kind, path, params = {} }) {
	return problemOf(kind, 'warning', path, WARNING_MESSAGES[kind](params), params);
}

/**
 * What bootstrap found wrong with the directory (DESIGN.md §3.1): the scan's warnings, and the files whose duration
 * could not be measured (§3.5).
 * @param {ScanWarning[]} warnings
 * @param {import('./library.js').Library} library
 * @returns {Problem[]}
 */
export function startupProblems(warnings, library) {
	/** @type {Problem[]} */
	const problems = warnings.map(problemOfWarning);
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
 * @param {Record<string, string | number>} [params]
 * @returns {Problem}
 */
function problemOf(kind, severity, path, message, params = {}) {
	return { id: `${kind}:${path}`, kind, severity, path, message, code: `problem.${kind}`, params };
}

/**
 * The problems found at startup or by a refresh, which pages can dismiss (DESIGN.md §5.1). Problems that happen
 * while the page runs are the page's own (§6.1).
 */
export class Problems {
	/** @type {Problem[]} */
	#list;
	/** @type {Problem[]} */
	#lasting = [];
	/** @type {Set<(list: Problem[]) => void>} */
	#listeners = new Set();

	/** @param {Problem[]} [list] */
	constructor(list = []) {
		this.#list = list;
	}

	get list() {
		return this.#list;
	}

	/**
	 * Replaces the library's problems; lasting ones stay.
	 * @param {Problem[]} list
	 */
	replace(list) {
		this.#set([...this.#lasting, ...list]);
	}

	/**
	 * Adds a problem that isn't about the library, such as an outdated yt-dlp, so a refresh keeps it.
	 * @param {Problem} problem
	 */
	addLasting(problem) {
		this.#lasting.push(problem);
		this.#set([problem, ...this.#list.filter((known) => known.id !== problem.id)]);
	}

	/**
	 * Adds a problem about the library found while the app runs, such as a large image just set; the next refresh
	 * finds it again if it still applies.
	 * @param {Problem} problem
	 */
	add(problem) {
		this.#set([...this.#list.filter((known) => known.id !== problem.id), problem]);
	}

	/**
	 * @param {string} id
	 * @returns {boolean} whether there was such a problem
	 */
	dismiss(id) {
		const known = this.#list.some((problem) => problem.id === id);
		if (known) {
			this.#lasting = this.#lasting.filter((problem) => problem.id !== id);
			this.#set(this.#list.filter((problem) => problem.id !== id));
		}
		return known;
	}

	dismissAll() {
		this.#lasting = [];
		this.#set([]);
	}

	/**
	 * Forgets the problems of a file, or of everything inside a directory, that has been deleted or moved away.
	 * @param {string} path
	 */
	removeFor(path) {
		this.#set(this.#list.filter((problem) => (
			this.#lasting.includes(problem)
			|| (problem.path !== path && !problem.path.startsWith(`${path}/`))
		)));
	}

	/**
	 * Forgets the problems of an item's images, which sit beside it rather than inside it (DESIGN.md §2.1).
	 * @param {string} ownerPath root-relative path of the playlist
	 */
	removeBackgroundsOf(ownerPath) {
		this.#set(this.#list.filter((problem) => this.#lasting.includes(problem) || backgroundOwnerOf(problem.path) !== ownerPath));
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
