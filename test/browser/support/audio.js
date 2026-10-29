import { expect } from '@playwright/test';

/**
 * @typedef {object} VoiceInfo
 * @property {string} label the title of what plays
 * @property {'music' | 'sfx'} bus
 * @property {number} gain
 * @property {number} startAt
 */

/**
 * The page's fake audio engine and clock (test-main.js), the only way a test touches sound or time. Time stands still
 * until `advance` moves it, so nothing here is a matter of waiting.
 */
export class Audio {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	/**
	 * Lets time pass, then lets the page settle before the next line.
	 * @param {number} milliseconds
	 */
	async advance(milliseconds) {
		await this.#page.evaluate(async (ms) => {
			soundboardTest.clock.advance(ms);
			await new Promise((resolve) => setTimeout(resolve));
		}, milliseconds);
	}

	/**
	 * Says how a sound or track behaves when it plays. Call it before it plays. Every file with that title is set, since
	 * several playlists can hold the same song.
	 * @param {string} title
	 * @param {{ duration?: number, loadDelay?: number, loadError?: string, playError?: string }} script seconds
	 */
	async script(title, script) {
		const found = await this.#page.evaluate(async ([wanted, voiceScript]) => {
			const library = await (await fetch('/api/library')).json();
			const files = [...library.sounds, ...library.playlists.flatMap((/** @type {any} */ playlist) => playlist.tracks)];
			const urls = files.filter((/** @type {any} */ file) => file.title === wanted).map((/** @type {any} */ file) => file.url);
			for (const url of urls) {
				soundboardTest.engine.script(url, voiceScript);
			}
			return urls.length;
		}, /** @type {const} */ ([title, script]));
		if (found === 0) {
			throw new Error(`No sound or track is called "${title}"`);
		}
	}

	/** @returns {Promise<VoiceInfo[]>} the voices that have not been stopped */
	async #liveVoices() {
		return this.#page.evaluate(() => soundboardTest.engine.liveVoices.map(
			(/** @type {any} */ voice) => ({ label: voice.label, bus: voice.bus, gain: voice.gain, startAt: voice.startAt }),
		));
	}

	/** @param {string} title */
	async expectPlaying(title) {
		await expect.poll(async () => (await this.#liveVoices()).map((voice) => voice.label)).toContain(title);
	}

	/** @param {string} title */
	async expectNotPlaying(title) {
		await expect.poll(async () => (await this.#liveVoices()).map((voice) => voice.label)).not.toContain(title);
	}

	async expectNothingPlaying() {
		await expect.poll(() => this.#liveVoices()).toEqual([]);
	}

	/**
	 * @param {number} count
	 * @param {{ title?: string, bus?: 'music' | 'sfx' }} [only] counts just the voices of that title or bus
	 */
	async expectPlayingCount(count, { title, bus } = {}) {
		await expect.poll(async () => (await this.#liveVoices()).filter(
			(voice) => (title === undefined || voice.label === title) && (bus === undefined || voice.bus === bus),
		).length).toBe(count);
	}
}
