import { parseArgs } from 'node:util';

export const USAGE = 'Usage: node index.js <audio-directory> [--port <number>] [--verbose]';
export const DEFAULT_PORT = 3000;

/** The command line was used incorrectly; the message is shown to the user together with the usage line. */
export class UsageError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'UsageError';
	}
}

/**
 * @param {string[]} argv arguments after the script name
 * @returns {{ directory: string, port: number, verbose: boolean }}
 */
export function parseArguments(argv) {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			allowPositionals: true,
			options: { port: { type: 'string' }, verbose: { type: 'boolean', default: false } },
		});
	} catch (error) {
		throw new UsageError(/** @type {Error} */ (error).message);
	}

	const { positionals, values } = parsed;
	if (positionals.length !== 1) {
		throw new UsageError(positionals.length === 0 ? 'Missing the audio directory.' : 'Expected exactly one audio directory.');
	}
	return { directory: positionals[0], port: parsePort(values.port), verbose: values.verbose };
}

/** @param {string | undefined} value */
function parsePort(value) {
	if (value === undefined) {
		return DEFAULT_PORT;
	}
	const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
	if (!(port >= 1 && port <= 65535)) {
		throw new UsageError(`Invalid port: "${value}". Use a number from 1 to 65535.`);
	}
	return port;
}
