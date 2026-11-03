import { homedir, hostname, networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { runProcess } from '../downloads/process-runner.js';
import { describeTools, findTools, missingTools } from '../downloads/tools.js';
import { clearWorkspace } from '../downloads/workspace.js';
import { describeUpdate, updateYtDlp } from '../downloads/yt-dlp-update.js';
import { AccessControl } from '../http/access-control.js';
import { PORT_ATTEMPTS, startApp } from '../http/app-server.js';
import { appVersion, createBoard } from '../http/server.js';
import { BootstrapService } from '../library/bootstrap-service.js';
import { ChangeWatcher } from '../library/change-watcher.js';
import { configFolder, RecentFolders } from '../startup/recent-folders.js';
import { StartupSession } from '../startup/startup-session.js';
import { parseArguments, USAGE, UsageError } from './args.js';
import { createColors, shouldUseColor } from './colors.js';
import { openInBrowser } from './open-browser.js';

/**
 * @typedef {object} Terminal
 * @property {NodeJS.ReadableStream} input
 * @property {{ write: (chunk: string) => unknown, isTTY?: boolean }} output
 * @property {{ write: (chunk: string) => unknown }} errorOutput
 * @property {Record<string, string | undefined>} env
 * @property {() => Promise<void>} waitForShutdown resolves when the server should stop, e.g. on SIGINT
 * @property {import('../downloads/process-runner.js').ProcessRunner} [run] starts yt-dlp and ffmpeg; tests pass a fake
 * @property {() => string[]} [networkAddresses] this machine's addresses on the local network, for `--lan`; tests pass a fixed list
 * @property {(url: string) => void} [openBrowser] tests pass one that opens nothing
 * @property {import('../startup/folder-rules.js').Platform} [platform] tests pass a home folder of their own
 * @property {string} [configDirectory] where `recent.json` goes; tests pass a temporary folder
 */

/**
 * Runs the app from the command line and resolves with the process exit code once the server has stopped. Choosing
 * and loading a soundboard happen in the browser (DESIGN.md §3); the terminal only reports.
 * @param {string[]} argv arguments after the script name
 * @param {Terminal} terminal
 * @returns {Promise<number>}
 */
export async function main(argv, {
	input,
	output,
	errorOutput,
	env,
	waitForShutdown,
	run = runProcess,
	networkAddresses = lanAddresses,
	openBrowser = openInBrowser,
	platform = { name: process.platform, home: homedir(), systemDrive: env.SystemDrive },
	configDirectory = configFolder(platform, env),
}) {
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

	const colors = createColors(shouldUseColor(output, env));
	/** @param {string} text @param {boolean} [warning] */
	const say = (text, warning = false) => output.write(`${warning ? colors.yellow(text) : text}\n`);
	/** @param {unknown} error */
	const logError = (error) => errorOutput.write(`${error instanceof Error ? error.stack : String(error)}\n`);

	/** @type {import('../http/router.js').AppInfo} */
	const info = { app: await appVersion(), checking: true, tools: { ytDlp: null, ffmpeg: null }, update: null };
	// Runs while a folder is chosen; the Initializer waits for it before opening the soundboard (DESIGN.md §3.4).
	const toolsReady = prepareDownloads(run, say).then((downloads) => {
		info.tools = downloads.tools;
		info.update = downloads.update;
		return downloads;
	}).finally(() => {
		info.checking = false;
	});

	const accessControl = new AccessControl();
	/** @type {{ options: import('../http/server.js').LanOptions, addresses: string[] } | undefined} */
	let lan;
	if (args.lan) {
		const addresses = args.lan.address ? [args.lan.address] : networkAddresses();
		lan = {
			addresses,
			options: {
				address: args.lan.address ?? '0.0.0.0',
				addresses,
				names: [...addresses, ...(args.lan.address ? [] : [hostname(), `${hostname()}.local`])].map((name) => (name.includes(':') ? `[${name}]` : name)),
			},
		};
		// A page that is open shows the request too; this is for when none is.
		accessControl.onRequest(({ address, code }) => say(`Connection request from ${address}, code ${code}`));
	}

	/** @type {{ port: number, url: string, close: () => Promise<void> } | undefined} */
	let app;
	/** @type {import('../startup/startup-session.js').Opener} */
	const open = async (root, { prompter, reporter }) => {
		const watcher = new ChangeWatcher({ root, log: (message) => say(message) });
		const bootstrap = new BootstrapService({ prompter, reporter, updateSettingsFile: watcher.updateFile });
		const outcome = await bootstrap.run(root);
		if (outcome.status !== 'ready') {
			return outcome;
		}
		const start = async () => {
			try {
				await clearWorkspace(root);
				await watcher.start(outcome.scan);
				const board = await createBoard({
					library: outcome.library,
					settings: outcome.settings,
					problems: outcome.problems,
					port: /** @type {NonNullable<typeof app>} */ (app).port,
					logError,
					watcher,
					downloads: await toolsReady,
					lan: lan?.options,
					accessControl,
					info,
					refresh: () => watcher.refresh(() => {
						say('Refreshing after external changes…');
						return bootstrap.refresh(root);
					}),
				});
				const { playlists, sounds } = outcome.library;
				say(`Opened ${root}: ${count(playlists.length, 'playlist')} and ${count(sounds.length, 'sound')}.`);
				return {
					handle: board.handle,
					close: async () => {
						await board.close();
						watcher.stop();
						say(`Closed ${root}.`);
					},
				};
			} catch (error) {
				watcher.stop();
				throw error;
			}
		};
		return { status: 'ready', start };
	};
	const session = new StartupSession({
		paths: args.directories.length > 0 ? args.directories.map((directory) => resolve(directory)) : null,
		recent: new RecentFolders(join(configDirectory, 'recent.json')),
		platform,
		open,
		toolsReady,
		logError,
	});

	try {
		app = await startApp({
			session,
			port: args.port,
			platform,
			info,
			lan: lan?.options,
			logError,
			logRequest: args.verbose ? (line) => say(line) : undefined,
		});
	} catch (error) {
		const message = listenErrorMessage(/** @type {NodeJS.ErrnoException} */ (error), args.port);
		if (message === null) {
			throw error;
		}
		errorOutput.write(`${message}\n`);
		return 1;
	}

	if (app.port !== args.port) {
		say(`Port ${args.port} is in use, so the app uses port ${app.port}.`, true);
	}
	say(`Soundboard running at ${app.url}`);
	if (lan) {
		writeLanLinks(output, colors, lan.addresses, app.port);
	}
	if (args.open) {
		openBrowser(app.url);
	}
	say('Press Ctrl+C or type exit and press Enter to stop.');
	const exitTyped = waitForExitCommand(input);
	await Promise.race([waitForShutdown(), exitTyped.promise]);
	exitTyped.stop();
	await session.shutdown();
	await app.close();
	say('Stopped.');
	return 0;
}

/**
 * Looks for the download tools and updates yt-dlp, printing what it found. Never rejects.
 * @param {import('../downloads/process-runner.js').ProcessRunner} run
 * @param {(text: string, warning?: boolean) => void} say
 * @returns {Promise<import('../http/server.js').DownloadPorts & { update: import('../downloads/yt-dlp-update.js').YtDlpUpdate | null }>}
 */
async function prepareDownloads(run, say) {
	let tools = await findTools(run);
	say(describeTools(tools), missingTools(tools).length > 0);
	if (tools.ytDlp === null) {
		return { tools, update: null, run };
	}
	say('Checking for a yt-dlp update…');
	const update = await updateYtDlp(run);
	const line = describeUpdate(update);
	say(line.text, line.warning);
	if (update.state === 'updated') {
		tools = await findTools(run);
	}
	return { tools, update, run };
}

/**
 * Resolves when a line reading "exit" is typed. Closed input does not count: the app may be run with stdin detached.
 * `stop()` must be called afterwards so stdin no longer keeps the process alive.
 * @param {NodeJS.ReadableStream} input
 * @returns {{ promise: Promise<void>, stop: () => void }}
 */
function waitForExitCommand(input) {
	// No output stream: the terminal does the echoing.
	const lines = createInterface({ input });
	const promise = new Promise((resolve) => {
		lines.on('line', (line) => {
			if (line.trim().toLowerCase() === 'exit') {
				resolve(undefined);
			}
		});
	});
	return { promise, stop: () => lines.close() };
}

/**
 * @param {NodeJS.ErrnoException} error
 * @param {number} port
 * @returns {string | null} null for errors that are bugs rather than environment problems
 */
function listenErrorMessage(error, port) {
	switch (error.code) {
		case 'EADDRINUSE':
			return `Ports ${port} to ${port + PORT_ATTEMPTS - 1} are all in use. Choose another port with --port.`;
		case 'EACCES':
			return `Not allowed to use port ${port}. Choose a port above 1023 with --port.`;
		default:
			return null;
	}
}

/**
 * @param {Terminal['output']} output
 * @param {ReturnType<typeof createColors>} colors
 * @param {string[]} addresses
 * @param {number} port
 */
function writeLanLinks(output, colors, addresses, port) {
	if (addresses.length === 0) {
		output.write(colors.yellow('--lan: no address on the local network was found, so nothing else can reach the app.\n'));
		return;
	}
	output.write('Once a soundboard is open, open one of these on another device on the same network, then allow it in the app:\n');
	for (const address of addresses) {
		const host = address.includes(':') ? `[${address}]` : address;
		output.write(`  http://${host}:${port}/\n`);
	}
}

/**
 * @param {number} amount
 * @param {string} noun singular form; the plural adds "s"
 */
function count(amount, noun) {
	return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

/** Docker, bridges and virtual machines: addresses no phone can reach. */
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vboxnet|vmnet)/;

/** @returns {string[]} the IPv4 addresses of this machine's network interfaces, without the loopback and virtual ones */
function lanAddresses() {
	return Object.entries(networkInterfaces())
		.filter(([name]) => !VIRTUAL_INTERFACE.test(name))
		.flatMap(([, entries]) => entries ?? [])
		.filter((entry) => entry.family === 'IPv4' && !entry.internal)
		.map((entry) => entry.address);
}
