import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { findBackgroundFiles } from './backgrounds.js';
import { audioFormatOf } from './classify.js';
import { TRASH_DIRECTORY } from './file-moves.js';
import { isPlainObject } from './validate.js';
import { sortBy } from './sort.js';

/**
 * @typedef {object} TrashedFile a sound or a track in the trash
 * @property {string} id its path inside the trash, using `/`, which is the id it had in the library
 * @property {string} name
 * @property {string} title from its trashed options file, else the file name
 * @property {number} size bytes of the audio file and its companions
 * @property {string} absolutePath
 */

/**
 * @typedef {object} TrashedPlaylist a folder in the trash
 * @property {string} id the folder name
 * @property {string} title from `.trash/<id>.json`, else the folder name
 * @property {number} size bytes of everything in the folder, and its options file
 * @property {TrashedFile[]} tracks audio files at any depth, in path order
 * @property {string} absolutePath
 * @property {string} optionsPath `.trash/<id>.json`, which may not exist
 */

/**
 * @typedef {object} TrashListing
 * @property {number} size bytes of every file under `.trash/`
 * @property {TrashedPlaylist[]} playlists sorted by title; folders without audio files are left out
 * @property {TrashedFile[]} sounds sorted by title
 */

/** @typedef {{ size: number, count: number }} TrashSummary `count` is the number of listed playlists and sounds */

/**
 * @typedef {{ kind: 'sound' | 'track' | 'playlist', id: string }} TrashItem
 */

/** The id is not something the trash holds. */
export class UnknownTrashItemError extends Error {
	/** @param {TrashItem} item */
	constructor({ kind, id }) {
		super(`There is no ${kind} "${id}" in the trash`);
		this.name = 'UnknownTrashItemError';
		this.messageCode = 'item.notInTrash';
		this.messageParams = { id };
	}
}

/**
 * Reads what the trash holds (DESIGN.md §2.5): root-level audio files are sounds, folders are playlists, and the
 * audio files at any depth inside a folder are its tracks. Dot files are skipped, but every file counts toward the size.
 * @param {string} root
 * @returns {Promise<TrashListing>}
 */
export async function readTrash(root) {
	const trash = join(root, TRASH_DIRECTORY);
	const entries = await readdir(trash, { withFileTypes: true }).catch((/** @type {NodeJS.ErrnoException} */ error) => {
		if (error.code === 'ENOENT') {
			return [];
		}
		throw error;
	});
	/** @type {TrashedFile[]} */
	const sounds = [];
	/** @type {TrashedPlaylist[]} */
	const playlists = [];
	let size = 0;
	for (const entry of entries) {
		const path = join(trash, entry.name);
		if (entry.isDirectory()) {
			const folderSize = await sizeOf(path);
			size += folderSize;
			if (entry.name.startsWith('.')) {
				continue;
			}
			const tracks = await findAudio(path, entry.name);
			if (tracks.length === 0) {
				continue;
			}
			const optionsPath = join(trash, `${entry.name}.json`);
			const options = await readOptions(optionsPath);
			let imageSize = 0;
			for (const image of await findBackgroundFiles(trash, entry.name)) {
				imageSize += (await lstat(image)).size;
			}
			playlists.push({
				id: entry.name,
				title: titleOf(options, entry.name),
				size: folderSize + (options === null ? 0 : options.size) + imageSize,
				tracks: sortBy(tracks, (track) => track.id),
				absolutePath: path,
				optionsPath,
			});
		} else if (entry.isFile()) {
			size += (await lstat(path)).size;
			if (!entry.name.startsWith('.') && audioFormatOf(entry.name) !== null) {
				sounds.push(await trashedFile(path, entry.name, entry.name));
			}
		}
	}
	return {
		size,
		playlists: sortBy(playlists, (playlist) => playlist.title),
		sounds: sortBy(sounds, (sound) => sound.title),
	};
}

/**
 * @param {TrashListing} listing
 * @returns {TrashSummary}
 */
export function summarize({ size, playlists, sounds }) {
	return { size, count: playlists.length + sounds.length };
}

/**
 * Finds an item in the listing, so only what the trash really holds can be restored or deleted; ids never become
 * paths on their own.
 * @param {TrashListing} listing
 * @param {TrashItem} item
 */
export function findInTrash(listing, item) {
	const { kind, id } = item;
	const found = kind === 'sound'
		? listing.sounds.find((sound) => sound.id === id)
		: kind === 'playlist'
			? listing.playlists.find((playlist) => playlist.id === id)
			: listing.playlists.flatMap((playlist) => playlist.tracks).find((track) => track.id === id);
	if (!found) {
		throw new UnknownTrashItemError(item);
	}
	return found;
}

/**
 * Deletes an audio file in the trash for good, with its options file and waveform.
 * @param {string} path
 */
export async function purgeAudioFile(path) {
	for (const suffix of ['', '.json', '.wf']) {
		await rm(`${path}${suffix}`, { force: true });
	}
}

/**
 * Deletes a trashed playlist for good: its folder, with everything in it, its options file and its image.
 * @param {Pick<TrashedPlaylist, 'absolutePath' | 'optionsPath'>} playlist
 */
export async function purgePlaylistFolder({ absolutePath, optionsPath }) {
	await rm(absolutePath, { recursive: true, force: true });
	await rm(optionsPath, { force: true });
	for (const path of await findBackgroundFiles(dirname(absolutePath), basename(absolutePath))) {
		await rm(path, { force: true });
	}
}

/**
 * A trashed playlist with no audio files left leaves the trash completely, so the trash never holds anything the
 * dialog can't show (DESIGN.md §2.5).
 * @param {string} root
 * @param {string} playlistId
 */
export async function purgeIfEmpty(root, playlistId) {
	const absolutePath = join(root, TRASH_DIRECTORY, playlistId);
	if ((await findAudio(absolutePath, playlistId).catch(() => null))?.length === 0) {
		await purgePlaylistFolder({ absolutePath, optionsPath: `${absolutePath}.json` });
	}
}

/**
 * Keeps the trash's summary for the event streams. The trash is not watched (DESIGN.md §2.5): `reload` runs at
 * startup and after the app's own changes to it.
 */
export class Trash {
	#root;
	/** @type {TrashSummary} */
	#summary = { size: 0, count: 0 };
	/** @type {Set<(summary: TrashSummary) => void>} */
	#listeners = new Set();

	/** @param {string} root */
	constructor(root) {
		this.#root = root;
	}

	/** @returns {TrashSummary} */
	get summary() {
		return this.#summary;
	}

	/** @returns {Promise<TrashListing>} */
	list() {
		return readTrash(this.#root);
	}

	/** Reads the trash again and tells the listeners when its summary changed. */
	async reload() {
		const next = summarize(await this.list());
		if (next.size !== this.#summary.size || next.count !== this.#summary.count) {
			this.#summary = next;
			for (const listener of this.#listeners) {
				listener(next);
			}
		}
	}

	/**
	 * @param {(summary: TrashSummary) => void} listener
	 * @returns {() => void} unsubscribes
	 */
	onChange(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}

/**
 * @param {string} directory
 * @param {string} id the directory's id, using `/`
 * @returns {Promise<TrashedFile[]>}
 */
async function findAudio(directory, id) {
	/** @type {TrashedFile[]} */
	const found = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) {
			continue;
		}
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...await findAudio(path, `${id}/${entry.name}`));
		} else if (entry.isFile() && audioFormatOf(entry.name) !== null) {
			found.push(await trashedFile(path, entry.name, `${id}/${entry.name}`));
		}
	}
	return found;
}

/**
 * @param {string} path
 * @param {string} name
 * @param {string} id
 * @returns {Promise<TrashedFile>}
 */
async function trashedFile(path, name, id) {
	const options = await readOptions(`${path}.json`);
	let size = (await lstat(path)).size + (options?.size ?? 0);
	size += await lstat(`${path}.wf`).then((stats) => stats.size, () => 0);
	return { id, name, title: titleOf(options, name), size, absolutePath: path };
}

/**
 * Reads an options file leniently: the trash is never validated, so a broken file only loses its title.
 * @param {string} path
 * @returns {Promise<{ value: unknown, size: number } | null>}
 */
async function readOptions(path) {
	let text;
	try {
		text = await readFile(path, 'utf8');
	} catch {
		return null;
	}
	const size = Buffer.byteLength(text);
	try {
		return { value: JSON.parse(text), size };
	} catch {
		return { value: null, size };
	}
}

/**
 * @param {{ value: unknown } | null} options
 * @param {string} fallback
 */
function titleOf(options, fallback) {
	const value = options?.value;
	return isPlainObject(value) && typeof value.title === 'string' && value.title.trim() !== '' ? value.title : fallback;
}

/**
 * @param {string} directory
 * @returns {Promise<number>} bytes of every file inside, at any depth
 */
async function sizeOf(directory) {
	let size = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			size += await sizeOf(path);
		} else {
			size += (await lstat(path)).size;
		}
	}
	return size;
}
