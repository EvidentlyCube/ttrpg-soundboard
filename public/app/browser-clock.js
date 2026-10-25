/** @typedef {import('./logic/ports.js').Clock} Clock */

/** The browser's own timers, behind the Clock port the logic layer uses. */
export const browserClock = /** @type {Clock} */ ({
	setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
	clearTimeout: (id) => window.clearTimeout(id),
	setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
	clearInterval: (id) => window.clearInterval(id),
});
