import { sortBy } from './sort.js';

/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {import('./scanner.js').ScannedAudio} ScannedAudio */
/** @typedef {import('./validate.js').AudioOptions} AudioOptions */
/** @typedef {import('./validate.js').PlaylistOptions} PlaylistOptions */

/**
 * @typedef {object} AudioFile
 * @property {string} id path relative to the root, using `/`
 * @property {string} title
 * @property {import('./classify.js').AudioFormat} format
 * @property {number} size
 * @property {number} gain linear multiplier for its own volume; 1 plays it as recorded
 * @property {string} absolutePath
 */

/**
 * @typedef {object} Playlist
 * @property {string} id
 * @property {string} title
 * @property {number} gain linear multiplier for the whole playlist's volume
 * @property {AudioFile[]} tracks in path order
 * @property {string[]} includedSubdirectories
 */

/**
 * @typedef {object} Library
 * @property {string} root
 * @property {Playlist[]} playlists non-empty playlists, sorted by title
 * @property {AudioFile[]} sounds sorted by title
 * @property {Map<string, AudioFile>} files every sound and track by id; the only files the server may stream
 */

/**
 * Combines a scan with the parsed options files into the library the app serves.
 * @param {ScanResult} scan
 * @param {Map<string, AudioOptions | PlaylistOptions>} optionsByPath already-validated options, keyed by options file path
 * @returns {Library}
 */
export function buildLibrary(scan, optionsByPath) {
	/** @param {ScannedAudio} scanned */
	const toAudioFile = ({ id, name, format, size, absolutePath, optionsPath }) => {
		const options = /** @type {AudioOptions | undefined} */ (optionsByPath.get(optionsPath));
		return {
			id,
			title: options?.title ?? name,
			format,
			size,
			gain: options?.gain ?? 1,
			absolutePath,
		};
	};

	const sounds = sortBy(scan.sounds.map(toAudioFile), (sound) => sound.title);
	const playlists = sortBy(
		scan.playlists
			.filter((playlist) => playlist.tracks.length > 0)
			.map((playlist) => {
				const options = /** @type {PlaylistOptions | undefined} */ (optionsByPath.get(playlist.optionsPath));
				return {
					id: playlist.id,
					title: options?.title ?? playlist.id,
					gain: options?.gain ?? 1,
					tracks: playlist.tracks.map(toAudioFile),
					includedSubdirectories: options?.includedSubdirectories ?? [],
				};
			}),
		(playlist) => playlist.title,
	);

	const files = new Map([...sounds, ...playlists.flatMap((playlist) => playlist.tracks)].map((file) => [file.id, file]));
	return { root: scan.root, playlists, sounds, files };
}
