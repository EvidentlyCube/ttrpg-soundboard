import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from '../library/options-store.js';

/** How many folders the Selector remembers. */
export const MAX_RECENT = 5;

/** @typedef {{ path: string, exists: boolean }} RecentFolder */

/**
 * The folder the app keeps its own files in, outside any soundboard (DESIGN.md §5.8).
 * @param {{ name: NodeJS.Platform, home: string }} platform
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function configFolder(platform, env) {
	if (platform.name === 'win32') {
		return join(env.APPDATA ?? join(platform.home, 'AppData', 'Roaming'), 'Soundboard');
	}
	if (platform.name === 'darwin') {
		return join(platform.home, 'Library', 'Application Support', 'Soundboard');
	}
	return join(env.XDG_CONFIG_HOME || join(platform.home, '.config'), 'soundboard');
}

/**
 * The last folders that were opened as a soundboard, newest first, in `recent.json`. A broken or missing file counts
 * as an empty list, since losing it costs only a few clicks.
 */
export class RecentFolders {
	#file;

	/** @param {string} file */
	constructor(file) {
		this.#file = file;
	}

	/** @returns {Promise<RecentFolder[]>} */
	async list() {
		const paths = await this.#read();
		return Promise.all(paths.map(async (path) => ({
			path,
			exists: await stat(path).then((stats) => stats.isDirectory(), () => false),
		})));
	}

	/**
	 * Moves the folder to the top.
	 * @param {string} path
	 */
	async add(path) {
		const paths = await this.#read();
		await this.#write([path, ...paths.filter((other) => other !== path)].slice(0, MAX_RECENT));
	}

	/** @param {string} path */
	async forget(path) {
		const paths = await this.#read();
		if (paths.includes(path)) {
			await this.#write(paths.filter((other) => other !== path));
		}
	}

	/** @returns {Promise<string[]>} */
	async #read() {
		try {
			const value = JSON.parse(await readFile(this.#file, 'utf8'));
			const paths = value?.recent;
			return Array.isArray(paths) ? paths.filter((path) => typeof path === 'string').slice(0, MAX_RECENT) : [];
		} catch {
			return [];
		}
	}

	/** @param {string[]} paths */
	async #write(paths) {
		await mkdir(dirname(this.#file), { recursive: true });
		await writeJsonAtomic(this.#file, { recent: paths });
	}
}
