import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { audioFormatOf } from '../library/classify.js';
import { checkFolder, refusalOf } from './folder-rules.js';

/** @typedef {import('./folder-rules.js').Platform} Platform */

/**
 * @typedef {object} FolderListing what the Selector's folder browser shows (DESIGN.md §5.2)
 * @property {string} path
 * @property {string | null} parent null at the top of a disk
 * @property {{ name: string, path: string, soundboard: boolean, refused: string | null }[]} folders the subfolders by
 * 	name, without hidden ones; `refused` is why one can't be opened, judged by its path alone
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

/**
 * @param {string} path absolute
 * @param {Platform} platform
 * @returns {Promise<FolderListing>}
 * @throws {FolderUnreadableError}
 */
export async function listFolder(path, platform) {
	const entries = await readdir(path, { withFileTypes: true }).catch(() => {
		throw new FolderUnreadableError(path);
	});
	/** @type {string[]} */
	const names = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.')) {
			continue;
		}
		if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(join(path, entry.name))))) {
			names.push(entry.name);
		}
	}
	names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
	const folders = await Promise.all(names.map(async (name) => {
		const folder = join(path, name);
		return {
			name,
			path: folder,
			soundboard: await stat(join(folder, '.soundboard')).then(() => true, () => false),
			refused: refusalOf(folder, platform),
		};
	}));
	const check = await checkFolder(path, platform);
	const parent = dirname(path);
	return {
		path,
		parent: parent === path ? null : parent,
		folders,
		audioFiles: entries.filter((entry) => entry.isFile() && audioFormatOf(entry.name)).length,
		soundboard: entries.some((entry) => entry.name === '.soundboard'),
		allowed: check.allowed,
		reason: check.reason,
	};
}

/**
 * Where the folder browser can start: the home folder and its usual folders for media, then the drives.
 * @param {Platform} platform
 * @param {{ list?: (path: string) => Promise<string[]>, exists?: (path: string) => Promise<boolean> }} [io]
 * @returns {Promise<Place[]>} only places that exist
 */
export async function startingPlaces(platform, { list = listNames, exists = isDirectory } = {}) {
	const { home } = platform;
	/** @type {Place[]} */
	const places = [{ name: 'Home', path: home }];
	for (const name of ['Music', 'Desktop', 'Documents', 'Downloads']) {
		const path = join(home, name);
		if (await exists(path)) {
			places.push({ name, path });
		}
	}
	if (platform.name === 'win32') {
		// A and B are left out: asking about a floppy drive can hang for seconds.
		for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
			const path = `${letter}:\\`;
			if (await exists(path)) {
				places.push({ name: `${letter}:`, path });
			}
		}
		return places;
	}
	const mounts = platform.name === 'darwin'
		? ['/Volumes']
		: ['/media', join('/media', basename(home)), join('/run/media', basename(home)), '/mnt'];
	for (const parent of mounts) {
		for (const name of await list(parent)) {
			const path = join(parent, name);
			// `/media/<user>` holds the drives rather than being one; its own entries are listed separately.
			if (path !== join('/media', basename(home)) && (await exists(path))) {
				places.push({ name, path });
			}
		}
	}
	return places;
}

/** @param {string} path */
async function listNames(path) {
	return readdir(path).then((names) => names.filter((name) => !name.startsWith('.')), () => []);
}

/** @param {string} path */
async function isDirectory(path) {
	return stat(path).then((stats) => stats.isDirectory(), () => false);
}
