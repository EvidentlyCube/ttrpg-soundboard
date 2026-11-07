import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyDirectory } from './classify.js';
import { compareNatural, sortBy } from './sort.js';

/** @typedef {import('./classify.js').AudioFormat} AudioFormat */
/** @typedef {import('./classify.js').DirectoryEntry} DirectoryEntry */
/** @typedef {import('./classify.js').DirectoryClassification} DirectoryClassification */

/**
 * @typedef {object} ScannedAudio
 * @property {string} id path relative to the root, using `/`
 * @property {string} name file name exactly as the file system returned it
 * @property {AudioFormat} format
 * @property {number} size bytes
 * @property {string} modified the modification time, as an ISO 8601 string
 * @property {string} absolutePath
 * @property {string} optionsPath
 * @property {boolean} hasOptions
 */

/**
 * @typedef {object} ScannedPlaylist
 * @property {string} id directory name
 * @property {string} absolutePath
 * @property {string} optionsPath `<root>/<id>.json`
 * @property {boolean} hasOptions
 * @property {string[]} backgroundPaths its `<id>.bg.<extension>` files in the root, sorted; more than one is a mistake
 * @property {ScannedAudio[]} tracks from every depth, sorted by path
 * @property {string[]} subdirectories nested directories at every depth, relative to the playlist, using `/`
 */

/**
 * @typedef {{ kind: 'unsupported-audio' | 'orphan-options' | 'symlink' | 'empty-playlist' | 'invalid-background'
 * 	| 'duplicate-background' | 'large-background', path: string, params?: Record<string, string | number> }} ScanWarning
 * 	the background kinds come from bootstrap, which reads the images
 */

/**
 * @typedef {object} ScanResult
 * @property {string} root
 * @property {boolean} hasSettingsFile
 * @property {string} settingsPath
 * @property {ScannedAudio[]} sounds sorted by name
 * @property {ScannedPlaylist[]} playlists sorted by id, including empty ones
 * @property {ScanWarning[]} warnings sorted by path
 */

export const SETTINGS_FILE_NAME = '.soundboard';

/**
 * Walks the audio directory and classifies everything in it (DESIGN.md §2.1). Reads directory listings and file sizes and dates only.
 * @param {string} root
 * @returns {Promise<ScanResult>}
 */
export async function scanAudioDirectory(root) {
	const entries = await readEntries(root);
	const classification = classifyDirectory(entries, { isRoot: true });
	/** @type {ScanWarning[]} */
	const warnings = [];
	collectWarnings(classification, '', warnings);

	const sounds = await scanAudioFiles(root, '', classification);
	/** @type {ScannedPlaylist[]} */
	const playlists = [];
	for (const id of classification.directories) {
		const playlist = await scanPlaylist(root, id, classification.directoriesWithOptions.has(id), warnings);
		playlist.backgroundPaths = (classification.directoryBackgrounds.get(id) ?? []).toSorted(compareNatural).map((name) => join(root, name));
		if (playlist.tracks.length === 0) {
			warnings.push({ kind: 'empty-playlist', path: id });
		}
		playlists.push(playlist);
	}

	return {
		root,
		hasSettingsFile: entries.some((entry) => entry.name === SETTINGS_FILE_NAME && entry.kind === 'file'),
		settingsPath: join(root, SETTINGS_FILE_NAME),
		sounds: sortBy(sounds, (sound) => sound.name),
		playlists: sortBy(playlists, (playlist) => playlist.id),
		warnings: sortBy(warnings, (warning) => warning.path),
	};
}

/**
 * @param {string} root
 * @param {string} id
 * @param {boolean} hasOptions
 * @param {ScanWarning[]} warnings
 * @returns {Promise<ScannedPlaylist>}
 */
async function scanPlaylist(root, id, hasOptions, warnings) {
	/** @type {ScannedAudio[]} */
	const tracks = [];
	/** @type {string[]} */
	const subdirectories = [];

	/** @param {string} relativeDirectory */
	const walk = async (relativeDirectory) => {
		const classification = classifyDirectory(await readEntries(toAbsolute(root, relativeDirectory)), { isRoot: false });
		collectWarnings(classification, relativeDirectory, warnings);
		tracks.push(...await scanAudioFiles(root, relativeDirectory, classification));
		for (const name of classification.directories) {
			const child = `${relativeDirectory}/${name}`;
			subdirectories.push(child.slice(id.length + 1));
			await walk(child);
		}
	};
	await walk(id);

	const absolutePath = join(root, id);
	return {
		id,
		absolutePath,
		optionsPath: `${absolutePath}.json`,
		hasOptions,
		backgroundPaths: [],
		tracks: sortBy(tracks, (track) => track.id),
		subdirectories: subdirectories.toSorted(compareNatural),
	};
}

/**
 * @param {string} root
 * @param {string} relativeDirectory
 * @param {DirectoryClassification} classification
 * @returns {Promise<ScannedAudio[]>}
 */
function scanAudioFiles(root, relativeDirectory, classification) {
	return Promise.all(classification.audioFiles.map(async ({ name, format }) => {
		const id = joinRelative(relativeDirectory, name);
		const absolutePath = toAbsolute(root, id);
		const { size, mtime } = await stat(absolutePath);
		return {
			id,
			name,
			format,
			size,
			modified: mtime.toISOString(),
			absolutePath,
			optionsPath: `${absolutePath}.json`,
			hasOptions: classification.audioWithOptions.has(name),
		};
	}));
}

/**
 * @param {DirectoryClassification} classification
 * @param {string} relativeDirectory
 * @param {ScanWarning[]} warnings
 */
function collectWarnings(classification, relativeDirectory, warnings) {
	/** @type {[ScanWarning['kind'], string[]][]} */
	const groups = [
		['unsupported-audio', classification.unsupportedAudio],
		['orphan-options', classification.orphanOptions],
		['symlink', classification.symlinks],
	];
	for (const [kind, names] of groups) {
		warnings.push(...names.map((name) => ({ kind, path: joinRelative(relativeDirectory, name) })));
	}
}

/**
 * @param {string} directory
 * @returns {Promise<DirectoryEntry[]>}
 */
async function readEntries(directory) {
	const dirents = await readdir(directory, { withFileTypes: true });
	return dirents.map((dirent) => ({
		name: dirent.name,
		kind: dirent.isFile() ? 'file' : dirent.isDirectory() ? 'directory' : dirent.isSymbolicLink() ? 'symlink' : 'other',
	}));
}

/**
 * @param {string} relativeDirectory
 * @param {string} name
 */
function joinRelative(relativeDirectory, name) {
	return relativeDirectory === '' ? name : `${relativeDirectory}/${name}`;
}

/**
 * @param {string} root
 * @param {string} relativePath
 */
function toAbsolute(root, relativePath) {
	return join(root, ...relativePath.split('/'));
}
