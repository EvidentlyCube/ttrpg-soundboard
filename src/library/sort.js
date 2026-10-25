const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Natural, case- and accent-insensitive order ("2" before "10"). Names the collator treats as equal fall back to
 * code point order, so the result never depends on the order the file system listed them in.
 * @param {string} a
 * @param {string} b
 */
export function compareNatural(a, b) {
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
