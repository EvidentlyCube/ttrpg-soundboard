import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PackError } from './errors.js';
import { commitDate, trackedFiles, uncommittedChanges } from './git-files.js';
import { APP_PATHS, packageEntries, packageName } from './package-layout.js';
import { createZip } from './zip.js';

/** @typedef {import('./platforms.js').Platform} Platform */
/** @typedef {{ runtimeFor: (platform: Platform) => Promise<import('./node-runtime.js').Runtime> }} Runtimes */

const TEMPLATES = Object.freeze(['start.sh', 'start.cmd', 'README-windows.txt', 'README-macos.txt', 'README-linux.txt']);

/**
 * Writes one zip per platform into `output` (DESIGN.md §13).
 * @param {object} options
 * @param {string} options.root the repository
 * @param {string} options.output
 * @param {Platform[]} options.platforms
 * @param {string} options.nodeVersion
 * @param {Runtimes} options.runtimes
 * @param {boolean} options.allowDirty pack even when the app's files have uncommitted changes
 * @returns {Promise<{ file: string, size: number }[]>} the zips written
 */
export async function pack({ root, output, platforms, nodeVersion, runtimes, allowDirty }) {
	const changes = await uncommittedChanges(root, APP_PATHS);
	if (changes.length > 0 && !allowDirty) {
		throw new PackError(
			`These files have uncommitted changes, so the zips would not match a commit:\n${changes.join('\n')}\n`
			+ 'Commit them first, or pack anyway with --allow-dirty.',
		);
	}
	const { version } = /** @type {{ version: string }} */ (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
	const date = await commitDate(root);
	const appFiles = await Promise.all((await trackedFiles(root, APP_PATHS)).map(async (path) => ({
		path,
		data: await readFile(join(root, path)),
	})));
	/** @type {Map<string, string>} */
	const templates = new Map();
	for (const name of TEMPLATES) {
		templates.set(name, await readFile(join(root, 'packaging', name), 'utf8'));
	}

	await mkdir(output, { recursive: true });
	const written = [];
	for (const platform of platforms) {
		const entries = packageEntries({
			platform,
			version,
			nodeVersion,
			appFiles,
			runtime: await runtimes.runtimeFor(platform),
			template: (name) => /** @type {string} */ (templates.get(name)),
		});
		const file = join(output, `${packageName(version, platform)}.zip`);
		const zip = createZip(entries, date);
		await writeFile(file, zip);
		written.push({ file, size: zip.length });
	}
	return written;
}
