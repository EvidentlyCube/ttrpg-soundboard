import { isIP } from 'node:net';
import { parseArgs } from 'node:util';

export const USAGE = 'Usage: node index.js [<audio-directory>…] [--port <number>] [--lan [<address>]] [--UNSAFE-lan-manager]'
	+ ' [--whitelisted-root <path>]… [--allow-hidden] [--no-open] [--verbose] [--help]';
/** High enough not to clash with the usual development servers. */
export const DEFAULT_PORT = 13872;

/** What `--help` prints. */
export const HELP = `${USAGE}

Starts the soundboard and opens it in the browser, where you choose the folder to use.

Arguments:
  <audio-directory>…         Folders to offer as soundboards. When any are given, the browser offers only
                             these, and browsing other folders is turned off.

Options:
  --port <number>            The port to listen on (default ${DEFAULT_PORT}). When it is taken, the next nine
                             are tried in turn.
  --no-open                  Don't open the browser at startup; open the printed address yourself.
  --lan [<address>]          Also answer other devices on the local network, such as a phone used as a
                             remote. They can connect only once a soundboard is open, and each one must be
                             allowed from this computer first. Without <address>, every network interface
                             is used.
  --UNSAFE-lan-manager       Let any device on the network choose and open a soundboard, without being
                             allowed first. It can browse every folder the app may open. Implies --lan.
  --whitelisted-root <path>  A folder the app may browse and open, together with everything inside it.
                             Give it several times for several folders. When given, it replaces the
                             default, the home folder; %home% (in any case) stands for the home folder,
                             so --whitelisted-root %home% keeps it.
  --allow-hidden             Also browse and open hidden folders, whose names start with a dot.
  --verbose                  Print every HTTP request.
  -h, --help                 Show this help and exit.

While it runs, press Ctrl+C or type exit and press Enter to stop it.`;

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
 * @returns {{ directories: string[], port: number, verbose: boolean, open: boolean, lan: { address: string | null } | null,
 * 	lanManager: boolean, roots: string[], allowHidden: boolean, help: boolean }}
 * 	`directories` are the only folders the Selector offers when there are any; `lan` is set with `--lan` or
 * 	`--UNSAFE-lan-manager`: the address to listen on, or null for every interface; `roots` are the `--whitelisted-root`
 * 	paths as typed, `%home%` included (DESIGN.md §5.7)
 */
export function parseArguments(argv) {
	let parsed;
	try {
		parsed = parseArgs({
			args: withLanValue(argv),
			allowPositionals: true,
			options: {
				'port': { type: 'string' },
				'verbose': { type: 'boolean', default: false },
				'no-open': { type: 'boolean', default: false },
				'lan': { type: 'string' },
				'UNSAFE-lan-manager': { type: 'boolean', default: false },
				'whitelisted-root': { type: 'string', multiple: true, default: [] },
				'allow-hidden': { type: 'boolean', default: false },
				'help': { type: 'boolean', short: 'h', default: false },
			},
		});
	} catch (error) {
		throw new UsageError(/** @type {Error} */ (error).message);
	}

	const { positionals, values } = parsed;
	const lanManager = values['UNSAFE-lan-manager'];
	const roots = values['whitelisted-root'];
	if (roots.some((root) => root.trim() === '')) {
		throw new UsageError('--whitelisted-root needs a path.');
	}
	return {
		directories: positionals,
		port: parsePort(values.port),
		verbose: values.verbose,
		open: !values['no-open'],
		// The manager is reached over the network, so it opens the server to it as `--lan` does.
		lan: parseLan(values.lan) ?? (lanManager ? { address: null } : null),
		lanManager,
		roots,
		allowHidden: values['allow-hidden'],
		help: values.help,
	};
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
