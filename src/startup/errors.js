/** A startup action that doesn't fit the current phase or step, such as answering when nothing was asked. */
export class StartupStateError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'StartupStateError';
	}
}

/** The folder may not be opened as a soundboard (DESIGN.md §5.7); the message says why. */
export class FolderRefusedError extends Error {
	/** @param {string} reason */
	constructor(reason) {
		super(reason);
		this.name = 'FolderRefusedError';
	}
}
