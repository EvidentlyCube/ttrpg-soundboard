import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/**
 * The audio folder on disk, for tests that care about what the app wrote there (DESIGN.md §2). Every file and every
 * playlist has an options file next to it, named after it with `.json` added.
 */
export class Disk {
	#root;

	/** @param {string} root */
	constructor(root) {
		this.#root = root;
	}

	/**
	 * What the options file of a file or playlist holds right now.
	 * @param {string} name path in the audio folder, such as `Explosion.mp3` or `Music MP3`
	 * @returns {Promise<Record<string, unknown>>}
	 */
	async options(name) {
		return JSON.parse(await readFile(join(this.#root, `${name}.json`), 'utf8'));
	}

	/**
	 * Waits for the app to have saved these values, which it does a moment after a change.
	 * @param {string} name path in the audio folder, such as `Explosion.mp3` or `Music MP3`
	 * @param {Record<string, unknown>} values only the ones that matter, such as `{ gain: 0.5 }`
	 */
	async expectOptions(name, values) {
		await expect.poll(() => this.options(name)).toMatchObject(values);
	}
}
