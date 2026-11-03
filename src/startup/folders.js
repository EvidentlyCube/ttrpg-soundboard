import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { audioFormatOf } from '../library/classify.js';
import { validateName } from '../library/validate.js';
import { browseRefusalOf, checkFolder, reasonCodeOf, refusalOf, resolvedPath } from './folder-rules.js';

/** @typedef {import('./folder-rules.js').Platform} Platform */

/**
 * @typedef {object} FolderListing what the Selector's folder browser shows (DESIGN.md §5.2)
 * @property {string} path with symbolic links resolved
 * @property {string | null} parent null at the top of a disk; it may be outside the roots, which the next listing refuses
 * @property {{ name: string, title: string | null, path: string, soundboard: boolean, holdsSoundboard: boolean, refused: string | null,
 * 	refusedCode: string | null }[]} folders `refusedCode`: what the page translates `refused` by (DESIGN.md §9.21)
 * 	the subfolders by name, without hidden ones unless they are allowed; `title` is a soundboard's own name;
 * 	`holdsSoundboard` that a soundboard was found inside one that isn't; `refused` is why one can't be opened, judged
 * 	by its path alone
 * @property {number} audioFiles supported audio files directly inside, dot files left out
 * @property {string[]} files their names, in the same order as the folders
 * @property {boolean} soundboard whether it holds `.soundboard`
 * @property {boolean} allowed whether it can be opened
 * @property {string | null} reason why not
 * @property {string | null} reasonCode its code
 */

/** @typedef {{ name: string, path: string }} Place */

/** How many levels inside each listed folder the browser looks for a soundboard. */
export const NESTED_SOUNDBOARD_DEPTH = 3;
/** How many folders one listing reads at most while looking. */
export const MAX_SEARCHED_FOLDERS = 1000;
/**
 * Folders that tools fill with thousands of their own folders and that never hold a soundboard, skipped by the search
 * so they don't use it up.
 */
const NEVER_SEARCHED = new Set([
	'node_modules',
	'bower_components',
	'__pycache__',
	'site-packages',
	'venv',
	'.venv',
	'.git',
	'.svn',
	'.hg',
	'.cache',
	'.npm',
	'.gradle',
	'.m2',
	'$RECYCLE.BIN',
	'System Volume Information',
]);

/** The folder can't be listed: it is gone, isn't a folder, or may not be read. */
export class FolderUnreadableError extends Error {
	/** @param {string} path */
	constructor(path) {
		super(`This folder can’t be opened: ${path}`);
		this.name = 'FolderUnreadableError';
		this.messageCode = 'folder.cantOpen';
		this.messageParams = { path };
	}
}

/** The folder may not be browsed (DESIGN.md §5.7); the message says why. */
export class FolderNotAllowedError extends Error {
	/** @param {string} reason */
	constructor(reason) {
		super(reason);
		this.name = 'FolderNotAllowedError';
		this.messageCode = reasonCodeOf(reason) ?? undefined;
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
	const byName = (/** @type {string} */ a, /** @type {string} */ b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
	names.sort(byName);
	// Dot files are left out like the soundboard leaves them out (DESIGN.md §2.1), such as macOS's `._` copies.
	const files = entries
		.filter((entry) => entry.isFile() && !entry.name.startsWith('.') && audioFormatOf(entry.name))
		.map((entry) => entry.name)
		.sort(byName);
	const folders = await Promise.all(names.map(async (name) => {
		const folder = join(real, name);
		const marker = await readMarker(folder);
		const refused = refusalOf(folder, platform);
		return {
			name,
			title: marker.name,
			path: folder,
			soundboard: marker.soundboard,
			holdsSoundboard: false,
			refused,
			refusedCode: reasonCodeOf(refused),
		};
	}));
	await markNestedSoundboards(folders.filter((folder) => !folder.soundboard), platform);
	const check = await checkFolder(real, platform);
	const parent = dirname(real);
	return {
		path: real,
		parent: parent === real ? null : parent,
		folders,
		audioFiles: files.length,
		files,
		soundboard: entries.some((entry) => entry.name === '.soundboard'),
		allowed: check.allowed,
		reason: check.reason,
		reasonCode: reasonCodeOf(check.reason),
	};
}

/**
 * Sets `holdsSoundboard` on each folder with a soundboard up to `NESTED_SOUNDBOARD_DEPTH` levels inside it. All the
 * folders are searched together, a level at a time, so the shallow soundboards are found first, and the search stops
 * after reading `MAX_SEARCHED_FOLDERS` folders, so a listing of a huge tree stays quick. Symbolic links aren't
 * followed, so a link can't lead the search in circles.
 * @param {{ path: string, holdsSoundboard: boolean }[]} folders
 * @param {Platform} platform
 */
async function markNestedSoundboards(folders, platform) {
	let budget = MAX_SEARCHED_FOLDERS;
	/** Folders to read, each with the listed folder it is inside. */
	let level = folders.filter((owner) => !NEVER_SEARCHED.has(basename(owner.path))).map((owner) => ({ owner, path: owner.path }));
	for (let depth = 0; depth <= NESTED_SOUNDBOARD_DEPTH && level.length > 0 && budget > 0; depth++) {
		const batch = level.filter(({ owner }) => !owner.holdsSoundboard).slice(0, budget);
		budget -= batch.length;
		const read = await Promise.all(batch.map(async ({ owner, path }) => ({
			owner,
			path,
			entries: await readdir(path, { withFileTypes: true }).catch(() => []),
		})));
		level = [];
		for (const { owner, path, entries } of read) {
			// Depth 0 is the listed folder itself, already known not to be a soundboard.
			if (depth > 0 && entries.some((entry) => entry.name === '.soundboard')) {
				owner.holdsSoundboard = true;
				continue;
			}
			for (const entry of entries) {
				if (
					entry.isDirectory()
					&& (platform.allowHidden || !entry.name.startsWith('.'))
					&& !NEVER_SEARCHED.has(entry.name)
				) {
					level.push({ owner, path: join(path, entry.name) });
				}
			}
		}
	}
}

/**
 * The name the Selector shows for a folder: the soundboard's own name (DESIGN.md §2.3), or the folder's.
 * @param {string} folder
 */
export async function displayName(folder) {
	return (await readMarker(folder)).name ?? (basename(folder) || folder);
}

/**
 * Whether a folder holds `.soundboard`, and the name in it. A broken one still marks a soundboard, without a name;
 * opening it reports what is wrong (DESIGN.md §2.3).
 * @param {string} folder
 * @returns {Promise<{ soundboard: boolean, name: string | null }>}
 */
async function readMarker(folder) {
	let text;
	try {
		text = await readFile(join(folder, '.soundboard'), 'utf8');
	} catch (error) {
		return { soundboard: /** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT', name: null };
	}
	try {
		const { name } = JSON.parse(text);
		return { soundboard: true, name: validateName(name).length === 0 ? name.trim() : null };
	} catch {
		return { soundboard: true, name: null };
	}
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
