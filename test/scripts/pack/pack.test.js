import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PackError } from '../../../scripts/pack/errors.js';
import { pack } from '../../../scripts/pack/pack.js';
import { PLATFORMS } from '../../../scripts/pack/platforms.js';
import { createTmpTree } from '../../helpers/tmp-tree.js';
import { readZip } from '../../helpers/zip-reader.js';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const COMMIT_DATE = '2026-10-01T08:00:00Z';
const platform = (/** @type {string} */ name) => /** @type {import('../../../scripts/pack/platforms.js').Platform} */ (
	PLATFORMS.find((candidate) => candidate.name === name)
);
const fakeRuntimes = { runtimeFor: async () => ({ binary: Buffer.from('node'), license: Buffer.from('Node license') }) };

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

/** A repository with the app's paths, a file outside them and the real launcher templates, all committed. */
async function repository() {
	/** @type {Record<string, string>} */
	const packaging = {};
	for (const name of await readdir(join(ROOT, 'packaging'))) {
		packaging[name] = await readFile(join(ROOT, 'packaging', name), 'utf8');
	}
	const root = await tree({
		'index.js': 'index',
		'package.json': JSON.stringify({ version: '1.2.3' }),
		'LICENSE': 'Unlicense',
		'src': { 'main.js': 'main' },
		'public': { 'index.html': 'page' },
		'test': { 'main.test.js': 'test' },
		packaging,
	});
	const git = (/** @type {string[]} */ ...args) => run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
		cwd: root,
		env: { ...process.env, GIT_AUTHOR_DATE: COMMIT_DATE, GIT_COMMITTER_DATE: COMMIT_DATE },
	});
	await git('init', '-q');
	await git('add', '.');
	await git('commit', '-q', '-m', 'Initial');
	return root;
}

describe('pack', () => {
	it('writes one zip per platform with the committed app files, dated by the commit', async () => {
		const root = await repository();
		const output = join(root, 'dist');

		const written = await pack({
			root,
			output,
			platforms: [platform('linux-x64'), platform('windows-x64')],
			nodeVersion: '24.0.0',
			runtimes: fakeRuntimes,
			allowDirty: false,
		});

		assert.deepEqual(written.map(({ file }) => file), [
			join(output, 'ttrpg-soundboard-1.2.3-linux-x64.zip'),
			join(output, 'ttrpg-soundboard-1.2.3-windows-x64.zip'),
		]);
		const files = readZip(await readFile(written[0].file));
		assert.deepEqual(files.map(({ path }) => path), [
			'ttrpg-soundboard-1.2.3-linux-x64/start-soundboard.sh',
			'ttrpg-soundboard-1.2.3-linux-x64/README.txt',
			'ttrpg-soundboard-1.2.3-linux-x64/app/LICENSE',
			'ttrpg-soundboard-1.2.3-linux-x64/app/index.js',
			'ttrpg-soundboard-1.2.3-linux-x64/app/package.json',
			'ttrpg-soundboard-1.2.3-linux-x64/app/public/index.html',
			'ttrpg-soundboard-1.2.3-linux-x64/app/src/main.js',
			'ttrpg-soundboard-1.2.3-linux-x64/runtime/node',
			'ttrpg-soundboard-1.2.3-linux-x64/runtime/LICENSE',
		]);
		assert.ok(files.every(({ date }) => date.toISOString() === '2026-10-01T08:00:00.000Z'));
		assert.match(files[1].data.toString('utf8'), /Version 1\.2\.3\./);
	});

	it('refuses uncommitted changes to the app’s files and names them', async () => {
		const root = await repository();
		await writeFile(join(root, 'src', 'main.js'), 'changed');
		await writeFile(join(root, 'src', 'stray.js'), 'not added');
		await writeFile(join(root, 'test', 'main.test.js'), 'changes outside the app do not count');
		const options = { root, output: join(root, 'dist'), platforms: [platform('linux-x64')], nodeVersion: '24.0.0', runtimes: fakeRuntimes };

		await assert.rejects(pack({ ...options, allowDirty: false }), (error) => {
			assert.ok(error instanceof PackError);
			assert.match(error.message, / M src\/main\.js\n\?\? src\/stray\.js\n/);
			assert.doesNotMatch(error.message, /test/);
			return true;
		});
		assert.ok(!(await readdir(root)).includes('dist'));
	});

	it('packs the files as they are with allowDirty, still leaving out untracked ones', async () => {
		const root = await repository();
		await writeFile(join(root, 'src', 'main.js'), 'changed');
		await writeFile(join(root, 'src', 'stray.js'), 'not added');

		const [{ file }] = await pack({
			root,
			output: join(root, 'dist'),
			platforms: [platform('linux-x64')],
			nodeVersion: '24.0.0',
			runtimes: fakeRuntimes,
			allowDirty: true,
		});

		const app = readZip(await readFile(file)).filter(({ path }) => path.includes('/app/src/'));
		assert.deepEqual(app.map(({ path, data }) => [path, data.toString('utf8')]), [['ttrpg-soundboard-1.2.3-linux-x64/app/src/main.js', 'changed']]);
	});

	it('gives a package that starts the app through its launcher', { skip: process.platform === 'win32' && 'the launcher is a shell script' }, async () => {
		const output = await tree({});
		// The real app with the Node that runs this test, packed for this system.
		const runtimes = { runtimeFor: async () => ({ binary: await readFile(process.execPath), license: Buffer.from('Node license') }) };
		const [{ file }] = await pack({
			root: ROOT,
			output,
			platforms: [platform(process.platform === 'darwin' ? 'macos-arm64' : 'linux-x64')],
			nodeVersion: process.versions.node,
			runtimes,
			allowDirty: true,
		});
		const unpacked = join(output, 'unpacked');
		for (const { path, data, mode } of readZip(await readFile(file))) {
			const target = join(unpacked, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, data);
			await chmod(target, mode & 0o777);
		}
		const [top] = await readdir(unpacked);
		const launcher = (await readdir(join(unpacked, top))).find((name) => name.startsWith('start') || name.endsWith('.command'));

		const { stdout } = await run(join(unpacked, top, /** @type {string} */ (launcher)), ['--help'], { cwd: output });

		assert.match(stdout, /^Usage: node index\.js/);
	});
});
