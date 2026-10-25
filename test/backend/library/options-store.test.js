import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ValidationError } from '../../../src/library/errors.js';
import { readValidatedJson, updateJsonFile, writeJsonAtomic } from '../../../src/library/options-store.js';
import { validateAudioOptions } from '../../../src/library/validate.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';

/** @type {import('../../helpers/tmp-tree.js').TmpDir} */
let tree;
beforeEach(async () => {
	tree = await createTmpTree({
		'valid.json': '{ "title": "Boom" }',
		'broken.json': '{ "title": ',
		'wrong.json': '{ "title": 3 }',
	});
});
afterEach(() => tree.remove());

describe('readValidatedJson', () => {
	it('returns the parsed value', async () => {
		assert.deepEqual(await readValidatedJson(join(tree.root, 'valid.json'), validateAudioOptions), { title: 'Boom' });
	});

	it('throws a ValidationError naming the file when the JSON does not parse', async () => {
		const path = join(tree.root, 'broken.json');
		await assert.rejects(readValidatedJson(path, validateAudioOptions), (error) => {
			assert.ok(error instanceof ValidationError);
			assert.equal(error.filePath, path);
			assert.equal(error.problems.length, 1);
			assert.match(error.problems[0], /^invalid JSON: /);
			return true;
		});
	});

	it('throws a ValidationError listing the validator problems', async () => {
		const path = join(tree.root, 'wrong.json');
		await assert.rejects(readValidatedJson(path, validateAudioOptions), {
			name: 'ValidationError',
			filePath: path,
			problems: ['"title" must be a non-empty string'],
			message: `${path}: "title" must be a non-empty string`,
		});
	});

	it('lets file system errors through', async () => {
		await assert.rejects(readValidatedJson(join(tree.root, 'missing.json'), validateAudioOptions), { code: 'ENOENT' });
	});
});

describe('writeJsonAtomic', () => {
	it('writes tab-indented JSON with a trailing newline and leaves no temp file', async () => {
		const path = join(tree.root, 'new.json');
		await writeJsonAtomic(path, { title: 'New', list: [1] });
		assert.equal(await readFile(path, 'utf8'), '{\n\t"title": "New",\n\t"list": [\n\t\t1\n\t]\n}\n');
		assert.deepEqual((await readdir(tree.root)).filter((name) => name.endsWith('.tmp')), []);
	});

	it('replaces an existing file', async () => {
		const path = join(tree.root, 'valid.json');
		await writeJsonAtomic(path, { title: 'Replaced' });
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { title: 'Replaced' });
	});
});

describe('updateJsonFile', () => {
	it('merges into the current content and keeps unknown keys', async () => {
		const path = join(tree.root, 'playlist.json');
		await writeFile(path, '{ "title": "Combat", "futureKey": { "a": 1 } }');
		await updateJsonFile(path, (current) => ({ ...current, includedSubdirectories: ['Boss'] }));
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
			title: 'Combat',
			futureKey: { a: 1 },
			includedSubdirectories: ['Boss'],
		});
	});

	it('starts from an empty object when the file does not exist', async () => {
		const path = join(tree.root, 'fresh.json');
		await updateJsonFile(path, (current) => ({ ...current, title: 'Fresh' }));
		assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { title: 'Fresh' });
	});
});
