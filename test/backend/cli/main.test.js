import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { main } from '../../../src/cli/main.js';
import { USAGE } from '../../../src/cli/args.js';
import { findFreePort } from '../../helpers/http-client.js';
import { buildId3v2, textFrame } from '../../helpers/tag-builders.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/** @param {import('../../helpers/tmp-tree.js').TreeSpec} spec */
async function tree(spec) {
	const created = await createTmpTree(spec);
	trees.push(created);
	return created.root;
}

/**
 * @param {string[]} argv
 * @param {object} [options]
 * @param {string} [options.typed] what the user types in answer to questions
 * @param {(output: () => string) => Promise<void>} [options.whileRunning] runs once the server is up; shutdown follows
 */
async function run(argv, { typed = '', whileRunning = async () => {} } = {}) {
	const input = new PassThrough();
	input.end(typed);
	let output = '';
	let errorOutput = '';
	const code = await main(argv, {
		input,
		output: { write: (chunk) => (output += chunk, true) },
		errorOutput: { write: (chunk) => (errorOutput += chunk, true) },
		env: {},
		waitForShutdown: () => whileRunning(() => output),
	});
	return { code, output, errorOutput };
}

describe('main', () => {
	it('prints usage and fails on bad arguments', async () => {
		const result = await run([]);
		assert.equal(result.code, 1);
		assert.equal(result.errorOutput, `Missing the audio directory.\n\n${USAGE}\n`);
	});

	it('fails when the directory does not exist or is a file', async () => {
		const root = await tree({ 'file.mp3': '' });
		for (const path of [join(root, 'missing'), join(root, 'file.mp3')]) {
			const result = await run([path]);
			assert.equal(result.code, 1);
			assert.equal(result.errorOutput, `Not a directory: ${path}\n\n${USAGE}\n`);
		}
	});

	it('serves the library until shutdown', async () => {
		const root = await tree({ 'a.mp3': '', 'Combat': { '1.mp3': '' } });
		const port = await findFreePort();
		const result = await run([root, '--port', String(port)], {
			whileRunning: async (output) => {
				assert.match(output(), new RegExp(`Soundboard running at http://127\\.0\\.0\\.1:${port}\\n`));
				const library = /** @type {{ sounds: { id: string }[] }} */ (await (await fetch(`http://127.0.0.1:${port}/api/library`)).json());
				assert.deepEqual(library.sounds.map((sound) => sound.id), ['a.mp3']);
			},
		});
		assert.equal(result.code, 0);
		assert.match(result.output, /Loaded 1 playlist and 1 sound\./);
		assert.match(result.output, /Stopped\.\n$/);
		await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
	});

	it('logs requests only with --verbose', async () => {
		const root = await tree({ 'a.mp3': '' });
		for (const verbose of [false, true]) {
			const port = await findFreePort();
			const result = await run([root, '--port', String(port), ...(verbose ? ['--verbose'] : [])], {
				whileRunning: async () => {
					await (await fetch(`http://127.0.0.1:${port}/api/library`)).json();
					await new Promise((resolve) => setTimeout(resolve, 50));
				},
			});
			assert.equal(/GET \/api\/library 200 \d+ms/.test(result.output), verbose, `verbose: ${verbose}`);
		}
	});

	it('fails with a clear message when the port is in use', async () => {
		const root = await tree({ 'a.mp3': '' });
		const blocker = createServer();
		await new Promise((resolve) => blocker.listen(0, '127.0.0.1', () => resolve(undefined)));
		const address = blocker.address();
		const port = typeof address === 'object' && address !== null ? address.port : 0;
		try {
			const result = await run([root, '--port', String(port)]);
			assert.equal(result.code, 1);
			assert.equal(result.errorOutput, `Port ${port} is already in use. Stop the program using it, or choose another port with --port.\n`);
		} finally {
			blocker.close();
		}
	});

	it('exits with 0 when the user declines to continue', async () => {
		const root = await tree({ Combat: { Boss: { '1.mp3': '' } } });
		const result = await run([root], { typed: 'n\n' });
		assert.equal(result.code, 0);
		assert.match(result.output, /Continue\? \[y\/N\] /);
		assert.doesNotMatch(result.output, /Loaded|running/);
	});

	it('reads answers typed ahead for later questions', async () => {
		const root = await tree({
			Combat: { Boss: { '1.mp3': buildId3v2({ frames: [textFrame('TIT2', 'Tagged')] }) } },
		});
		const result = await run([root, '--port', String(await findFreePort())], { typed: 'y\ny\n' });
		assert.equal(result.code, 0);
		assert.deepEqual(JSON.parse(await readFile(join(root, 'Combat', 'Boss', '1.mp3.json'), 'utf8')), { title: 'Tagged' });
	});

	it('exits with 1 when options files are invalid', async () => {
		const root = await tree({ 'a.mp3': '', 'a.mp3.json': '{' });
		const result = await run([root]);
		assert.equal(result.code, 1);
		assert.match(result.output, /Found 1 invalid file/);
	});
});
