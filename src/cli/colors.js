/** @typedef {{ red: (text: string) => string, yellow: (text: string) => string, bold: (text: string) => string }} Colors */

/**
 * Follows https://no-color.org: a non-empty NO_COLOR turns colors off.
 * @param {{ isTTY?: boolean }} stream
 * @param {Record<string, string | undefined>} env
 */
export function shouldUseColor(stream, env) {
	return stream.isTTY === true && !env.NO_COLOR;
}

/**
 * @param {boolean} enabled
 * @returns {Colors}
 */
export function createColors(enabled) {
	/**
	 * @param {number} open
	 * @param {number} close
	 */
	const style = (open, close) => enabled
		? (/** @type {string} */ text) => `\x1b[${open}m${text}\x1b[${close}m`
		: (/** @type {string} */ text) => text;
	return {
		red: style(31, 39),
		yellow: style(33, 39),
		bold: style(1, 22),
	};
}
