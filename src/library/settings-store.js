import { basename, dirname } from 'node:path';
import { ValidationError } from './errors.js';
import { readValidatedJson, updateJsonFile } from './options-store.js';
import { SETTINGS_VERSION, VOLUME_BUSES, validateName, validateSettingsFile, validateVolumes } from './validate.js';

/** @typedef {import('./validate.js').Volumes} Volumes */
/** @typedef {import('./validate.js').SettingsFile} SettingsFile */
/** @typedef {{ volumes: Volumes, name: string | null }} Settings `name`: the soundboard's own name, null without one */
/** @typedef {(path: string, update: import('./options-store.js').JsonUpdate) => Promise<void>} FileUpdater */

/** @type {Readonly<Volumes>} */
const DEFAULT_VOLUMES = Object.freeze({ master: 1, music: 1, sfx: 1 });

/** The content of `.soundboard` written on the first run. */
export const INITIAL_SETTINGS_FILE = Object.freeze({ version: SETTINGS_VERSION, volumes: DEFAULT_VOLUMES });

/**
 * App settings held in memory and saved to `.soundboard`. Saves never overlap: changes made while a save is running
 * are written together by one follow-up save, so the file always ends with the newest values.
 */
export class SettingsStore {
	#path;
	#updateFile;
	/** @type {Volumes} */
	#volumes;
	/** @type {string | null} */
	#name;
	#dirty = false;
	/** @type {Promise<void> | null} */
	#saving = null;

	/**
	 * @param {string} path
	 * @param {{ volumes: Volumes, name?: string | null }} settings
	 * @param {{ updateFile?: FileUpdater }} [options]
	 */
	constructor(path, settings, { updateFile = updateJsonFile } = {}) {
		this.#path = path;
		this.#volumes = { ...settings.volumes };
		this.#name = settings.name ?? null;
		this.#updateFile = updateFile;
	}

	/**
	 * @param {string} path
	 * @param {{ updateFile?: FileUpdater }} [options]
	 */
	static async load(path, options) {
		const file = /** @type {SettingsFile} */ (await readValidatedJson(path, validateSettingsFile));
		return new SettingsStore(path, {
			volumes: { ...DEFAULT_VOLUMES, ...pickVolumes(file.volumes ?? {}) },
			name: file.name?.trim() ?? null,
		}, options);
	}

	/** @returns {Settings} */
	get settings() {
		return { volumes: { ...this.#volumes }, name: this.#name };
	}

	/** @returns {string} the soundboard folder's name, which shows where there is no name */
	get folderName() {
		return basename(dirname(this.#path));
	}

	/**
	 * Applies the name immediately and resolves once it has been saved. Blank or null removes it, so the folder's name
	 * shows instead.
	 * @param {string | null} name
	 * @returns {Promise<Settings>}
	 */
	async updateName(name) {
		const trimmed = typeof name === 'string' ? name.trim() || null : name;
		const problems = trimmed === null ? [] : validateName(trimmed);
		if (problems.length > 0) {
			throw new ValidationError(null, problems);
		}
		this.#name = trimmed;
		await this.#save();
		return this.settings;
	}

	/**
	 * Applies the change immediately and resolves once it has been saved. Unknown keys are ignored.
	 * @param {Partial<Volumes>} volumes
	 * @returns {Promise<Settings>}
	 */
	async updateVolumes(volumes) {
		const problems = validateVolumes(volumes);
		if (problems.length > 0) {
			throw new ValidationError(null, problems);
		}
		Object.assign(this.#volumes, pickVolumes(volumes));
		await this.#save();
		return this.settings;
	}

	#save() {
		this.#dirty = true;
		this.#saving ??= this.#flush();
		return this.#saving;
	}

	async #flush() {
		try {
			while (this.#dirty) {
				this.#dirty = false;
				const volumes = { ...this.#volumes };
				const name = this.#name;
				await this.#updateFile(this.#path, ({ name: _old, ...current }) => (name === null ? { ...current, volumes } : { ...current, volumes, name }));
			}
		} finally {
			this.#saving = null;
		}
	}
}

/**
 * @param {Partial<Volumes>} volumes
 * @returns {Partial<Volumes>}
 */
function pickVolumes(volumes) {
	return Object.fromEntries(VOLUME_BUSES.filter((bus) => typeof volumes[bus] === 'number').map((bus) => [bus, volumes[bus]]));
}
