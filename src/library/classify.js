import { extname } from 'node:path';

/** @typedef {'mp3' | 'ogg' | 'opus'} AudioFormat */
/** @typedef {{ name: string, kind: 'file' | 'directory' | 'symlink' | 'other' }} DirectoryEntry */

/**
 * @typedef {object} DirectoryClassification
 * @property {{ name: string, format: AudioFormat }[]} audioFiles
 * @property {string[]} directories
 * @property {Set<string>} audioWithOptions names of audio files that have a `<name>.json` next to them
 * @property {Set<string>} directoriesWithOptions names of directories that have a `<name>.json` next to them (root only)
 * @property {string[]} orphanOptions `.json` files that belong to nothing
 * @property {string[]} unsupportedAudio
 * @property {string[]} symlinks
 */

/** @type {Record<string, AudioFormat>} */
const SUPPORTED_FORMATS = { '.mp3': 'mp3', '.ogg': 'ogg', '.opus': 'opus' };
const UNSUPPORTED_AUDIO_EXTENSIONS = new Set(['.wav', '.flac', '.m4a', '.aac', '.wma', '.aif', '.aiff', '.webm', '.mp4']);
const OPTIONS_EXTENSION = '.json';

/**
 * @param {string} name
 * @returns {AudioFormat | null}
 */
export function audioFormatOf(name) {
	return SUPPORTED_FORMATS[extname(name).toLowerCase()] ?? null;
}

/**
 * Classifies the entries of one directory (DESIGN.md §2.1). In the root, directories are playlists and may have options files.
 * @param {DirectoryEntry[]} entries
 * @param {{ isRoot: boolean }} options
 * @returns {DirectoryClassification}
 */
export function classifyDirectory(entries, { isRoot }) {
	const visible = entries.filter((entry) => !entry.name.startsWith('.'));
	const namesOf = (/** @type {DirectoryEntry['kind']} */ kind) => visible.filter((entry) => entry.kind === kind).map((entry) => entry.name);
	const files = namesOf('file');
	const directories = namesOf('directory');

	const audioFiles = files.flatMap((name) => {
		const format = audioFormatOf(name);
		return format ? [{ name, format }] : [];
	});
	const audioNames = new Set(audioFiles.map((file) => file.name));
	const directoryNames = new Set(directories);

	/** @type {Set<string>} */
	const audioWithOptions = new Set();
	/** @type {Set<string>} */
	const directoriesWithOptions = new Set();
	/** @type {string[]} */
	const orphanOptions = [];
	for (const name of files.filter((file) => file.endsWith(OPTIONS_EXTENSION))) {
		const owner = name.slice(0, -OPTIONS_EXTENSION.length);
		if (audioNames.has(owner)) {
			audioWithOptions.add(owner);
		} else if (isRoot && directoryNames.has(owner)) {
			directoriesWithOptions.add(owner);
		} else {
			orphanOptions.push(name);
		}
	}

	return {
		audioFiles,
		directories,
		audioWithOptions,
		directoriesWithOptions,
		orphanOptions,
		unsupportedAudio: files.filter((name) => UNSUPPORTED_AUDIO_EXTENSIONS.has(extname(name).toLowerCase())),
		symlinks: namesOf('symlink'),
	};
}
