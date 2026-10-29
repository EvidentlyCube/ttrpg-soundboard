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

	/** @param {string} playlistTitle */
	player(playlistTitle) {
		return new PlayerBarPage(this.#page, playlistTitle);
	}
}

/** One playlist's player bar. */
export class PlayerBarPage {
	#bar;

	/**
	 * @param {import('@playwright/test').Page} page
	 * @param {string} playlistTitle
	 */
	constructor(page, playlistTitle) {
		this.#bar = page.locator('[data-player-bar]').filter({ has: page.getByText(playlistTitle, { exact: true }) });
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
