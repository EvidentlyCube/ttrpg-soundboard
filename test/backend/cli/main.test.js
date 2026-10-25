import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { main } from '../../../src/cli/main.js';
import { USAGE } from '../../../src/cli/args.js';
import { buildId3v2, textFrame } from '../../helpers/tag-builders.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir[]} */
const trees = [];
afterEach(async () => {
	await Promise.all(trees.splice(0).map((tree) => tree.remove()));
});

/**
 * @param {string[]} argv
 * @param {string} [typed] what the user types in answer to questions
 */
async function run(argv, typed = '') {
	const input = new PassThrough();
	input.end(typed);
	let output = '';
	let errorOutput = '';
	const code = await main(argv, {
		input,
		output: { write: (chunk) => (output += chunk, true) },
		errorOutput: { write: (chunk) => (errorOutput += chunk, true) },
		env: {},
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
		const tree = await createTmpTree({ 'file.mp3': '' });
		trees.push(tree);
		for (const path of [join(tree.root, 'missing'), join(tree.root, 'file.mp3')]) {
			const result = await run([path]);
			assert.equal(result.code, 1);
			assert.equal(result.errorOutput, `Not a directory: ${path}\n\n${USAGE}\n`);
		}
	});

	it('bootstraps the directory and reports the library', async () => {
		const tree = await createTmpTree({ 'a.mp3': '', 'Combat': { '1.mp3': '' } });
		trees.push(tree);
		const result = await run([tree.root]);
		assert.equal(result.code, 0);
		assert.match(result.output, /Loaded 1 playlist and 1 sound\./);
	});

	it('exits with 0 when the user declines to continue', async () => {
		const tree = await createTmpTree({ Combat: { Boss: { '1.mp3': '' } } });
		trees.push(tree);
		const result = await run([tree.root], 'n\n');
		assert.equal(result.code, 0);
		assert.match(result.output, /Continue\? \[y\/N\] /);
		assert.doesNotMatch(result.output, /Loaded/);
	});

	it('reads answers typed ahead for later questions', async () => {
		const tree = await createTmpTree({
			Combat: { Boss: { '1.mp3': buildId3v2({ frames: [textFrame('TIT2', 'Tagged')] }) } },
		});
		trees.push(tree);
		const result = await run([tree.root], 'y\ny\n');
		assert.equal(result.code, 0);
		assert.deepEqual(JSON.parse(await readFile(join(tree.root, 'Combat', 'Boss', '1.mp3.json'), 'utf8')), { title: 'Tagged' });
	});

	it('exits with 1 when options files are invalid', async () => {
		const tree = await createTmpTree({ 'a.mp3': '', 'a.mp3.json': '{' });
		trees.push(tree);
		const result = await run([tree.root]);
		assert.equal(result.code, 1);
		assert.match(result.output, /Found 1 invalid file/);
	});
});
