import { expect } from '@playwright/test';

/** The Playlists section of the board (DESIGN.md §9.1). */
export class PlaylistsPage {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	/** @param {string} title */
	#tile(title) {
		return this.#page.getByRole('button').filter({ has: this.#page.getByText(title, { exact: true }) });
	}

	/** @param {string[]} titles */
	async expectShown(...titles) {
		for (const title of titles) {
			await expect(this.#tile(title)).toBeVisible();
		}
	}
}
