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
	 * @param {{ duration?: number, loadDelay?: number, loadError?: string, playError?: string, bufferError?: string }} script seconds; a
	 * sound short enough to be buffered fails with `bufferError`, a track with `loadError`
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

	/**
	 * What a bus is set to, which the volume sliders in the header decide.
	 * @param {'master' | 'music' | 'sfx'} bus
	 * @param {unknown} gain a number, or a matcher such as `expect.closeTo`
	 */
	async expectBusGain(bus, gain) {
		await expect.poll(() => this.#page.evaluate((name) => soundboardTest.engine.busGains[name], bus)).toEqual(gain);
	}

	/** Makes waveform decoding wait, so a test can look at the indicator while it runs. Call it before the splash is clicked. */
	async holdWaveforms() {
		await this.#page.evaluate(() => {
			soundboardTest.decoder.gate = new Promise((resolve) => {
				soundboardTest.release = resolve;
			});
		});
	}

	/**
	 * Makes the waveform of every file with this title fail to decode. Call it before the waveforms are made.
	 * @param {string} title
	 */
	async failWaveform(title) {
		const found = await this.#page.evaluate(async (wanted) => {
			const library = await (await fetch('/api/library')).json();
			const files = [...library.sounds, ...library.playlists.flatMap((/** @type {any} */ playlist) => playlist.tracks)];
			const urls = files.filter((/** @type {any} */ file) => file.title === wanted).map((/** @type {any} */ file) => file.url);
			for (const url of urls) {
				soundboardTest.decoder.failing.add(url);
			}
			return urls.length;
		}, title);
		if (found === 0) {
			throw new Error(`No sound or track is called "${title}"`);
		}
	}

	/** @param {number} count how many files the page has decoded for waveforms so far */
	async expectDecodedCount(count) {
		await expect.poll(() => this.#page.evaluate(() => soundboardTest.decoder.decoded.length)).toBe(count);
	}

	/** Lets the waiting waveform decoding go on. */
	async releaseWaveforms() {
		await this.#page.evaluate(() => {
			soundboardTest.decoder.gate = null;
			soundboardTest.release?.();
		});
	}

	/**
	 * Lets time pass until every missing waveform is made. The service rests a moment between two files (DESIGN.md §6.6),
	 * and each file takes a real round trip to the server, so time is moved on again and again until the header's
	 * indicator is gone.
	 */
	async finishWaveforms() {
		const indicator = this.#page.locator('[data-waveform-indicator]');
		await expect(async () => {
			await this.advance(250);
			await expect(indicator).toBeHidden({ timeout: 50 });
		}).toPass({ timeout: 15_000, intervals: [20] });
	}

	/**
	 * Like `finishWaveforms`, for a run that ends with the indicator still showing, as when some files failed.
	 * @param {string} text what the indicator should come to say, such as "Waveforms 16 / 16, 2 failed"
	 */
	async finishWaveformsWith(text) {
		const indicator = this.#page.locator('[data-waveform-indicator]');
		await expect(async () => {
			await this.advance(250);
			await expect(indicator).toContainText(text, { timeout: 50 });
		}).toPass({ timeout: 15_000, intervals: [20] });
	}

	/** The system takes the audio device away, as when the lid closes or another app takes over. */
	async suspend() {
		await this.#page.evaluate(() => soundboardTest.engine.simulate('suspended'));
	}

	/** The system gives the audio device back, as it does once the person has clicked. */
	async resume() {
		await this.#page.evaluate(() => soundboardTest.engine.simulate('resumed'));
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
	 * A voice for this title with these settings, such as where in the file it started.
	 * @param {string} title
	 * @param {{ gain?: unknown, startAt?: unknown }} settings numbers, or matchers such as `expect.closeTo`
	 */
	async expectVoice(title, settings) {
		await expect.poll(async () => (await this.#liveVoices()).filter((voice) => voice.label === title)).toContainEqual(expect.objectContaining(settings));
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
