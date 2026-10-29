import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FIXTURES_DIR = join(import.meta.dirname, '..', '..', 'test_fixtures');

/**
 * @typedef {{ [name: string]: string | Uint8Array | TreeSpec }} TreeSpec
 * @typedef {{ root: string, remove: () => Promise<void> }} TmpDir
 */

/**
 * Creates a directory tree in a fresh temp directory. Strings and byte arrays become files, objects become directories.
 * @param {TreeSpec} spec
 * @returns {Promise<TmpDir>}
 */
export async function createTmpTree(spec) {
	const tmp = await createTmpDir();
	await writeTree(tmp.root, spec);
	return tmp;
}

/**
 * Copies `test_fixtures/<name>` into a fresh temp directory, so tests can let the app write into it.
 * @param {string} name
 * @returns {Promise<TmpDir>}
 */
export async function copyFixture(name) {
	const tmp = await createTmpDir();
	await cp(join(FIXTURES_DIR, name), tmp.root, { recursive: true });
	return tmp;
}

/** @returns {Promise<TmpDir>} */
async function createTmpDir() {
	const root = await mkdtemp(join(tmpdir(), 'soundboard-test-'));
	return {
		root,
		remove: () => rm(root, { recursive: true, force: true }),
	};
}

/**
 * Writes a tree into a directory, which may already hold files.
 * @param {string} dir
 * @param {TreeSpec} spec
 */
export async function writeTree(dir, spec) {
	for (const [name, content] of Object.entries(spec)) {
		const path = join(dir, name);
		if (typeof content === 'string' || content instanceof Uint8Array) {
			await writeFile(path, content);
		} else {
			await mkdir(path);
			await writeTree(path, content);
		}
	}
}
