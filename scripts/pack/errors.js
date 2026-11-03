/** Packing cannot go on; the message says why and is shown as it is. */
export class PackError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'PackError';
	}
}
