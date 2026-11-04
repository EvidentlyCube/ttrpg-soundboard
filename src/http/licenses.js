import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * @typedef {object} IncludedPart
 * @property {string} id
 * @property {string} name
 * @property {string | null} version
 * @property {string} license the license's name
 * @property {string | null} text the full license, null when its file can't be read
 * @property {string | null} url where the license can be read online
 */

/**
 * @typedef {object} ExternalProgram
 * @property {string} id
 * @property {string} name
 * @property {string} url its website
 */

/** @typedef {{ included: IncludedPart[], external: ExternalProgram[] }} Licenses */

/**
 * @typedef {object} Runtime
 * @property {'node' | 'bun' | 'deno'} id
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string} url
 */

const TAILWIND_FILE = /^tailwindcss-browser-(.+)\.js$/;

/** Programs the app runs when they are installed but never ships (DESIGN.md §5.4). */
const EXTERNAL = Object.freeze([
	{ id: 'yt-dlp', name: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp' },
	{ id: 'ffmpeg', name: 'FFmpeg', url: 'https://ffmpeg.org' },
]);

/**
 * The runtime the server runs on. Bun and Deno also fill in `process.versions.node` and `process.release`, so they are
 * looked for first.
 * @param {{ versions: Record<string, string | undefined>, release?: { name?: string } }} [proc]
 * @returns {Runtime | null} null when it can't be told
 */
export function detectRuntime(proc = process) {
	const { versions } = proc;
	if (versions.bun) {
		return { id: 'bun', name: 'Bun', version: versions.bun, license: 'MIT', url: 'https://github.com/oven-sh/bun/blob/main/LICENSE.md' };
	}
	if (versions.deno) {
		return { id: 'deno', name: 'Deno', version: versions.deno, license: 'MIT', url: 'https://github.com/denoland/deno/blob/main/LICENSE.md' };
	}
	if (proc.release?.name === 'node' && versions.node) {
		return { id: 'node', name: 'Node.js', version: versions.node, license: 'MIT', url: 'https://github.com/nodejs/node/blob/main/LICENSE' };
	}
	return null;
}

/**
 * What the Licenses dialog lists (DESIGN.md §5.2, §9.22). The files are read on every call, and one that can't be
 * read only leaves its text out.
 * @param {object} options
 * @param {string} options.appVersion
 * @param {string} options.publicDir
 * @param {Runtime | null} [options.runtime]
 * @param {string} [options.execPath] the runtime's binary; the release zips put Node's license beside it (DESIGN.md §13)
 * @returns {Promise<Licenses>}
 */
export async function readLicenses({ appVersion, publicDir, runtime = detectRuntime(), execPath = process.execPath }) {
	const vendor = join(publicDir, 'vendor');
	const tailwindVersion = await readdir(vendor).then(
		(names) => names.map((name) => TAILWIND_FILE.exec(name)?.[1]).find((version) => version !== undefined) ?? null,
		() => null,
	);
	/** @type {IncludedPart[]} */
	const included = [
		{
			id: 'app',
			name: 'TTRPG Soundboard',
			version: appVersion,
			license: 'The Unlicense',
			text: await readText(join(publicDir, '..', 'LICENSE')),
			url: null,
		},
		{
			id: 'tailwind',
			name: 'Tailwind CSS',
			version: tailwindVersion,
			license: 'MIT',
			text: await readText(join(vendor, 'tailwindcss-browser.LICENSE')),
			url: 'https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE',
		},
	];
	if (runtime) {
		included.push({
			id: runtime.id,
			name: runtime.name,
			version: runtime.version,
			license: runtime.license,
			text: runtime.id === 'node' ? await readText(join(dirname(execPath), 'LICENSE')) : null,
			url: runtime.url,
		});
	}
	return { included, external: EXTERNAL.map((program) => ({ ...program })) };
}

/**
 * @param {string} path
 * @returns {Promise<string | null>}
 */
function readText(path) {
	return readFile(path, 'utf8').catch(() => null);
}
