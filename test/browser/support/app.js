import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { main } from '../../../src/cli/main.js';
import { fakeProcessRunner } from '../../helpers/fake-process-runner.js';
import { findFreePort } from '../../helpers/http-client.js';
import { FIXTURES_DIR } from '../../helpers/tmp-tree.js';

/**
 * Runs the whole app as `node index.js` would, starting in the Selector (DESIGN.md §3), over a temporary home folder
 * that holds a copy of the example soundboard as `Board`. yt-dlp and ffmpeg are missing, so nothing waits for them.
 * @param {string[]} [args] more command-line arguments; `<home>` in one stands for the home folder
 * @returns {Promise<{ url: string, home: string, board: string, output: () => string, stop: () => Promise<void> }>}
 */
export async function startApp(args = []) {
	const home = await realpath(await mkdtemp(join(tmpdir(), 'soundboard-home-')));
	const board = join(home, 'Board');
	await cp(join(FIXTURES_DIR, 'example_soundboard'), board, { recursive: true });
	/** @type {() => void} */
	let shutDown = () => {};
	const shutdown = new Promise((resolve) => {
		shutDown = () => resolve(undefined);
	});
	let output = '';
	const port = await findFreePort();
	const running = main(['--no-open', `--port=${port}`, ...args.map((arg) => arg.replace('<home>', home))], {
		input: new PassThrough(),
		output: { write: (chunk) => (output += chunk, true) },
		errorOutput: { write: (chunk) => (output += chunk, true) },
		env: {},
		waitForShutdown: () => shutdown,
		run: fakeProcessRunner(() => 'missing').run,
		openBrowser: () => {},
		system: { name: process.platform, home },
		configDirectory: join(home, '.config', 'soundboard'),
	});
	const deadline = Date.now() + 10_000;
	while (!output.includes('Soundboard running at')) {
		if (Date.now() > deadline) {
			throw new Error(`The app did not start:\n${output}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return {
		url: `http://localhost:${port}`,
		home,
		board,
		output: () => output,
		async stop() {
			shutDown();
			await running;
			await rm(home, { recursive: true, force: true });
		},
	};
}
