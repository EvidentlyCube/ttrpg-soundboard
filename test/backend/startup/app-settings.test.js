import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppSettings, availableLanguages } from '../../../src/startup/app-settings.js';
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

describe('AppSettings', () => {
	it('has no language until one is set, creates its folder on the first write, and forgets it again', async () => {
		const root = await tree({});
		const file = join(root, 'config', 'soundboard', 'settings.json');
		const settings = new AppSettings(file);
		assert.equal(await settings.language(), null);
		await settings.setLanguage('pl');
		assert.equal(await settings.language(), 'pl');
		assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { language: 'pl' });
		await settings.setLanguage(null);
		assert.equal(await settings.language(), null);
		assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {});
	});

	it('keeps other settings it doesn’t know, and counts a broken file or a bad language as none', async () => {
		const root = await tree({ 'settings.json': JSON.stringify({ later: true, language: 'en' }) });
		const file = join(root, 'settings.json');
		const settings = new AppSettings(file);
		await settings.setLanguage('pl');
		assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { later: true, language: 'pl' });
		await writeFile(file, JSON.stringify({ language: '../evil' }));
		assert.equal(await settings.language(), null);
		await writeFile(file, '{ broken');
		assert.equal(await settings.language(), null);
		await writeFile(file, '[]');
		assert.equal(await settings.language(), null);
	});
});

describe('availableLanguages', () => {
	it('lists the language files by code, leaving out anything else', async () => {
		const root = await tree({ app: { i18n: { 'pl.js': '', 'en.js': '', 'pt-BR.js': '', 'notes.txt': '', 'Bad Name.js': '' } } });
		assert.deepEqual(await availableLanguages(root), ['en', 'pl', 'pt-BR']);
	});

	it('finds the app’s own English and Polish', async () => {
		assert.deepEqual(await availableLanguages(new URL('../../../public', import.meta.url).pathname), ['en', 'pl']);
	});
});
