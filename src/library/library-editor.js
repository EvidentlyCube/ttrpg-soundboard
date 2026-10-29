import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { safeFileName, uniqueName } from '../downloads/file-names.js';
import { audioFormatOf } from './classify.js';
import { measureIfNeeded } from './durations.js';
import { ValidationError } from './errors.js';
import { exists, mergeDirectory, moveAudioFile, TRASH_DIRECTORY, trashDirectoryFor } from './file-moves.js';
import { audioFileOf, playlistOf } from './library.js';
import { readValidatedJson, updateJsonFile, writeJsonAtomic } from './options-store.js';
import { sortBy } from './sort.js';
import { findInTrash, purgeAudioFile, purgeIfEmpty, purgePlaylistFolder, readTrash } from './trash.js';
import { checkClip, isPlainObject, validateAudioOptions, validatePlaylistOptions } from './validate.js';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./library.js').AudioFile} AudioFile */
/** @typedef {import('./library.js').Playlist} Playlist */
/** @typedef {import('./settings-store.js').FileUpdater} FileUpdater */
/**
 * @typedef {{ title?: string, gain?: number, crossfade?: number, fadeIn?: number, fadeOut?: number, startAt?: number,
 * 	endAt?: number | null, order?: import('./validate.js').PlaybackOrder, playlistLooping?: boolean, trackLooping?: boolean,
 * 	stopMode?: import('./validate.js').StopMode }} OptionChanges
 */

/** @typedef {{ title: string, source: import('./validate.js').Source }} NewFileOptions */
/** @typedef {{ written: string[] }} Addition `written` lists every file created, for the change watcher's baseline */
/**
 * @typedef {{ type: 'library.removed', soundId: string }
 * 	| { type: 'library.removed', trackId: string, playlistId: string }
 * 	| { type: 'library.removed', playlistId: string }
 * 	| { type: 'library.added', sound: AudioFile }
 * 	| { type: 'library.added', playlist: Playlist }} LibraryChange
 */
/**
 * @typedef {object} Rearrangement what a deletion or a move did
 * @property {LibraryChange[]} changes in the order they happened, for the pages
 * @property {string[]} removed files that left the root, for the change watcher's baseline
 * @property {[string, string][]} renamed files moved within the root
 */
/** @typedef {import('./trash.js').TrashItem} TrashItem */
/** @typedef {import('./trash.js').TrashedFile} TrashedFile */
/** @typedef {import('./trash.js').TrashedPlaylist} TrashedPlaylist */
/** @typedef {<T extends import('./change-watcher.js').FileChanges>(task: () => Promise<T>) => Promise<T>} FilesWriter */

/** @type {readonly ('crossfade' | 'fadeIn' | 'fadeOut')[]} */
const SECONDS_KEYS = ['crossfade', 'fadeIn', 'fadeOut'];

/** The only options the app itself changes, per kind of item; anything else in a request is rejected. */
const EDITABLE = {
	sound: { keys: ['title', 'gain', 'startAt', 'endAt', 'fadeIn', 'fadeOut'], validate: validateAudioOptions },
	playlist: { keys: ['title', 'gain', ...SECONDS_KEYS, 'order', 'playlistLooping', 'trackLooping', 'stopMode'], validate: validatePlaylistOptions },
	track: { keys: ['title', 'gain', 'startAt', 'endAt'], validate: validateAudioOptions },
};

/** The id does not belong to a sound in the library. */
export class UnknownSoundError extends Error {
	/** @param {string} soundId */
	constructor(soundId) {
		super(`Unknown sound "${soundId}"`);
		this.name = 'UnknownSoundError';
	}
}

/** The id does not belong to a track of any playlist in the library. */
export class UnknownTrackError extends Error {
	/** @param {string} trackId */
	constructor(trackId) {
		super(`Unknown track "${trackId}"`);
		this.name = 'UnknownTrackError';
	}
}

/** The id does not belong to a playlist in the library. */
export class UnknownPlaylistError extends Error {
	/** @param {string} playlistId */
	constructor(playlistId) {
		super(`Unknown playlist "${playlistId}"`);
		this.name = 'UnknownPlaylistError';
	}
}

/**
 * Changes the library while the app runs, saving each change to its options file (DESIGN.md §2.3). Writes to one file
 * never overlap: they run in the order they were requested, so the file always ends with the newest values.
 */
export class LibraryEditor {
	#library;
	#updateFile;
	#writeFiles;
	/** The last write queued for each options file. @type {Map<string, Promise<unknown>>} */
	#writes = new Map();

	/**
	 * @param {Library} library updated in place
	 * @param {{ updateFile?: FileUpdater, writeFiles?: FilesWriter }} [options] `writeFiles` runs deletions and moves,
	 * 	so the change watcher can follow them
	 */
	constructor(library, { updateFile = updateJsonFile, writeFiles = (task) => task() } = {}) {
		this.#library = library;
		this.#updateFile = updateFile;
		this.#writeFiles = writeFiles;
	}

	/**
	 * Validates and saves the change, then applies it to the library. The library is left unchanged if saving fails.
	 * @param {string} soundId
	 * @param {OptionChanges} changes
	 * @returns {Promise<AudioFile>}
	 */
	async updateSound(soundId, changes) {
		const sound = this.#library.sounds.find((entry) => entry.id === soundId);
		if (!sound) {
			throw new UnknownSoundError(soundId);
		}
		const normalized = normalizeChanges(changes, EDITABLE.sound);
		// A change to one point must still fit the other one already stored.
		const clipProblems = checkClip({ startAt: sound.startAt, endAt: sound.endAt, ...normalized });
		if (clipProblems.length > 0) {
			throw new ValidationError(null, clipProblems);
		}
		// Sound options files sit next to their audio file with ".json" appended (DESIGN.md §2.1).
		await this.#queueWrite(`${sound.absolutePath}.json`, (current) => ({ ...current, ...normalized }));
		Object.assign(sound, normalized);
		if (normalized.title !== undefined) {
			this.#library.sounds = sortBy(this.#library.sounds, (entry) => entry.title);
		}
		return sound;
	}

	/**
	 * Like `updateSound`, for a track; only its title, gain and start and end points can change. Tracks keep their
	 * path order (DESIGN.md §2.2), so nothing is sorted again.
	 * @param {string} trackId
	 * @param {OptionChanges} changes
	 * @returns {Promise<AudioFile>}
	 */
	async updateTrack(trackId, changes) {
		const track = this.#library.playlists.flatMap((playlist) => playlist.tracks).find((entry) => entry.id === trackId);
		if (!track) {
			throw new UnknownTrackError(trackId);
		}
		const normalized = normalizeChanges(changes, EDITABLE.track);
		const clipProblems = checkClip({ startAt: track.startAt, endAt: track.endAt, ...normalized });
		if (clipProblems.length > 0) {
			throw new ValidationError(null, clipProblems);
		}
		await this.#queueWrite(`${track.absolutePath}.json`, (current) => ({ ...current, ...normalized }));
		Object.assign(track, normalized);
		return track;
	}

	/**
	 * Like `updateSound`, for a playlist; its other options, such as `includedSubdirectories`, are left as they are.
	 * @param {string} playlistId
	 * @param {OptionChanges} changes
	 * @returns {Promise<Playlist>}
	 */
	async updatePlaylist(playlistId, changes) {
		const playlist = this.#library.playlists.find((entry) => entry.id === playlistId);
		if (!playlist) {
			throw new UnknownPlaylistError(playlistId);
		}
		const normalized = normalizeChanges(changes, EDITABLE.playlist);
		// A playlist's options file is "<directory>.json" in the root (DESIGN.md §2.1).
		await this.#queueWrite(join(this.#library.root, `${playlist.id}.json`), (current) => ({ ...current, ...normalized }));
		Object.assign(playlist, normalized);
		if (normalized.title !== undefined) {
			this.#library.playlists = sortBy(this.#library.playlists, (entry) => entry.title);
		}
		return playlist;
	}

	/**
	 * @param {string} playlistId
	 * @returns {Playlist | undefined}
	 */
	playlist(playlistId) {
		return this.#library.playlists.find((entry) => entry.id === playlistId);
	}

	/**
	 * Moves a finished download into the root as a new sound and writes its options file.
	 * @param {string} from the file, on the same file system as the root
	 * @param {string} name what to call it; ` (2)` and so on is added when the name is taken
	 * @param {NewFileOptions} options
	 * @returns {Promise<Addition & { sound: AudioFile }>}
	 */
	async addSound(from, name, options) {
		const { file, written } = await this.#place(from, '', name, options);
		this.#library.sounds = sortBy([...this.#library.sounds, file], (entry) => entry.title);
		this.#library.files.set(file.id, file);
		return { sound: file, written };
	}

	/**
	 * Moves a finished download into a playlist's directory as a new track. Tracks sort by path (DESIGN.md §2.2), so it
	 * takes its place by name.
	 * @param {string} playlistId
	 * @param {string} from
	 * @param {string} name
	 * @param {NewFileOptions} options
	 * @returns {Promise<Addition & { playlist: Playlist, track: AudioFile }>}
	 */
	async addTrack(playlistId, from, name, options) {
		const playlist = this.#library.playlists.find((entry) => entry.id === playlistId);
		if (!playlist) {
			throw new UnknownPlaylistError(playlistId);
		}
		const { file, written } = await this.#place(from, playlist.id, name, options);
		playlist.tracks = sortBy([...playlist.tracks, file], (track) => track.id);
		this.#library.files.set(file.id, file);
		return { playlist, track: file, written };
	}

	/**
	 * Creates a playlist together with its first track, so an empty playlist never exists. Its directory is named after
	 * the title.
	 * @param {string} title
	 * @param {string} from the first track
	 * @param {string} name
	 * @param {NewFileOptions} options
	 * @returns {Promise<Addition & { playlist: Playlist, track: AudioFile }>}
	 */
	async createPlaylist(title, from, name, options) {
		const trimmed = title.trim();
		if (trimmed === '') {
			throw new ValidationError(null, ['"title" must be a non-empty string']);
		}
		const root = this.#library.root;
		// "<directory>.json" next to it would become its options file, so that name counts as taken too.
		const id = await uniqueName(safeFileName(trimmed, 'Playlist'), async (candidate) => (
			await exists(join(root, candidate)) || exists(join(root, `${candidate}.json`))
		));
		await mkdir(join(root, id));
		const optionsPath = join(root, `${id}.json`);
		/** @type {import('./validate.js').PlaylistOptions} */
		const playlistOptions = { title: trimmed, includedSubdirectories: [] };
		await writeJsonAtomic(optionsPath, playlistOptions);
		const { file, written } = await this.#place(from, id, name, options);
		const playlist = playlistOf(id, playlistOptions, [file]);
		this.#library.playlists = sortBy([...this.#library.playlists, playlist], (entry) => entry.title);
		this.#library.files.set(file.id, file);
		return { playlist, track: file, written: [optionsPath, ...written] };
	}

	/**
	 * Moves a sound into the trash, with its options file and waveform (DESIGN.md §2.5).
	 * @param {string} soundId
	 * @returns {Promise<Rearrangement>}
	 */
	async deleteSound(soundId) {
		const sound = this.#sound(soundId);
		this.#takeSound(sound);
		return this.#rearrange({ files: [sound] }, () => this.#putSound(sound), async () => {
			const { renamed } = await moveAudioFile(sound.absolutePath, trashDirectoryFor(this.#library.root, sound.id));
			return { changes: [{ type: 'library.removed', soundId }], removed: renamed.map(([from]) => from), renamed: [] };
		});
	}

	/**
	 * Moves a track into the trash. A playlist's only track takes the playlist with it, so an empty playlist never
	 * exists.
	 * @param {string} trackId
	 * @returns {Promise<Rearrangement>}
	 */
	async deleteTrack(trackId) {
		const { playlist, track } = this.#track(trackId);
		if (playlist.tracks.length === 1) {
			return this.deletePlaylist(playlist.id);
		}
		this.#takeTrack(playlist, track);
		return this.#rearrange({ files: [track] }, () => this.#putTrack(playlist, track), async () => {
			const { renamed } = await moveAudioFile(track.absolutePath, trashDirectoryFor(this.#library.root, track.id));
			return {
				changes: [{ type: 'library.removed', trackId, playlistId: playlist.id }],
				removed: renamed.map(([from]) => from),
				renamed: [],
			};
		});
	}

	/**
	 * Moves a playlist's whole directory and its options file into the trash, merging the directory into one of the same
	 * name already there. The options file replaces an older one.
	 * @param {string} playlistId
	 * @returns {Promise<Rearrangement>}
	 */
	async deletePlaylist(playlistId) {
		const playlist = this.#playlist(playlistId);
		this.#takePlaylist(playlist);
		return this.#rearrange({ files: playlist.tracks, playlist }, () => this.#putPlaylist(playlist), async () => ({
			changes: [{ type: 'library.removed', playlistId }],
			removed: await this.#trashPlaylist(playlist),
			renamed: [],
		}));
	}

	/**
	 * Moves a sound into a playlist's directory, where it becomes a track. Its options file and waveform go with it.
	 * @param {string} soundId
	 * @param {string} playlistId
	 * @returns {Promise<Rearrangement>}
	 */
	async moveSound(soundId, playlistId) {
		const sound = this.#sound(soundId);
		const target = this.#playlist(playlistId);
		this.#takeSound(sound);
		return this.#rearrange({ files: [sound] }, () => this.#putSound(sound), async () => {
			const { path, renamed } = await moveAudioFile(sound.absolutePath, join(this.#library.root, target.id));
			this.#putTrack(target, { ...sound, id: `${target.id}/${basename(path)}`, absolutePath: path });
			return {
				changes: [{ type: 'library.removed', soundId }, { type: 'library.added', playlist: target }],
				removed: [],
				renamed,
			};
		});
	}

	/**
	 * Moves a track into another playlist's directory, or into the root as a sound. A track from a nested subdirectory
	 * lands in the top level. A playlist's only track takes the playlist with it, as `deleteTrack` does.
	 * @param {string} trackId
	 * @param {string | null} playlistId null for the sound effects
	 * @returns {Promise<Rearrangement>}
	 */
	async moveTrack(trackId, playlistId) {
		const { playlist: source, track } = this.#track(trackId);
		if (playlistId === source.id) {
			throw new ValidationError(null, ['The track is already in that playlist']);
		}
		const target = playlistId === null ? null : this.#playlist(playlistId);
		const last = source.tracks.length === 1;
		this.#takeTrack(source, track);
		if (last) {
			this.#takePlaylist(source);
		}
		const undo = () => {
			this.#putTrack(source, track);
			if (last) {
				this.#putPlaylist(source);
			}
		};
		return this.#rearrange({ files: [track], playlist: last ? source : undefined }, undo, async () => {
			const directory = target === null ? this.#library.root : join(this.#library.root, target.id);
			const { path, renamed } = await moveAudioFile(track.absolutePath, directory);
			const name = basename(path);
			const moved = { ...track, id: target === null ? name : `${target.id}/${name}`, absolutePath: path };
			/** @type {LibraryChange} */
			const added = target === null ? { type: 'library.added', sound: moved } : { type: 'library.added', playlist: target };
			if (target === null) {
				this.#putSound(moved);
			} else {
				this.#putTrack(target, moved);
			}
			return {
				changes: [
					last ? { type: 'library.removed', playlistId: source.id } : { type: 'library.removed', trackId, playlistId: source.id },
					added,
				],
				removed: last ? await this.#trashPlaylist(source) : [],
				renamed,
			};
		});
	}

	/**
	 * Restores an item from the trash (DESIGN.md §2.5), or everything in it: whole playlists first, then sounds.
	 * @param {TrashItem | 'all'} item
	 * @returns {Promise<{ changes: LibraryChange[], written: string[] }>}
	 */
	restoreFromTrash(item) {
		return this.#writeFiles(async () => {
			const listing = await readTrash(this.#library.root);
			/** @type {{ changes: LibraryChange[], written: string[] }} */
			const result = { changes: [], written: [] };
			/** @param {{ change: LibraryChange, written: string[] }} restored */
			const collect = ({ change, written }) => {
				result.changes.push(change);
				result.written.push(...written);
			};
			if (item === 'all') {
				for (const playlist of listing.playlists) {
					collect(await this.#restorePlaylist(playlist));
				}
				for (const sound of listing.sounds) {
					collect(await this.#restoreSound(sound));
				}
				return result;
			}
			const found = findInTrash(listing, item);
			if (item.kind === 'sound') {
				collect(await this.#restoreSound(/** @type {TrashedFile} */ (found)));
			} else if (item.kind === 'track') {
				collect(await this.#restoreTrack(/** @type {TrashedFile} */ (found)));
			} else {
				collect(await this.#restorePlaylist(/** @type {TrashedPlaylist} */ (found)));
			}
			return result;
		});
	}

	/**
	 * Deletes an item in the trash for good, or the whole trash. A trashed playlist that has no audio files left goes
	 * with its last track.
	 * @param {TrashItem | 'all'} item
	 * @returns {Promise<void>}
	 */
	async purgeFromTrash(item) {
		const root = this.#library.root;
		// Nothing here is in the change watcher's baseline; going through it only makes this take its turn.
		await this.#writeFiles(async () => {
			if (item === 'all') {
				await rm(join(root, TRASH_DIRECTORY), { recursive: true, force: true });
				return {};
			}
			const found = findInTrash(await readTrash(root), item);
			if (item.kind === 'playlist') {
				await purgePlaylistFolder(/** @type {TrashedPlaylist} */ (found));
			} else {
				await purgeAudioFile(found.absolutePath);
			}
			if (item.kind === 'track') {
				await purgeIfEmpty(root, playlistIdOf(item.id));
			}
			return {};
		});
	}

	/** @param {TrashedFile} sound */
	async #restoreSound(sound) {
		const { file, written } = await this.#restoreFile(sound.absolutePath, '');
		this.#putSound(file);
		return { change: /** @type {LibraryChange} */ ({ type: 'library.added', sound: file }), written };
	}

	/**
	 * Puts a track into the top level of its playlist, which is created from the trashed options file when it is gone.
	 * @param {TrashedFile} track
	 */
	async #restoreTrack(track) {
		const trashedId = playlistIdOf(track.id);
		const trashedOptionsPath = join(this.#library.root, TRASH_DIRECTORY, `${trashedId}.json`);
		const options = await readOptional(track.absolutePath, validateAudioOptions);
		const target = await this.#restoreTarget(trashedId, trashedOptionsPath);
		const { file, written } = await this.#restoreFile(track.absolutePath, target.playlist.id, options);
		this.#adoptTracks(target, [file]);
		await purgeIfEmpty(this.#library.root, trashedId);
		return { change: /** @type {LibraryChange} */ ({ type: 'library.added', playlist: target.playlist }), written: [...target.written, ...written] };
	}

	/**
	 * Moves a playlist back whole when its name is free. Otherwise its tracks go into the playlist of that name, whose
	 * options stay as they are, and the rest of the trashed folder is deleted.
	 * @param {TrashedPlaylist} trashed
	 */
	async #restorePlaylist(trashed) {
		const root = this.#library.root;
		const options = await readOptional(trashed.optionsPath.slice(0, -'.json'.length), validatePlaylistOptions);
		// Every options file is checked before anything moves, so a broken one can't leave the playlist half restored.
		/** @type {(import('./validate.js').AudioOptions | undefined)[]} */
		const trackOptions = [];
		for (const track of trashed.tracks) {
			trackOptions.push(await readOptional(track.absolutePath, validateAudioOptions));
		}
		const isFree = !this.playlist(trashed.id)
			&& !(await exists(join(root, trashed.id)))
			&& !(await exists(join(root, `${trashed.id}.json`)));
		if (isFree) {
			const written = [];
			await rename(trashed.absolutePath, join(root, trashed.id));
			if (options) {
				await rename(trashed.optionsPath, join(root, `${trashed.id}.json`));
				written.push(join(root, `${trashed.id}.json`));
			}
			/** @type {AudioFile[]} */
			const tracks = [];
			for (const [index, track] of trashed.tracks.entries()) {
				const adopted = await this.#adoptFile(join(root, ...track.id.split('/')), track.id, trackOptions[index]);
				tracks.push(adopted.file);
				written.push(...adopted.written);
			}
			const playlist = playlistOf(trashed.id, options, tracks);
			this.#putPlaylist(playlist);
			return { change: /** @type {LibraryChange} */ ({ type: 'library.added', playlist }), written };
		}
		const target = await this.#restoreTarget(trashed.id, trashed.optionsPath);
		const written = [...target.written];
		/** @type {AudioFile[]} */
		const files = [];
		for (const [index, track] of trashed.tracks.entries()) {
			const restored = await this.#restoreFile(track.absolutePath, target.playlist.id, trackOptions[index]);
			files.push(restored.file);
			written.push(...restored.written);
		}
		this.#adoptTracks(target, files);
		await purgePlaylistFolder(trashed);
		return { change: /** @type {LibraryChange} */ ({ type: 'library.added', playlist: target.playlist }), written };
	}

	/**
	 * The playlist a trashed track goes back into: the one of that name, or a new one with a copy of the trashed
	 * options file, so tracks still in the trash keep it. A name taken by a folder or file the library doesn't show gets
	 * ` (2)`.
	 * @param {string} trashedId
	 * @param {string} trashedOptionsPath
	 * @returns {Promise<{ playlist: Playlist, isNew: boolean, written: string[] }>}
	 */
	async #restoreTarget(trashedId, trashedOptionsPath) {
		const existing = this.playlist(trashedId);
		if (existing) {
			return { playlist: existing, isNew: false, written: [] };
		}
		const root = this.#library.root;
		const trashed = await readOptional(trashedOptionsPath.slice(0, -'.json'.length), validatePlaylistOptions);
		const id = await uniqueName(trashedId, async (candidate) => (
			await exists(join(root, candidate)) || exists(join(root, `${candidate}.json`))
		));
		await mkdir(join(root, id));
		const optionsPath = join(root, `${id}.json`);
		/** @type {import('./validate.js').PlaylistOptions} */
		const options = trashed ?? { title: trashedId, includedSubdirectories: [] };
		await writeJsonAtomic(optionsPath, options);
		return { playlist: playlistOf(id, options, []), isNew: true, written: [optionsPath] };
	}

	/**
	 * @param {{ playlist: Playlist, isNew: boolean }} target
	 * @param {AudioFile[]} files
	 */
	#adoptTracks({ playlist, isNew }, files) {
		if (isNew) {
			playlist.tracks = sortBy(files, (entry) => entry.id);
			this.#putPlaylist(playlist);
			return;
		}
		for (const file of files) {
			this.#putTrack(playlist, file);
		}
	}

	/**
	 * Moves a trashed audio file, with its companions, into the root or a playlist's top level under a free name.
	 * @param {string} from
	 * @param {string} directoryId '' for the root, otherwise a playlist id
	 * @param {import('./validate.js').AudioOptions} [options] read beforehand; read here when not given
	 */
	async #restoreFile(from, directoryId, options) {
		const checked = options ?? await readOptional(from, validateAudioOptions);
		const directory = directoryId === '' ? this.#library.root : join(this.#library.root, directoryId);
		const { path } = await moveAudioFile(from, directory);
		const name = basename(path);
		return this.#adoptFile(path, directoryId === '' ? name : `${directoryId}/${name}`, checked);
	}

	/**
	 * Builds the library's entry for an audio file back in the root, measuring it when its options file has no current
	 * duration, as bootstrap does (DESIGN.md §3.5).
	 * `written` names the audio file and its options file, which it always has afterwards. Its waveform is left out:
	 * the change watcher never looks at waveforms, and one in its baseline would count as gone (DESIGN.md §5.3).
	 * @param {string} absolutePath
	 * @param {string} id
	 * @param {import('./validate.js').AudioOptions | undefined} options
	 * @returns {Promise<{ file: AudioFile, written: string[] }>}
	 */
	async #adoptFile(absolutePath, id, options) {
		const name = basename(absolutePath);
		const format = audioFormatOf(name);
		if (format === null) {
			throw new Error(`Not a supported audio file: ${name}`);
		}
		const { size, mtime } = await stat(absolutePath);
		const optionsPath = `${absolutePath}.json`;
		const scanned = { id, name, format, size, modified: mtime.toISOString(), absolutePath, optionsPath, hasOptions: options !== undefined };
		const measurement = await measureIfNeeded(scanned, options);
		if (!measurement) {
			return { file: audioFileOf(scanned, options), written: [absolutePath, optionsPath] };
		}
		/** @type {import('./validate.js').AudioOptions} */
		const measured = { ...(options ?? { title: name }), ...measurement };
		if (options) {
			await updateJsonFile(optionsPath, (current) => ({ ...current, ...measurement }));
		} else {
			await writeJsonAtomic(optionsPath, measured);
		}
		return { file: audioFileOf(scanned, measured), written: [absolutePath, optionsPath] };
	}

	/**
	 * The item is already out of the library, so late saves fail as unknown; saves queued before wait to finish, so none
	 * can recreate an options file at the old path. A failure puts the item back.
	 * Waiting happens before the task is handed to `writeFiles`, because the change watcher runs saves and tasks in turn.
	 * @param {{ files: AudioFile[], playlist?: Playlist }} owners whose options files must be written first
	 * @param {() => void} undo
	 * @param {() => Promise<Rearrangement>} task
	 * @returns {Promise<Rearrangement>}
	 */
	async #rearrange({ files, playlist }, undo, task) {
		const paths = files.map((file) => `${file.absolutePath}.json`);
		if (playlist) {
			paths.push(join(this.#library.root, `${playlist.id}.json`));
		}
		await Promise.allSettled(paths.map((path) => this.#writes.get(path)));
		try {
			return await this.#writeFiles(task);
		} catch (error) {
			undo();
			throw error;
		}
	}

	/**
	 * @param {Playlist} playlist already out of the library
	 * @returns {Promise<string[]>} the files that left the root
	 */
	async #trashPlaylist(playlist) {
		const root = this.#library.root;
		const optionsPath = join(root, `${playlist.id}.json`);
		const trash = join(root, TRASH_DIRECTORY);
		await mergeDirectory(join(root, playlist.id), trash);
		if (await exists(optionsPath)) {
			await rename(optionsPath, join(trash, `${playlist.id}.json`));
		}
		return [...playlist.tracks.flatMap((track) => [track.absolutePath, `${track.absolutePath}.json`]), optionsPath];
	}

	/** @param {string} soundId */
	#sound(soundId) {
		const sound = this.#library.sounds.find((entry) => entry.id === soundId);
		if (!sound) {
			throw new UnknownSoundError(soundId);
		}
		return sound;
	}

	/** @param {string} trackId */
	#track(trackId) {
		for (const playlist of this.#library.playlists) {
			const track = playlist.tracks.find((entry) => entry.id === trackId);
			if (track) {
				return { playlist, track };
			}
		}
		throw new UnknownTrackError(trackId);
	}

	/** @param {string} playlistId */
	#playlist(playlistId) {
		const playlist = this.#library.playlists.find((entry) => entry.id === playlistId);
		if (!playlist) {
			throw new UnknownPlaylistError(playlistId);
		}
		return playlist;
	}

	/** @param {AudioFile} sound */
	#takeSound(sound) {
		this.#library.sounds = this.#library.sounds.filter((entry) => entry !== sound);
		this.#library.files.delete(sound.id);
	}

	/** @param {AudioFile} sound */
	#putSound(sound) {
		this.#library.sounds = sortBy([...this.#library.sounds, sound], (entry) => entry.title);
		this.#library.files.set(sound.id, sound);
	}

	/**
	 * @param {Playlist} playlist
	 * @param {AudioFile} track
	 */
	#takeTrack(playlist, track) {
		playlist.tracks = playlist.tracks.filter((entry) => entry !== track);
		this.#library.files.delete(track.id);
	}

	/**
	 * @param {Playlist} playlist
	 * @param {AudioFile} track
	 */
	#putTrack(playlist, track) {
		playlist.tracks = sortBy([...playlist.tracks, track], (entry) => entry.id);
		this.#library.files.set(track.id, track);
	}

	/** @param {Playlist} playlist */
	#takePlaylist(playlist) {
		this.#library.playlists = this.#library.playlists.filter((entry) => entry !== playlist);
		for (const track of playlist.tracks) {
			this.#library.files.delete(track.id);
		}
	}

	/** @param {Playlist} playlist */
	#putPlaylist(playlist) {
		this.#library.playlists = sortBy([...this.#library.playlists, playlist], (entry) => entry.title);
		for (const track of playlist.tracks) {
			this.#library.files.set(track.id, track);
		}
	}

	/**
	 * Moves a file into place under a free name, measures it, and writes its options file.
	 * @param {string} from
	 * @param {string} directoryId '' for the root, otherwise a playlist id
	 * @param {string} name
	 * @param {NewFileOptions} options
	 * @returns {Promise<{ file: AudioFile, written: string[] }>}
	 */
	async #place(from, directoryId, name, { title, source }) {
		const format = audioFormatOf(name);
		if (format === null) {
			throw new Error(`Not a supported audio file: ${name}`);
		}
		const directory = directoryId === '' ? this.#library.root : join(this.#library.root, directoryId);
		// The options file must be free as well, or an old one would be taken over.
		const finalName = await uniqueName(name, async (candidate) => (
			await exists(join(directory, candidate)) || exists(join(directory, `${candidate}.json`))
		));
		const absolutePath = join(directory, finalName);
		await rename(from, absolutePath);
		const { size, mtime } = await stat(absolutePath);
		const id = directoryId === '' ? finalName : `${directoryId}/${finalName}`;
		const scanned = { id, name: finalName, format, size, modified: mtime.toISOString(), absolutePath, optionsPath: `${absolutePath}.json`, hasOptions: false };
		/** @type {import('./validate.js').AudioOptions} */
		const fileOptions = { title: title.trim() || finalName, source, ...(await measureIfNeeded(scanned, undefined)) };
		await writeJsonAtomic(scanned.optionsPath, fileOptions);
		return { file: audioFileOf(scanned, fileOptions), written: [absolutePath, scanned.optionsPath] };
	}

	/**
	 * @param {string} path
	 * @param {import('./options-store.js').JsonUpdate} update
	 */
	#queueWrite(path, update) {
		const write = (this.#writes.get(path) ?? Promise.resolve())
			.catch(() => {})
			.then(() => this.#updateFile(path, update));
		this.#writes.set(path, write);
		const forget = () => {
			if (this.#writes.get(path) === write) {
				this.#writes.delete(path);
			}
		};
		write.then(forget, forget);
		return write;
	}
}

/**
 * Reads the options file next to a file or folder (`<path>.json`) when there is one.
 * @template T
 * @param {string} path
 * @param {(value: unknown) => string[]} validate
 * @returns {Promise<T | undefined>}
 */
async function readOptional(path, validate) {
	const optionsPath = `${path}.json`;
	if (!(await exists(optionsPath))) {
		return undefined;
	}
	return /** @type {T} */ (await readValidatedJson(optionsPath, validate));
}

/**
 * A track's id inside the trash starts with its playlist's folder.
 * @param {string} trackId
 */
function playlistIdOf(trackId) {
	return trackId.split('/')[0];
}

/**
 * Checks a change with the rules of that kind of options file, then trims the title and rounds the numbers.
 * @param {unknown} changes
 * @param {{ keys: string[], validate: (value: unknown) => string[] }} editable
 * @returns {OptionChanges}
 */
function normalizeChanges(changes, { keys, validate }) {
	if (!isPlainObject(changes)) {
		throw new ValidationError(null, ['must be a JSON object']);
	}
	const unknown = Object.keys(changes).filter((key) => !keys.includes(key));
	const problems = [...unknown.map((key) => `Unknown option "${key}"`), ...validate(changes)];
	if (problems.length > 0) {
		throw new ValidationError(null, problems);
	}
	/** @type {OptionChanges} */
	const normalized = {};
	if (typeof changes.title === 'string') {
		normalized.title = changes.title.trim();
	}
	if (typeof changes.gain === 'number') {
		normalized.gain = Math.round(changes.gain * 10_000) / 10_000;
	}
	// Every time keeps whole milliseconds, which is what the dialogs show.
	for (const key of SECONDS_KEYS) {
		const seconds = changes[key];
		if (typeof seconds === 'number') {
			normalized[key] = Math.round(seconds * 1000) / 1000;
		}
	}
	if (typeof changes.order === 'string') {
		normalized.order = /** @type {import('./validate.js').PlaybackOrder} */ (changes.order);
	}
	if (typeof changes.playlistLooping === 'boolean') {
		normalized.playlistLooping = changes.playlistLooping;
	}
	if (typeof changes.trackLooping === 'boolean') {
		normalized.trackLooping = changes.trackLooping;
	}
	if (typeof changes.stopMode === 'string') {
		normalized.stopMode = /** @type {import('./validate.js').StopMode} */ (changes.stopMode);
	}
	if (typeof changes.startAt === 'number') {
		normalized.startAt = Math.round(changes.startAt * 1000) / 1000;
	}
	if (typeof changes.endAt === 'number' || changes.endAt === null) {
		normalized.endAt = changes.endAt === null ? null : Math.round(changes.endAt * 1000) / 1000;
	}
	return normalized;
}
