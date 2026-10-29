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

	/** The Panic Stop button (DESIGN.md §9.1). */
	async pressPanic() {
		await this.#page.locator('[data-panic-button]').click();
	}

	/** @param {'fade' | 'now'} state */
	async expectPanic(state) {
		const button = this.#page.locator('[data-panic-button]');
		await expect(button).toHaveAttribute('data-state', state);
		await expect(button).toHaveText(state === 'fade' ? 'Stop(Fade)' : 'Stop(NOW!)');
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

	/** @param {string} title the track marked in the open track list */
	async expectCurrentInTrackList(title) {
		await expect(this.#page.locator('[role=menuitem][data-current=true]')).toHaveText(new RegExp(title));
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
