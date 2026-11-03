import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from '../library/options-store.js';

/** A language file's name without `.js`: `en`, `pl`, `pt-BR`. */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * The codes of the language files in `public/app/i18n/` (DESIGN.md §9.21), so adding a language is adding its file.
 * @param {string} publicDir
 * @returns {Promise<string[]>}
 */
export async function availableLanguages(publicDir) {
	const names = await readdir(join(publicDir, 'app', 'i18n'));
	return names
		.filter((name) => name.endsWith('.js'))
		.map((name) => name.slice(0, -'.js'.length))
		.filter((code) => LANGUAGE_CODE.test(code))
		.sort();
}

/**
 * The app's own settings, kept for every soundboard in `settings.json` in the config folder (DESIGN.md §5.8). So far
 * only the language; `null` means the browser's. A broken or missing file counts as no settings.
 */
export class AppSettings {
	#file;

	/** @param {string} file */
	constructor(file) {
		this.#file = file;
	}

	/** @returns {Promise<string | null>} */
	async language() {
		const { language } = await this.#read();
		return typeof language === 'string' && LANGUAGE_CODE.test(language) ? language : null;
	}

	/** @param {string | null} language */
	async setLanguage(language) {
		const settings = await this.#read();
		delete settings.language;
		await mkdir(dirname(this.#file), { recursive: true });
		await writeJsonAtomic(this.#file, language === null ? settings : { ...settings, language });
	}

	/** @returns {Promise<Record<string, unknown>>} */
	async #read() {
		try {
			const value = JSON.parse(await readFile(this.#file, 'utf8'));
			return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
		} catch {
			return {};
		}
	}
}
