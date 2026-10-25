import { readTitle } from '../metadata/index.js';
import { ValidationError } from './errors.js';
import { buildLibrary } from './library.js';
import { readValidatedJson, updateJsonFile, writeJsonAtomic } from './options-store.js';
import { scanAudioDirectory } from './scanner.js';
import { INITIAL_SETTINGS_FILE, SettingsStore } from './settings-store.js';
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
 * @property {(paths: string[]) => void} nestedDirectories root-relative paths, such as `Combat/Boss`
 * @property {(titles: { path: string, title: string }[]) => void} metadataTitles
 * @property {(count: number) => void} optionsGenerated
 * @property {(library: Library) => void} libraryLoaded
 */

/**
 * @typedef {{ status: 'ready', library: Library, settings: SettingsStore }
 * 	| { status: 'invalid' }
 * 	| { status: 'cancelled' }} BootstrapOutcome
 */

export const NESTED_DIRECTORIES_QUESTION = 'Nested directories will be merged into their playlists. Continue?';
export const METADATA_TITLES_QUESTION = 'Use these titles in the generated options files?';

/**
 * Prepares an audio directory before the server starts (DESIGN.md §3): validates every options file, asks about
 * nested directories and metadata titles, and writes the missing options files.
 */
export class BootstrapService {
	#prompter;
	#reporter;

	/** @param {{ prompter: Prompter, reporter: Reporter }} ports */
	constructor({ prompter, reporter }) {
		this.#prompter = prompter;
		this.#reporter = reporter;
	}

	/**
	 * @param {string} root
	 * @returns {Promise<BootstrapOutcome>}
	 */
	async run(root) {
		const scan = await scanAudioDirectory(root);
		const { optionsByPath, errors } = await loadOptions(scan);
		if (errors.length > 0) {
			this.#reporter.validationErrors(errors);
			return { status: 'invalid' };
		}
		if (scan.warnings.length > 0) {
			this.#reporter.warnings(scan.warnings);
		}

		// Empty playlists are hidden from the UI, so asking about them or creating their options would only be noise.
		const playlists = scan.playlists.filter((playlist) => playlist.tracks.length > 0);
		const newSubdirectories = findNewSubdirectories(playlists, optionsByPath);
		const nestedPaths = [...newSubdirectories].flatMap(([id, subdirectories]) => subdirectories.map((path) => `${id}/${path}`));
		if (nestedPaths.length > 0) {
			this.#reporter.nestedDirectories(nestedPaths);
			if (!(await this.#prompter.confirm(NESTED_DIRECTORIES_QUESTION))) {
				return { status: 'cancelled' };
			}
		}

		const isFirstRun = !scan.hasSettingsFile;
		const missingOptions = [...scan.sounds, ...playlists.flatMap((playlist) => playlist.tracks)].filter((audio) => !audio.hasOptions);
		const titles = await this.#chooseTitles(missingOptions, isFirstRun);

		let written = 0;
		for (const audio of missingOptions) {
			/** @type {AudioOptions} */
			const options = { title: titles.get(audio.id) ?? audio.name };
			await writeJsonAtomic(audio.optionsPath, options);
			optionsByPath.set(audio.optionsPath, options);
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
		return { status: 'ready', library, settings: await SettingsStore.load(scan.settingsPath) };
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
