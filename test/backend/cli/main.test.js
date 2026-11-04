import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { main } from '../../../src/cli/main.js';
import { HELP, USAGE } from '../../../src/cli/args.js';
import { fakeProcessRunner } from '../../helpers/fake-process-runner.js';
import { findFreePort } from '../../helpers/http-client.js';
import { copyFixture, createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/**
 * A home folder holding a copy of the example soundboard, and a folder for the app's own files.
 * @returns {Promise<{ home: string, music: string, config: string }>}
 */
async function homeWithMusic() {
	const home = await copyFixture('example_soundboard');
	trees.push(home);
	const config = await createTmpTree({});
	trees.push(config);
	return { home: await realpath(home.root), music: await realpath(home.root), config: config.root };
}

/** @type {import('../../helpers/fake-process-runner.js').FakeProgram} */
function installedTools(command) {
	return { stdout: command === 'yt-dlp' ? '2026.08.19\n' : 'ffmpeg version 7.1.1 Copyright (c) 2000-2025\n' };
}

/**
 * Runs `main` with a fake terminal until `whileRunning` is done, then stops it as Ctrl+C would.
 * @param {string[]} argv
 * @param {object} options
 * @param {string} options.home
 * @param {string} options.config
 * @param {(app: { url: () => string, output: () => string }) => Promise<void>} [options.whileRunning]
 * @param {string} [options.typed] typed once the server is up instead; the signal never comes
 * @param {import('../../helpers/fake-process-runner.js').FakeProgram} [options.tools]
 */
async function run(argv, { home, config, whileRunning = async () => {}, typed, tools = installedTools }) {
	const input = new PassThrough();
	let output = '';
	let errorOutput = '';
	/** @type {string[]} */
	const opened = [];
	const url = () => /TTRPG Soundboard running at (\S+)/.exec(output)?.[1] ?? assert.fail('No address printed');
	const code = await main(argv, {
		input,
		output: { write: (chunk) => (output += chunk, true) },
		errorOutput: { write: (chunk) => (errorOutput += chunk, true) },
		env: {},
		waitForShutdown: () => {
			if (typed !== undefined) {
				setTimeout(() => input.write(typed), 20);
				return new Promise(() => {});
			}
			return whileRunning({ url, output: () => output });
		},
		run: fakeProcessRunner(tools).run,
		openBrowser: (address) => opened.push(address),
		system: { name: 'linux', home },
		configDirectory: config,
	});
	return { code, output, errorOutput, opened };
}

/**
 * @param {string} url
 * @param {string} [method]
 * @param {unknown} [body]
 * @returns {Promise<any>}
 */
async function call(url, method = 'GET', body = undefined) {
	const response = await fetch(url, {
		method,
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return response.status === 204 ? response.status : response.json();
}

/**
 * Polls the startup state until it satisfies `condition`.
 * @param {string} url
 * @param {(state: any) => boolean} condition
 */
async function waitForState(url, condition) {
	const deadline = Date.now() + 10_000;
	for (;;) {
		const state = await call(`${url}/api/startup`);
		if (condition(state)) {
			return state;
		}
		assert.ok(Date.now() < deadline, `Timed out; last state: ${JSON.stringify(state)}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

describe('main', () => {
	it('prints the help and stops at once', async () => {
		const { home, config } = await homeWithMusic();
		for (const flag of ['--help', '-h']) {
			const result = await run([flag], { home, config, whileRunning: async () => assert.fail('started') });
			assert.equal(result.code, 0);
			assert.equal(result.output, `${HELP}\n`);
		}
	});

	it('prints the usage and a hint about --help for bad arguments', async () => {
		const { home, config } = await homeWithMusic();
		const result = await run(['--port=0'], { home, config });
		assert.equal(result.code, 1);
		assert.equal(result.errorOutput, `Invalid port: "0". Use a number from 1 to 65535.\n\n${USAGE}\nRun with --help to see what each option does.\n`);
	});

	it('starts in the Selector, opens the browser on localhost and stops when exit is typed', async () => {
		const { home, config } = await homeWithMusic();
		const port = await findFreePort();
		const result = await run([`--port=${port}`], { home, config, typed: 'exit\n' });
		assert.equal(result.code, 0);
		assert.deepEqual(result.opened, [`http://localhost:${port}`]);
		assert.match(result.output, new RegExp(`Folders the app may open: ${home}\n`));
		assert.match(result.output, new RegExp(`TTRPG Soundboard running at http://localhost:${port}\n`));
		assert.match(result.output, /Press Ctrl\+C or type exit and press Enter to stop\.\n/);
		assert.match(result.output, /Stopped\.\n$/);
	});

	it('doesn’t open the browser with --no-open', async () => {
		const { home, config } = await homeWithMusic();
		const result = await run(['--no-open', `--port=${await findFreePort()}`], { home, config });
		assert.deepEqual(result.opened, []);
	});

	it('uses the next port when the first is taken, and says so', async () => {
		const { home, config } = await homeWithMusic();
		const port = await findFreePort();
		const blocker = createServer();
		await new Promise((resolve) => blocker.listen(port, '127.0.0.1', () => resolve(undefined)));
		try {
			const result = await run([`--port=${port}`, '--no-open'], { home, config });
			assert.match(result.output, new RegExp(`Port ${port} is in use, so the app uses port ${port + 1}\\.`));
			assert.match(result.output, new RegExp(`TTRPG Soundboard running at http://localhost:${port + 1}\n`));
		} finally {
			await new Promise((resolve) => blocker.close(() => resolve(undefined)));
		}
	});

	it('takes the allowed folders from --whitelisted-root, with %home%, and leaves out ones that don’t exist', async () => {
		const { home, config } = await homeWithMusic();
		const other = await createTmpTree({});
		trees.push(other);
		const result = await run([
			'--no-open',
			`--port=${await findFreePort()}`,
			'--whitelisted-root', '%HOME%/Music MP3',
			'--whitelisted-root', join(other.root, 'missing'),
		], {
			home,
			config,
			whileRunning: async ({ url }) => {
				assert.deepEqual((await call(`${url()}/api/startup/folders`)).places, [{ name: 'Music MP3', path: join(home, 'Music MP3') }]);
			},
		});
		assert.match(result.output, /--whitelisted-root: .*missing doesn’t exist, so it is left out\./);
		assert.match(result.output, new RegExp(`Folders the app may open: ${join(home, 'Music MP3')}\n`));
	});

	it('warns about --UNSAFE-lan-manager', async () => {
		const { home, config } = await homeWithMusic();
		const result = await run(['--no-open', '--UNSAFE-lan-manager', `--port=${await findFreePort()}`], { home, config });
		assert.match(result.output, /--UNSAFE-lan-manager: until a soundboard is open, any device on the network can browse/);
	});

	it('reports the download tools, or that they are missing', async () => {
		const { home, config } = await homeWithMusic();
		const found = await run(['--no-open', `--port=${await findFreePort()}`], {
			home,
			config,
			whileRunning: async ({ url }) => {
				const info = await (async () => {
					for (;;) {
						const answer = await call(`${url()}/api/info`);
						if (!answer.checking) {
							return answer;
						}
						await new Promise((resolve) => setTimeout(resolve, 10));
					}
				})();
				assert.equal(info.ffmpeg, '7.1.1');
			},
		});
		assert.match(found.output, /Downloads: yt-dlp 2026\.08\.19, ffmpeg 7\.1\.1/);
		const missing = await run(['--no-open', `--port=${await findFreePort()}`], {
			home,
			config,
			tools: () => 'missing',
			whileRunning: async ({ output }) => {
				while (!output().includes('Downloads are off')) {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			},
		});
		assert.match(missing.output, /Downloads are off: yt-dlp and ffmpeg were not found\./);
	});

	it('opens a folder given on the command line through the Initializer, remembers it, and closes it', async () => {
		const { home, config, music } = await homeWithMusic();
		const result = await run(['--no-open', `--port=${await findFreePort()}`, music], {
			home,
			config,
			whileRunning: async ({ url }) => {
				const selecting = await waitForState(url(), (state) => state.phase === 'selecting');
				// The home folder itself may not be opened, only what is inside it.
				assert.deepEqual(selecting.paths, [{ path: music, name: music.split('/').pop(), allowed: false, reason: 'Choose a folder inside this one.', reasonCode: 'folder.container' }]);
			},
		});
		assert.equal(result.code, 0);

		const inside = join(music, 'Music Mix');
		const opened = await run(['--no-open', `--port=${await findFreePort()}`, inside], {
			home,
			config,
			whileRunning: async ({ url, output }) => {
				assert.equal(await call(`${url()}/api/startup/select`, 'POST', { path: inside }), 204);
				const asking = await waitForState(url(), (state) => state.initializer?.step === 'question');
				assert.equal(asking.initializer.question.kind, 'metadataTitles');
				assert.equal(await call(`${url()}/api/startup/answer`, 'POST', { id: asking.initializer.question.id, yes: true }), 204);
				await waitForState(url(), (state) => state.phase === 'ready');
				const library = await call(`${url()}/api/library`);
				assert.ok(library.sounds.length > 0);
				assert.match(output(), new RegExp(`Opened ${inside}: 0 playlists and \\d+ sounds\\.`));
				assert.equal(await call(`${url()}/api/startup/close`, 'POST'), 204);
				assert.match(output(), new RegExp(`Closed ${inside}\\.`));
				assert.equal((await call(`${url()}/api/startup`)).phase, 'selecting');
			},
		});
		assert.equal(opened.code, 0);
		assert.deepEqual(JSON.parse(await readFile(join(config, 'recent.json'), 'utf8')), { recent: [inside] });
	});
});
