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

/** @typedef {{ recent: string[], browsed: string | null }} RecentFile */

/**
 * The last folders that were opened as a soundboard, newest first, and the folder the Selector's browser showed last,
 * in `recent.json`. A broken or missing file counts as an empty list, since losing it costs only a few clicks.
 */
export class RecentFolders {
	#file;

	/** @param {string} file */
	constructor(file) {
		this.#file = file;
	}

	/** @returns {Promise<RecentFolder[]>} */
	async list() {
		const { recent } = await this.#read();
		return Promise.all(recent.map(async (path) => ({
			path,
			exists: await stat(path).then((stats) => stats.isDirectory(), () => false),
		})));
	}

	/**
	 * Moves the folder to the top.
	 * @param {string} path
	 */
	async add(path) {
		const file = await this.#read();
		await this.#write({ ...file, recent: [path, ...file.recent.filter((other) => other !== path)].slice(0, MAX_RECENT) });
	}

	/** @param {string} path */
	async forget(path) {
		const file = await this.#read();
		if (file.recent.includes(path)) {
			await this.#write({ ...file, recent: file.recent.filter((other) => other !== path) });
		}
	}

	/** @returns {Promise<string | null>} the folder the browser showed last */
	async browsed() {
		return (await this.#read()).browsed;
	}

	/** @param {string} path */
	async setBrowsed(path) {
		const file = await this.#read();
		if (file.browsed !== path) {
			await this.#write({ ...file, browsed: path });
		}
	}

	/** @returns {Promise<RecentFile>} */
	async #read() {
		try {
			const value = JSON.parse(await readFile(this.#file, 'utf8'));
			const paths = value?.recent;
			return {
				recent: Array.isArray(paths) ? paths.filter((path) => typeof path === 'string').slice(0, MAX_RECENT) : [],
				browsed: typeof value?.browsed === 'string' ? value.browsed : null,
			};
		} catch {
			return { recent: [], browsed: null };
		}
	}

	/** @param {RecentFile} file */
	async #write(file) {
		await mkdir(dirname(this.#file), { recursive: true });
		await writeJsonAtomic(this.#file, file.browsed === null ? { recent: file.recent } : file);
	}
}
