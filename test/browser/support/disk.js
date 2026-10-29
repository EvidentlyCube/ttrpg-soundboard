import { copyFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { FIXTURES_DIR } from '../../helpers/tmp-tree.js';

/**
 * The audio folder on disk, for tests that care about what the app wrote there, or that change the folder behind the
 * app's back, as copying a file in would (DESIGN.md §2). Every file and every playlist has an options file next to
 * it, named after it with `.json` added.
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

	/**
	 * Waits for the app to have saved these settings, such as `{ volumes: { music: 0.5 } }`.
	 * @param {Record<string, unknown>} values
	 */
	async expectSettings(values) {
		await expect.poll(async () => JSON.parse(await readFile(join(this.#root, '.soundboard'), 'utf8'))).toMatchObject(values);
	}

	/**
	 * Puts a copy of one of the example fixture's files into the folder, as if it were copied in by hand.
	 * @param {string} fixtureFile a file at the top of `example_soundboard`
	 * @param {string} name what it is called in the folder
	 */
	async addCopyOf(fixtureFile, name) {
		await copyFile(join(FIXTURES_DIR, 'example_soundboard', fixtureFile), join(this.#root, name));
	}

	/** Deletes a file, as if by hand. @param {string} name */
	async remove(name) {
		await rm(join(this.#root, name));
	}

	/** Waits for a file to exist, such as a waveform the app made. @param {string} name */
	async expectFile(name) {
		await expect.poll(() => stat(join(this.#root, name)).then(() => true, () => false)).toBe(true);
	}
}
