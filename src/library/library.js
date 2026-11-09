import { sortBy } from './sort.js';
import { BACKGROUND_STYLE_KEYS, DEFAULT_BACKGROUND_STYLE } from './validate.js';

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
 * @property {number | null} duration seconds, as measured at startup; null when it could not be read
 * @property {number} startAt seconds into the file where playback starts
 * @property {number | null} endAt seconds into the file where playback ends; null is the end of the file
 * @property {number} fadeIn seconds; 0 is off
 * @property {number} fadeOut seconds, ending at the end point; 0 is off
 * @property {(import('./validate.js').Source & { origin: import('./validate.js').SourceOrigin }) | null} source where it
 * 	came from, with a missing `origin` read as a download (DESIGN.md §2.3); null only before bootstrap has given it one
 * @property {string} absolutePath
 * @property {import('./backgrounds.js').Background | null} background a sound's image (DESIGN.md §2.1), when it has a
 * 	usable one; always null for a track, which has no tile
 * @property {number} imageColorOpacity
 * @property {number} imageBlur
 * @property {number} titleShadowOpacity
 * @property {number} titleShadowBlur
 * @property {number} titleShadowOffset
 */

/**
 * @typedef {object} Playlist
 * @property {string} id
 * @property {string} title
 * @property {number} gain linear multiplier for the whole playlist's volume
 * @property {number} crossfade seconds; 0 is off
 * @property {number} fadeIn seconds, when the playlist starts; 0 is off
 * @property {number} fadeOut seconds, when it stops; 0 is off
 * @property {import('./validate.js').PlaybackOrder} order how it moves through its tracks
 * @property {boolean} playlistLooping whether it starts over after its last track
 * @property {boolean} trackLooping whether the current track repeats until the user moves on
 * @property {import('./validate.js').StopMode} stopMode what stopping it remembers
 * @property {AudioFile[]} tracks in path order
 * @property {string[]} includedSubdirectories
 * @property {import('./backgrounds.js').Background | null} background its image (DESIGN.md §2.1), when it has a usable one
 * @property {number} imageColorOpacity
 * @property {number} imageBlur
 * @property {number} titleShadowOpacity
 * @property {number} titleShadowBlur
 * @property {number} titleShadowOffset
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
 * @param {Map<string, import('./backgrounds.js').Background>} [backgrounds] usable images, by playlist or sound id
 * @returns {Library}
 */
export function buildLibrary(scan, optionsByPath, backgrounds = new Map()) {
	/** @param {ScannedAudio} scanned */
	const toAudioFile = (scanned) => audioFileOf(scanned, /** @type {AudioOptions | undefined} */ (optionsByPath.get(scanned.optionsPath)));

	const sounds = sortBy(
		scan.sounds.map((scanned) => ({ ...toAudioFile(scanned), background: backgrounds.get(scanned.id) ?? null })),
		(sound) => sound.title,
	);
	const playlists = sortBy(
		scan.playlists
			.filter((playlist) => playlist.tracks.length > 0)
			.map((playlist) => playlistOf(
				playlist.id,
				/** @type {PlaylistOptions | undefined} */ (optionsByPath.get(playlist.optionsPath)),
				playlist.tracks.map(toAudioFile),
				backgrounds.get(playlist.id) ?? null,
			)),
		(playlist) => playlist.title,
	);

	const files = new Map([...sounds, ...playlists.flatMap((playlist) => playlist.tracks)].map((file) => [file.id, file]));
	return { root: scan.root, playlists, sounds, files };
}

/**
 * @param {string} id the directory name
 * @param {PlaylistOptions | undefined} options
 * @param {AudioFile[]} tracks in path order
 * @param {import('./backgrounds.js').Background | null} [background]
 * @returns {Playlist}
 */
export function playlistOf(id, options, tracks, background = null) {
	return {
		...backgroundStyleOf(options),
		id,
		title: options?.title ?? id,
		gain: options?.gain ?? 1,
		crossfade: options?.crossfade ?? 0,
		fadeIn: options?.fadeIn ?? 0,
		fadeOut: options?.fadeOut ?? 0,
		order: options?.order ?? 'ordered',
		playlistLooping: options?.playlistLooping ?? true,
		trackLooping: options?.trackLooping ?? false,
		stopMode: options?.stopMode ?? 'resetPlaylist',
		tracks,
		includedSubdirectories: options?.includedSubdirectories ?? [],
		background,
	};
}

/**
 * @param {Partial<import('./validate.js').BackgroundStyle> | undefined} options
 * @returns {import('./validate.js').BackgroundStyle}
 */
function backgroundStyleOf(options) {
	/** @type {import('./validate.js').BackgroundStyle} */
	const style = { ...DEFAULT_BACKGROUND_STYLE };
	for (const key of BACKGROUND_STYLE_KEYS) {
		style[key] = options?.[key] ?? style[key];
	}
	return style;
}

/**
 * @param {Pick<ScannedAudio, 'id' | 'name' | 'format' | 'size' | 'absolutePath'>} scanned
 * @param {AudioOptions | undefined} options
 * @returns {AudioFile}
 */
export function audioFileOf({ id, name, format, size, absolutePath }, options) {
	return {
		id,
		title: options?.title ?? name,
		format,
		size,
		gain: options?.gain ?? 1,
		duration: options?.duration ?? null,
		startAt: options?.startAt ?? 0,
		endAt: options?.endAt ?? null,
		fadeIn: options?.fadeIn ?? 0,
		fadeOut: options?.fadeOut ?? 0,
		// Only downloads wrote a source before origins existed.
		source: options?.source ? { origin: 'download', ...options.source } : null,
		absolutePath,
		background: null,
		...backgroundStyleOf(options),
	};
}
