import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { runProcess } from '../downloads/process-runner.js';
import { describeTools, findTools, missingTools } from '../downloads/tools.js';
import { clearWorkspace } from '../downloads/workspace.js';
import { startServer } from '../http/server.js';
import { BootstrapService } from '../library/bootstrap-service.js';
import { ChangeWatcher } from '../library/change-watcher.js';
import { parseArguments, USAGE, UsageError } from './args.js';
import { createColors, shouldUseColor } from './colors.js';
import { TerminalPrompter } from './prompter.js';
import { ConsoleReporter } from './reporter.js';

/**
 * @typedef {object} Terminal
 * @property {NodeJS.ReadableStream} input
 * @property {{ write: (chunk: string) => unknown, isTTY?: boolean }} output
 * @property {{ write: (chunk: string) => unknown }} errorOutput
 * @property {Record<string, string | undefined>} env
 * @property {() => Promise<void>} waitForShutdown resolves when the server should stop, e.g. on SIGINT;
 * 	only called once the server is up, so Ctrl+C during the startup questions still ends the process immediately
 * @property {import('../downloads/process-runner.js').ProcessRunner} [run] starts yt-dlp and ffmpeg; tests pass a fake
 * @property {() => string[]} [networkAddresses] this machine's addresses on the local network, for `--lan`; tests pass a fixed list
 */

/**
 * Runs the app from the command line and resolves with the process exit code once the server has stopped.
 * @param {string[]} argv arguments after the script name
 * @param {Terminal} terminal
 * @returns {Promise<number>}
 */
export async function main(argv, { input, output, errorOutput, env, waitForShutdown, run = runProcess, networkAddresses = lanAddresses }) {
	let args;
	try {
		args = parseArguments(argv);
	} catch (error) {
		if (!(error instanceof UsageError)) {
			throw error;
		}
		errorOutput.write(`${error.message}\n\n${USAGE}\n`);
		return 1;
	}

	const root = resolve(args.directory);
	if (!(await isDirectory(root))) {
		errorOutput.write(`Not a directory: ${args.directory}\n\n${USAGE}\n`);
		return 1;
	}

	const colors = createColors(shouldUseColor(output, env));
	const reporter = new ConsoleReporter(output, colors, root);
	const prompter = new TerminalPrompter(input, output);
	const watcher = new ChangeWatcher({ root, log: (message) => output.write(`${message}\n`) });
	// The prompter is closed once the server runs, but a refresh never asks anything.
	const bootstrap = new BootstrapService({ prompter, reporter, updateSettingsFile: watcher.updateFile });
	let outcome;
	try {
		outcome = await bootstrap.run(root);
	} finally {
		prompter.close();
	}
	if (outcome.status !== 'ready') {
		return outcome.status === 'invalid' ? 1 : 0;
	}

	await clearWorkspace(root);
	const tools = await findTools(run);
	const missing = missingTools(tools);
	output.write(`${missing.length > 0 ? colors.yellow(describeTools(tools)) : describeTools(tools)}\n`);

	/** @type {{ options: import('../http/server.js').LanOptions, addresses: string[] } | undefined} */
	let lan;
	if (args.lan) {
		const addresses = args.lan.address ? [args.lan.address] : networkAddresses();
		lan = {
			addresses,
			options: {
				address: args.lan.address ?? '0.0.0.0',
				names: [...addresses, ...(args.lan.address ? [] : [hostname(), `${hostname()}.local`])].map((name) => (name.includes(':') ? `[${name}]` : name)),
				token: randomBytes(16).toString('hex'),
			},
		};
	}
	let server;
	try {
		await watcher.start(outcome.scan);
		server = await startServer({
			library: outcome.library,
			settings: outcome.settings,
			problems: outcome.problems,
			port: args.port,
			logError: (error) => errorOutput.write(`${error instanceof Error ? error.stack : String(error)}\n`),
			logRequest: args.verbose ? (line) => output.write(`${line}\n`) : undefined,
			watcher,
			downloads: { tools, run },
			lan: lan?.options,
			refresh: () => watcher.refresh(() => {
				output.write('Refreshing after external changes…\n');
				return bootstrap.refresh(root);
			}),
		});
	} catch (error) {
		watcher.stop();
		const message = listenErrorMessage(/** @type {NodeJS.ErrnoException} */ (error), args.port);
		if (message === null) {
			throw error;
		}
		errorOutput.write(`${message}\n`);
		return 1;
	}

	output.write(`Soundboard running at ${server.url}\n`);
	if (lan) {
		writeLanLinks(output, colors, lan, args.port);
	}
	output.write('Press Ctrl+C to stop.\n');
	await waitForShutdown();
	watcher.stop();
	await server.close();
	output.write('Stopped.\n');
	return 0;
}

/**
 * @param {NodeJS.ErrnoException} error
 * @param {number} port
 * @returns {string | null} null for errors that are bugs rather than environment problems
 */
function listenErrorMessage(error, port) {
	switch (error.code) {
		case 'EADDRINUSE':
			return `Port ${port} is already in use. Stop the program using it, or choose another port with --port.`;
		case 'EACCES':
			return `Not allowed to use port ${port}. Choose a port above 1023 with --port.`;
		default:
			return null;
	}
}

/** @param {string} path */
async function isDirectory(path) {
	return stat(path).then((stats) => stats.isDirectory(), () => false);
}

/**
 * @param {Terminal['output']} output
 * @param {ReturnType<typeof createColors>} colors
 * @param {{ options: import('../http/server.js').LanOptions, addresses: string[] }} lan
 * @param {number} port
 */
function writeLanLinks(output, colors, { options, addresses }, port) {
	if (addresses.length === 0) {
		output.write(colors.yellow('--lan: no address on the local network was found, so nothing else can reach the app.\n'));
		return;
	}
	output.write('Open one of these on another device on the same network (the token keeps others out):\n');
	for (const address of addresses) {
		const host = address.includes(':') ? `[${address}]` : address;
		output.write(`  http://${host}:${port}/?token=${options.token}\n`);
	}
}

/** @returns {string[]} the IPv4 addresses of this machine's network interfaces, without the loopback one */
function lanAddresses() {
	return Object.values(networkInterfaces())
		.flatMap((entries) => entries ?? [])
		.filter((entry) => entry.family === 'IPv4' && !entry.internal)
		.map((entry) => entry.address);
}
