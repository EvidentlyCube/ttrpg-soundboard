// Builds the release zips (DESIGN.md §13): one per platform, each with the app, the official Node.js binary and a
// launcher.
//
//   npm run pack [-- --platform <name>… --allow-dirty]
//
// Without --platform, every platform is packed. Exits 1 when packing fails, 2 on misuse.

import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PackError } from './pack/errors.js';
import { NodeRuntimes } from './pack/node-runtime.js';
import { pack } from './pack/pack.js';
import { NODE_VERSION, PLATFORMS } from './pack/platforms.js';

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
	const written = await pack({
		root: ROOT,
		output: OUTPUT,
		platforms: PLATFORMS.filter(({ name }) => names.includes(name)),
		nodeVersion: NODE_VERSION,
		runtimes: new NodeRuntimes({ version: NODE_VERSION, cacheFolder: join(OUTPUT, 'cache') }),
		allowDirty: parsed.values['allow-dirty'] ?? false,
	});
	for (const { file, size } of written) {
		console.log(`${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
	}
} catch (error) {
	if (!(error instanceof PackError)) {
		throw error;
	}
	console.error(error.message);
	process.exitCode = 1;
}
