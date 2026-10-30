import { expect } from '@playwright/test';

/** The player bars at the bottom of the page (DESIGN.md §9.2). */
export class FooterPage {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	/** @param {number} count */
	async expectPlayersCount(count) {
		await expect(this.#page.locator('[data-player-bar]')).toHaveCount(count);
	}

	async expectEmpty() {
		await expect(this.#page.getByText('No playlist playing')).toBeVisible();
		await this.expectPlayersCount(0);
	}

	/** @returns {Promise<{ x: number, y: number }[]>} where every player bar is, left to right and top to bottom */
	async #barPositions() {
		return this.#page.locator('[data-player-bar]').evaluateAll((bars) => bars.map((bar) => {
			const { x, y } = bar.getBoundingClientRect();
			return { x: Math.round(x), y: Math.round(y) };
		}));
	}

	/** The bars sit in three columns: the rows hold [3, 3, 1] bars for seven playlists. @param {number[]} rows how many bars each row holds */
	async expectRows(rows) {
		await expect.poll(async () => {
			const positions = await this.#barPositions();
			const counts = new Map();
			for (const { y } of positions) {
				counts.set(y, (counts.get(y) ?? 0) + 1);
			}
			return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count);
		}).toEqual(rows);
	}

	/** The dock is two rows of bars tall at most, and scrolls beyond that. @param {boolean} scrolls */
	async expectScrolls(scrolls) {
		const grid = this.#page.locator('[data-player-dock] .overflow-y-auto');
		await expect.poll(() => grid.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(scrolls);
	}

	/** The height of the dock, to see that it stops growing. */
	async height() {
		return (await this.#page.locator('[data-player-dock]').boundingBox())?.height ?? 0;
	}

	/** The Panic Stop button (DESIGN.md §9.1). */
	async pressPanic() {
		await this.#page.locator('[data-panic-button]').click();
	}

	/** @param {'fade' | 'now'} state */
	async expectPanic(state) {
		const button = this.#page.locator('[data-panic-button]');
		await expect(button).toHaveAttribute('data-state', state);
		await expect(button).toHaveText(state === 'fade' ? 'Stop All' : 'STOP NOW!');
	}

	/** @param {string} playlistTitle */
	player(playlistTitle) {
		return new PlayerBarPage(this.#page, playlistTitle);
	}
}

/** One playlist's player bar. */
export class PlayerBarPage {
	#page;
	#bar;

	/**
	 * @param {import('@playwright/test').Page} page
	 * @param {string} playlistTitle
	 */
	constructor(page, playlistTitle) {
		this.#page = page;
		this.#bar = page.locator('[data-player-bar]').filter({ has: page.getByText(playlistTitle, { exact: true }) });
	}

	/** @param {'Previous' | 'Pause' | 'Resume' | 'Next' | 'Stop'} name */
	#control(name) {
		return this.#bar.getByRole('button', { name, exact: true });
	}

	async pause() {
		await this.#control('Pause').click();
	}

	async resume() {
		await this.#control('Resume').click();
	}

	async next() {
		await this.#control('Next').click();
	}

	async previous() {
		await this.#control('Previous').click();
	}

	async stop() {
		await this.#control('Stop').click();
	}

	async expectPaused() {
		await expect(this.#control('Resume')).toBeVisible();
	}

	async expectNotPaused() {
		await expect(this.#control('Pause')).toBeVisible();
	}

	/** Clicks the progress bar. @param {number} fraction where on the bar, from 0 (start) to 1 (end) */
	async seekTo(fraction) {
		const bar = this.#bar.locator('[data-progress]');
		const box = await bar.boundingBox();
		if (!box) {
			throw new Error('The progress bar is not on screen');
		}
		await this.#page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
	}

	/** Presses the live volume bar. @param {number} fraction where on the bar, from 0 (silent) to 1 (full) */
	async setLevel(fraction) {
		const bar = this.#bar.locator('[data-level-bar] [role=slider]');
		const box = await bar.boundingBox();
		if (!box) {
			throw new Error('The live volume bar is not on screen');
		}
		await this.#page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
	}

	async resetLevel() {
		await this.#bar.locator('[data-level-bar] [role=slider]').dblclick();
	}

	async openTrackList() {
		await this.#bar.getByTitle('Choose a track').click();
	}

	/** Picks a track from the open track list. @param {string} title */
	async jumpTo(title) {
		await this.#page.getByRole('menuitem', { name: title }).click();
	}

	/** @param {string[]} titles the open track list, in order */
	async expectTrackList(titles) {
		await expect(this.#page.getByRole('menuitem').locator('span.truncate')).toHaveText(titles);
	}

	/** A track that cannot be picked, such as one in a format this browser cannot play. @param {string} title */
	async expectTrackDisabled(title) {
		await expect(this.#page.getByRole('menuitem', { name: title })).toBeDisabled();
	}

	/** The open track list has scrolled so that this track is inside it. @param {string} title */
	async expectTrackListShows(title) {
		await expect(this.#page.getByRole('menuitem', { name: title })).toBeInViewport({ ratio: 1 });
	}

	/** @param {string} title the track marked in the open track list */
	async expectCurrentInTrackList(title) {
		await expect(this.#page.locator('[role=menuitem][data-current=true]')).toHaveText(new RegExp(title));
	}

	/** @returns {Promise<string>} the title of the track the bar shows */
	async currentTrack() {
		return (await this.#bar.getByTitle('Choose a track').innerText()).trim();
	}

	/** The part of the progress bar where the crossfade into the next track happens. @param {number | null} percent how much of the bar from its end, or null while there is none */
	async expectCrossfadeBand(percent) {
		const band = this.#bar.locator('[data-crossfade-band]');
		if (percent === null) {
			await expect(band).toBeHidden();
			return;
		}
		await expect(band).toBeVisible();
		await expect.poll(() => band.evaluate((element) => Number.parseFloat(/** @type {HTMLElement} */ (element).style.width))).toBeCloseTo(percent, 0);
	}

	/** @param {string} title */
	async expectTrack(title) {
		await expect(this.#bar).toContainText(title);
	}

	/** @param {string} time as shown, such as "0:01 / 3:00" */
	async expectTime(time) {
		await expect(this.#bar).toContainText(time);
	}
}
