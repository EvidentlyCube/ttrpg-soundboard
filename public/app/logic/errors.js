/** A command is malformed: unknown type, bad argument, or an unknown playlist or sound id. */
export class InvalidCommandError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'InvalidCommandError';
	}
}

/** A command arrived before `start()` finished loading the library. */
export class NotReadyError extends Error {
	constructor() {
		super('The soundboard has not finished starting');
		this.name = 'NotReadyError';
	}
}
