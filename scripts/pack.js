// Builds the release zips (DESIGN.md §13): one per platform, each with the app, the official Node.js binary and a
// launcher.
//
//   npm run pack [-- --platform <name>… --allow-dirty]
//
// Without --platform, every platform is packed. Exits 1 when packing fails, 2 on misuse.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PackError } from './pack/errors.js';
import { commitDate, trackedFiles, uncommittedChanges } from './pack/git-files.js';
import { NodeRuntimes } from './pack/node-runtime.js';
import { APP_PATHS, packageEntries, packageName } from './pack/package-layout.js';
import { NODE_VERSION, PLATFORMS } from './pack/platforms.js';
import { createZip } from './pack/zip.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'dist');
const USAGE = `Usage: npm run pack [-- --platform <name>… --allow-dirty]\nPlatforms: ${PLATFORMS.map(({ name }) => name).join(', ')}`;

/** @type {{ values: { platform?: string[], 'allow-dirty'?: boolean } }} */
let parsed;
try {
	parsed = parseArgs({
		options: { 'platform': { type: 'string', multiple: true }, 'allow-dirty': { type: 'boolean' } },
	});
} catch (error) {
	console.error(`${/** @type {Error} */ (error).message}\n${USAGE}`);
	process.exit(2);
}
const names = parsed.values.platform ?? PLATFORMS.map(({ name }) => name);
const unknown = names.filter((name) => !PLATFORMS.some((platform) => platform.name === name));
if (unknown.length > 0) {
	console.error(`Unknown platform: ${unknown.join(', ')}\n${USAGE}`);
	process.exit(2);
}

try {
	await pack(PLATFORMS.filter(({ name }) => names.includes(name)), parsed.values['allow-dirty'] ?? false);
} catch (error) {
	if (!(error instanceof PackError)) {
		throw error;
	}
	console.error(error.message);
	process.exitCode = 1;
}

/**
 * @param {import('./pack/platforms.js').Platform[]} platforms
 * @param {boolean} allowDirty
 */
async function pack(platforms, allowDirty) {
	const changes = await uncommittedChanges(ROOT, APP_PATHS);
	if (changes.length > 0 && !allowDirty) {
		throw new PackError(
			`These files have uncommitted changes, so the zips would not match a commit:\n${changes.join('\n')}\n`
			+ 'Commit them first, or pack anyway with --allow-dirty.',
		);
	}
	const { version } = /** @type {{ version: string }} */ (JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')));
	const date = await commitDate(ROOT);
	const appFiles = await Promise.all((await trackedFiles(ROOT, APP_PATHS)).map(async (path) => ({
		path,
		data: await readFile(join(ROOT, path)),
	})));
	/** @type {Map<string, string>} */
	const templates = new Map();
	for (const name of ['start.sh', 'start.cmd', 'README-windows.txt', 'README-macos.txt', 'README-linux.txt']) {
		templates.set(name, await readFile(join(ROOT, 'packaging', name), 'utf8'));
	}
	const runtimes = new NodeRuntimes({ version: NODE_VERSION, cacheFolder: join(OUTPUT, 'cache') });

	await mkdir(OUTPUT, { recursive: true });
	for (const platform of platforms) {
		const entries = packageEntries({
			platform,
			version,
			nodeVersion: NODE_VERSION,
			appFiles,
			runtime: await runtimes.runtimeFor(platform),
			template: (name) => /** @type {string} */ (templates.get(name)),
		});
		const file = join(OUTPUT, `${packageName(version, platform)}.zip`);
		const zip = createZip(entries, date);
		await writeFile(file, zip);
		console.log(`${file} (${(zip.length / 1024 / 1024).toFixed(1)} MB)`);
	}
}
