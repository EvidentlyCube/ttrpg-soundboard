/** @typedef {import('../library/library-editor.js').LibraryChange} LibraryChange */

/**
 * Hands the library's deletions and moves to every open event stream (DESIGN.md §5.2), so all pages follow them.
 */
export class LibraryChanges {
	/** @type {Set<(change: LibraryChange) => void>} */
	#listeners = new Set();

	/** @param {LibraryChange[]} changes */
	emit(changes) {
		for (const change of changes) {
			for (const listener of this.#listeners) {
				listener(change);
			}
		}
	}

	/**
	 * @param {(change: LibraryChange) => void} listener
	 * @returns {() => void} unsubscribes
	 */
	onChange(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}
