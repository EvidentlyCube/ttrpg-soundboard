import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { audioFormatOf } from '../library/classify.js';
import { browseRefusalOf, checkFolder, refusalOf, resolvedPath } from './folder-rules.js';

/** @typedef {import('./folder-rules.js').Platform} Platform */

/**
 * @typedef {object} FolderListing what the Selector's folder browser shows (DESIGN.md §5.2)
 * @property {string} path with symbolic links resolved
 * @property {string | null} parent null at the top of a disk; it may be outside the roots, which the next listing refuses
 * @property {{ name: string, path: string, soundboard: boolean, refused: string | null }[]} folders the subfolders by
 * 	name, without hidden ones unless they are allowed; `refused` is why one can't be opened, judged by its path alone
 * @property {number} audioFiles supported audio files directly inside
 * @property {boolean} soundboard whether it holds `.soundboard`
 * @property {boolean} allowed whether it can be opened
 * @property {string | null} reason why not
 */

/** @typedef {{ name: string, path: string }} Place */

/** The folder can't be listed: it is gone, isn't a folder, or may not be read. */
export class FolderUnreadableError extends Error {
	/** @param {string} path */
	constructor(path) {
		super(`This folder can’t be opened: ${path}`);
		this.name = 'FolderUnreadableError';
	}
}

/** The folder may not be browsed (DESIGN.md §5.7); the message says why. */
export class FolderNotAllowedError extends Error {
	/** @param {string} reason */
	constructor(reason) {
		super(reason);
		this.name = 'FolderNotAllowedError';
	}
}

/**
 * @param {string} path absolute
 * @param {Platform} platform
 * @returns {Promise<FolderListing>}
 * @throws {FolderUnreadableError}
 * @throws {FolderNotAllowedError}
 */
export async function listFolder(path, platform) {
	const real = await resolvedPath(path);
	if (real === null) {
		throw new FolderUnreadableError(path);
	}
	const refusal = browseRefusalOf(real, platform);
	if (refusal !== null) {
		throw new FolderNotAllowedError(refusal);
	}
	const entries = await readdir(real, { withFileTypes: true }).catch(() => {
		throw new FolderUnreadableError(path);
	});
	/** @type {string[]} */
	const names = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.') && !platform.allowHidden) {
			continue;
		}
		if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(join(real, entry.name))))) {
			names.push(entry.name);
		}
	}
	names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
	const folders = await Promise.all(names.map(async (name) => {
		const folder = join(real, name);
		return {
			name,
			path: folder,
			soundboard: await stat(join(folder, '.soundboard')).then(() => true, () => false),
			refused: refusalOf(folder, platform),
		};
	}));
	const check = await checkFolder(real, platform);
	const parent = dirname(real);
	return {
		path: real,
		parent: parent === real ? null : parent,
		folders,
		audioFiles: entries.filter((entry) => entry.isFile() && audioFormatOf(entry.name)).length,
		soundboard: entries.some((entry) => entry.name === '.soundboard'),
		allowed: check.allowed,
		reason: check.reason,
	};
}

/**
 * Where the folder browser can start: each allowed root, then the home folder's usual folders for media when they are
 * allowed.
 * @param {Platform} platform
 * @param {{ exists?: (path: string) => Promise<boolean> }} [io]
 * @returns {Promise<Place[]>} only places that exist
 */
export async function startingPlaces(platform, { exists = isDirectory } = {}) {
	/** @type {Place[]} */
	const places = [];
	for (const root of platform.roots) {
		if (await exists(root)) {
			places.push({ name: root === platform.home ? 'Home' : basename(root) || root, path: root });
		}
	}
	for (const name of ['Music', 'Desktop', 'Documents', 'Downloads']) {
		const path = join(platform.home, name);
		if (browseRefusalOf(path, platform) === null && !places.some((place) => place.path === path) && (await exists(path))) {
			places.push({ name, path });
		}
	}
	return places;
}

/** @param {string} path */
async function isDirectory(path) {
	return stat(path).then((stats) => stats.isDirectory(), () => false);
}
