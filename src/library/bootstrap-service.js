import { readSourceLink, readTitle } from '../metadata/index.js';
import { ValidationError } from './errors.js';
import { isMeasured, measureIfNeeded } from './durations.js';
import { buildLibrary } from './library.js';
import { startupProblems } from './problems.js';
import { readValidatedJson, updateJsonFile, writeJsonAtomic } from './options-store.js';
import { scanAudioDirectory } from './scanner.js';
import { INITIAL_SETTINGS_FILE, SettingsStore } from './settings-store.js';
import { guessSource, titleWithoutId, videoIdFromFileName } from './sources.js';
import { validateAudioOptions, validatePlaylistOptions, validateSettingsFile } from './validate.js';

/** @typedef {import('./library.js').Library} Library */
/** @typedef {import('./scanner.js').ScanResult} ScanResult */
/** @typedef {import('./scanner.js').ScannedAudio} ScannedAudio */
/** @typedef {import('./scanner.js').ScannedPlaylist} ScannedPlaylist */
/** @typedef {import('./scanner.js').ScanWarning} ScanWarning */
/** @typedef {import('./validate.js').AudioOptions} AudioOptions */
/** @typedef {import('./validate.js').PlaylistOptions} PlaylistOptions */

/** @typedef {{ confirm: (question: string) => Promise<boolean> }} Prompter */

/**
 * @typedef {object} Reporter
 * @property {(errors: ValidationError[]) => void} validationErrors
 * @property {(warnings: ScanWarning[]) => void} warnings
 * @property {(count: number) => void} largeFolder a folder without `.soundboard` holds more than `LARGE_FOLDER_FILES` audio
 * 	files; sent before the question
 * @property {(paths: string[]) => void} nestedDirectories root-relative paths, such as `Combat/Boss`
 * @property {(titles: { path: string, title: string }[]) => void} metadataTitles
 * @property {(count: number) => void} optionsGenerated
 * @property {(count: number) => void} measuringDurations sent before files are read to measure their durations
 * @property {(done: number, total: number) => void} measured sent after each file whose duration was measured
 * @property {(library: Library) => void} libraryLoaded
 */

/**
 * @typedef {{ status: 'ready', library: Library, settings: SettingsStore, scan: ScanResult, problems: import('./problems.js').Problem[] }
 * 	| { status: 'invalid', errors: ValidationError[] }
 * 	| { status: 'cancelled' }} BootstrapOutcome
 * @typedef {Exclude<BootstrapOutcome, { status: 'cancelled' }> | { status: 'noSettings' }} RefreshOutcome
 */

export const NESTED_DIRECTORIES_QUESTION = 'Nested directories will be merged into their playlists. Continue?';
export const METADATA_TITLES_QUESTION = 'Use these titles in the generated options files?';
export const LARGE_FOLDER_QUESTION = 'This folder holds a lot of audio files. Create an options file next to each of them?';
/** More audio files than this in a folder that isn't a soundboard yet are asked about before anything is written. */
export const LARGE_FOLDER_FILES = 5000;

/**
 * Prepares an audio directory before the server starts (DESIGN.md §3): validates every options file, asks about
 * nested directories and metadata titles, and writes the missing options files.
 */
export class BootstrapService {
	#prompter;
	#reporter;
	#updateSettingsFile;

	/**
	 * @param {object} ports
	 * @param {Prompter} ports.prompter
	 * @param {Reporter} ports.reporter
	 * @param {import('./settings-store.js').FileUpdater} [ports.updateSettingsFile] how the settings store saves `.soundboard`
	 */
	constructor({ prompter, reporter, updateSettingsFile }) {
		this.#prompter = prompter;
		this.#reporter = reporter;
		this.#updateSettingsFile = updateSettingsFile;
	}

	/**
	 * @param {string} root
	 * @returns {Promise<BootstrapOutcome>}
	 */
	async run(root) {
		const outcome = await this.#load(root, { interactive: true });
		if (outcome.status === 'noSettings') {
			throw new Error('Only a refresh stops without a settings file');
		}
		return outcome;
	}

	/**
	 * Builds the library again while the app runs, as a later start would but without questions: new nested directories
	 * are merged without being recorded, so the next start still asks about them. Never used for a first run.
	 * @param {string} root
	 * @returns {Promise<RefreshOutcome>}
	 */
	async refresh(root) {
		const outcome = await this.#load(root, { interactive: false });
		if (outcome.status === 'cancelled') {
			throw new Error('A refresh never asks, so it cannot be cancelled');
		}
		return outcome;
	}

	/**
	 * @param {string} root
	 * @param {{ interactive: boolean }} options
	 * @returns {Promise<BootstrapOutcome | { status: 'noSettings' }>}
	 */
	async #load(root, { interactive }) {
		const scan = await scanAudioDirectory(root);
		// Without `.soundboard` this would be a first run, which has questions to ask.
		if (!interactive && !scan.hasSettingsFile) {
			return { status: 'noSettings' };
		}
		const { optionsByPath, errors } = await loadOptions(scan);
		if (errors.length > 0) {
			this.#reporter.validationErrors(errors);
			return { status: 'invalid', errors };
		}
		if (scan.warnings.length > 0) {
			this.#reporter.warnings(scan.warnings);
		}

		// Empty playlists are hidden from the UI, so asking about them or creating their options would only be noise.
		const playlists = scan.playlists.filter((playlist) => playlist.tracks.length > 0);
		const audioFiles = [...scan.sounds, ...playlists.flatMap((playlist) => playlist.tracks)];
		// A first run writes next to every file, so a folder chosen by mistake, such as a whole music collection, is caught here.
		if (interactive && !scan.hasSettingsFile && audioFiles.length > LARGE_FOLDER_FILES) {
			this.#reporter.largeFolder(audioFiles.length);
			if (!(await this.#prompter.confirm(LARGE_FOLDER_QUESTION))) {
				return { status: 'cancelled' };
			}
		}
		// The library takes every track found, so leaving the new directories unrecorded only defers the question.
		const newSubdirectories = interactive ? findNewSubdirectories(playlists, optionsByPath) : new Map();
		const nestedPaths = [...newSubdirectories].flatMap(([id, subdirectories]) => subdirectories.map((/** @type {string} */ path) => `${id}/${path}`));
		if (nestedPaths.length > 0) {
			this.#reporter.nestedDirectories(nestedPaths);
			if (!(await this.#prompter.confirm(NESTED_DIRECTORIES_QUESTION))) {
				return { status: 'cancelled' };
			}
		}

		const isFirstRun = !scan.hasSettingsFile;
		const missingOptions = audioFiles.filter((audio) => !audio.hasOptions);
		const titles = await this.#chooseTitles(missingOptions, isFirstRun);

		const toMeasure = new Set(audioFiles.filter((audio) => !isMeasured(audio, optionsByPath.get(audio.optionsPath))));
		if (toMeasure.size > 0) {
			this.#reporter.measuringDurations(toMeasure.size);
		}
		let measured = 0;
		/** @param {ScannedAudio} audio */
		const countMeasured = (audio) => {
			if (toMeasure.has(audio)) {
				this.#reporter.measured(++measured, toMeasure.size);
			}
		};

		let written = 0;
		for (const audio of missingOptions) {
			const title = titles.get(audio.id) ?? audio.name;
			/** @type {AudioOptions} */
			const options = { title, ...(await measureIfNeeded(audio, undefined)), ...(await sourceFor(audio, title)) };
			countMeasured(audio);
			await writeJsonAtomic(audio.optionsPath, options);
			optionsByPath.set(audio.optionsPath, options);
			written++;
		}
		for (const audio of audioFiles.filter((file) => file.hasOptions)) {
			const existing = /** @type {AudioOptions | undefined} */ (optionsByPath.get(audio.optionsPath));
			const measurement = await measureIfNeeded(audio, existing);
			countMeasured(audio);
			if (measurement) {
				await updateJsonFile(audio.optionsPath, (current) => ({ ...current, ...measurement }));
				optionsByPath.set(audio.optionsPath, { ...existing, ...measurement });
				written++;
			}
		}
		// Every file gets a source once, so none is examined twice (DESIGN.md §3.3).
		for (const audio of audioFiles.filter((file) => file.hasOptions)) {
			const existing = /** @type {AudioOptions} */ (optionsByPath.get(audio.optionsPath));
			if (existing.source !== undefined) {
				continue;
			}
			const change = await sourceFor(audio, existing.title);
			await updateJsonFile(audio.optionsPath, (current) => ({ ...current, ...change }));
			optionsByPath.set(audio.optionsPath, { ...existing, ...change });
			written++;
		}
		for (const playlist of playlists) {
			const added = newSubdirectories.get(playlist.id) ?? [];
			if (!playlist.hasOptions) {
				/** @type {PlaylistOptions} */
				const options = { title: playlist.id, includedSubdirectories: added };
				await writeJsonAtomic(playlist.optionsPath, options);
				optionsByPath.set(playlist.optionsPath, options);
				written++;
			} else if (added.length > 0) {
				const existing = /** @type {PlaylistOptions} */ (optionsByPath.get(playlist.optionsPath));
				const includedSubdirectories = [...(existing.includedSubdirectories ?? []), ...added];
				await updateJsonFile(playlist.optionsPath, (current) => ({ ...current, includedSubdirectories }));
				optionsByPath.set(playlist.optionsPath, { ...existing, includedSubdirectories });
				written++;
			}
		}
		if (written > 0) {
			this.#reporter.optionsGenerated(written);
		}

		// Written last: if anything above failed, the next start is still treated as a first run.
		if (isFirstRun) {
			await writeJsonAtomic(scan.settingsPath, INITIAL_SETTINGS_FILE);
		}

		const library = buildLibrary(scan, optionsByPath);
		this.#reporter.libraryLoaded(library);
		const settings = await SettingsStore.load(scan.settingsPath, { updateFile: this.#updateSettingsFile });
		return { status: 'ready', library, settings, scan, problems: startupProblems(scan.warnings, library) };
	}

	/**
	 * Reads embedded titles for files that need an options file. On the first run the user decides whether to use them.
	 * @param {ScannedAudio[]} audioFiles
	 * @param {boolean} isFirstRun
	 * @returns {Promise<Map<string, string>>} title by audio id
	 */
	async #chooseTitles(audioFiles, isFirstRun) {
		/** @type {{ path: string, title: string }[]} */
		const found = [];
		for (const audio of audioFiles) {
			const title = await readTitle(audio.absolutePath);
			if (title !== null) {
				found.push({ path: audio.id, title });
			}
		}
		if (found.length === 0) {
			return new Map();
		}
		if (isFirstRun) {
			this.#reporter.metadataTitles(found);
			if (!(await this.#prompter.confirm(METADATA_TITLES_QUESTION))) {
				return new Map();
			}
		}
		return new Map(found.map(({ path, title }) => [path, title]));
	}
}

/**
 * Where a file without a recorded source came from: an id in its name, else a link in its tags, else unknown. An id
 * found in the name is taken out of the title too (DESIGN.md §2.4).
 * @param {ScannedAudio} audio
 * @param {string | undefined} title
 * @returns {Promise<AudioOptions>} what to merge into its options
 */
async function sourceFor(audio, title) {
	const fromName = videoIdFromFileName(audio.name);
	if (fromName !== null) {
		return { source: guessSource(audio.name, null), title: titleWithoutId(title, audio.name, fromName) };
	}
	return { source: guessSource(audio.name, await readSourceLink(audio.absolutePath)) };
}

/**
 * Reads every existing options file and the settings file, collecting all validation errors instead of stopping at the first.
 * @param {ScanResult} scan
 */
async function loadOptions(scan) {
	/** @type {[string, import('./options-store.js').Validator][]} */
	const files = [];
	if (scan.hasSettingsFile) {
		files.push([scan.settingsPath, validateSettingsFile]);
	}
	/** @param {ScannedAudio[]} audioFiles */
	const addAudio = (audioFiles) => {
		files.push(...audioFiles
			.filter((audio) => audio.hasOptions)
			.map((audio) => /** @type {[string, import('./options-store.js').Validator]} */ ([audio.optionsPath, validateAudioOptions])));
	};
	addAudio(scan.sounds);
	for (const playlist of scan.playlists) {
		if (playlist.hasOptions) {
			files.push([playlist.optionsPath, validatePlaylistOptions]);
		}
		addAudio(playlist.tracks);
	}

	/** @type {Map<string, AudioOptions | PlaylistOptions>} */
	const optionsByPath = new Map();
	/** @type {ValidationError[]} */
	const errors = [];
	for (const [path, validate] of files) {
		try {
			const value = await readValidatedJson(path, validate);
			if (path !== scan.settingsPath) {
				optionsByPath.set(path, /** @type {AudioOptions | PlaylistOptions} */ (value));
			}
		} catch (error) {
			if (!(error instanceof ValidationError)) {
				throw error;
			}
			errors.push(error);
		}
	}
	return { optionsByPath, errors };
}

/**
 * @param {ScannedPlaylist[]} playlists
 * @param {Map<string, AudioOptions | PlaylistOptions>} optionsByPath
 * @returns {Map<string, string[]>} subdirectories not yet in each playlist's `includedSubdirectories`, by playlist id
 */
function findNewSubdirectories(playlists, optionsByPath) {
	/** @type {Map<string, string[]>} */
	const result = new Map();
	for (const playlist of playlists) {
		const options = /** @type {PlaylistOptions | undefined} */ (optionsByPath.get(playlist.optionsPath));
		const accepted = new Set(options?.includedSubdirectories ?? []);
		const added = playlist.subdirectories.filter((path) => !accepted.has(path));
		if (added.length > 0) {
			result.set(playlist.id, added);
		}
	}
	return result;
}
