/** @typedef {{ type: 'none' } | { type: 'range', start: number, end: number } | { type: 'unsatisfiable' }} RangeRequest */

const BYTE_RANGE = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i;

/**
 * Interprets a `Range` header for a file of `size` bytes. Only the first range of a list is honored.
 * Malformed headers are ignored, as HTTP requires, which means the whole file is sent.
 * @param {string | undefined} header
 * @param {number} size
 * @returns {RangeRequest}
 */
export function parseRange(header, size) {
	const match = header === undefined ? null : BYTE_RANGE.exec(header.split(',')[0]);
	if (!match) {
		return { type: 'none' };
	}
	const [, first, last] = match;

	if (first === '') {
		if (last === '') {
			return { type: 'none' };
		}
		const suffixLength = Number(last);
		if (suffixLength === 0 || size === 0) {
			return { type: 'unsatisfiable' };
		}
		return { type: 'range', start: Math.max(0, size - suffixLength), end: size - 1 };
	}

	const start = Number(first);
	if (last !== '' && Number(last) < start) {
		return { type: 'none' };
	}
	if (start >= size) {
		return { type: 'unsatisfiable' };
	}
	return { type: 'range', start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) };
}
