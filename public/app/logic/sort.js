/**
 * The browser's copy of the server's title order (DESIGN.md §2.2), so a renamed item lands where a reload would put it.
 * The browser cannot load the server's modules, so this duplicates `src/library/sort.js`; a test keeps them in step.
 */

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * @param {string} a
 * @param {string} b
 */
function compareNatural(a, b) {
	return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => string} key
 * @returns {T[]}
 */
export function sortBy(items, key) {
	return items.toSorted((a, b) => compareNatural(key(a), key(b)));
}
