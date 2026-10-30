import { isIP } from 'node:net';
import { parseArgs } from 'node:util';

export const USAGE = 'Usage: node index.js <audio-directory> [--port <number>] [--lan [<address>]] [--verbose]';
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
 * @returns {{ directory: string, port: number, verbose: boolean, lan: { address: string | null } | null }}
 * 	`lan` is set with `--lan`: the address to listen on, or null for every interface
 */
export function parseArguments(argv) {
	let parsed;
	try {
		parsed = parseArgs({
			args: withLanValue(argv),
			allowPositionals: true,
			options: { port: { type: 'string' }, verbose: { type: 'boolean', default: false }, lan: { type: 'string' } },
		});
	} catch (error) {
		throw new UsageError(/** @type {Error} */ (error).message);
	}

	const { positionals, values } = parsed;
	if (positionals.length !== 1) {
		throw new UsageError(positionals.length === 0 ? 'Missing the audio directory.' : 'Expected exactly one audio directory.');
	}
	return { directory: positionals[0], port: parsePort(values.port), verbose: values.verbose, lan: parseLan(values.lan) };
}

/**
 * `--lan` may be followed by an address, which `parseArgs` can't express as an optional value. The next argument counts
 * as the address only when it is one, so `--lan music` still reads `music` as the directory.
 * @param {string[]} argv
 */
function withLanValue(argv) {
	return argv.flatMap((argument, index) => {
		if (argument === '--lan') {
			return [isIP(argv[index + 1] ?? '') === 0 ? '--lan=' : `--lan=${argv[index + 1]}`];
		}
		return index > 0 && argv[index - 1] === '--lan' && isIP(argument) !== 0 ? [] : [argument];
	});
}

/** @param {string | undefined} value */
function parseLan(value) {
	if (value === undefined) {
		return null;
	}
	if (value !== '' && isIP(value) === 0) {
		throw new UsageError(`Invalid address for --lan: "${value}".`);
	}
	// A wildcard is not an address anyone can open, so it means the same as plain `--lan`: listen everywhere, link the real addresses.
	return { address: value === '' || value === '0.0.0.0' || value === '::' ? null : value };
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
