/** A command is malformed: unknown type, bad argument, or an unknown playlist or sound id. */
export class InvalidCommandError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'InvalidCommandError';
	}
}

/**
 * A message for the user, in English, with the code the page translates it by (DESIGN.md §9.21). Codes come from the
 * server or from this layer; without one, the message is shown as it is.
 * @typedef {{ message: string, code: string | null, params: Readonly<Record<string, string | number>> | null }} CodedText
 */

/** The server refused a request, with its message and, when it has one, the message's code. */
export class ServerError extends Error {
	/**
	 * @param {string} message
	 * @param {string | null} [code]
	 * @param {CodedText['params']} [params]
	 */
	constructor(message, code = null, params = null) {
		super(message);
		this.name = 'ServerError';
		this.code = code;
		this.params = params;
	}
}

/**
 * @param {unknown} error
 * @returns {CodedText}
 */
export function codedTextOf(error) {
	if (error instanceof ServerError) {
		return { message: error.message, code: error.code, params: error.params };
	}
	return { message: error instanceof Error ? error.message : String(error), code: null, params: null };
}

/** A command arrived before `start()` finished loading the library. */
export class NotReadyError extends Error {
	constructor() {
		super('The soundboard has not finished starting');
		this.name = 'NotReadyError';
	}
}
