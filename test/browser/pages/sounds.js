import { expect } from '@playwright/test';

/** The Sound Effects section of the board (DESIGN.md §9.1). */
export class SoundsPage {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	/** @param {string} title */
	#tile(title) {
		return this.#page.locator('[data-sound-id]').filter({ has: this.#page.getByText(title, { exact: true }) });
	}

	/** @param {string} title */
	#stopButton(title) {
		return this.#page.getByRole('button', { name: `Stop all ${title}` });
	}

	/** @param {string[]} titles */
	async expectShown(...titles) {
		for (const title of titles) {
			await expect(this.#tile(title)).toBeVisible();
		}
	}

	/** @param {string} title */
	async click(title) {
		await this.#tile(title).click();
	}

	/** Presses the small stop button in the tile's corner. @param {string} title */
	async stop(title) {
		await this.#stopButton(title).click();
	}

	/** @param {string} title */
	async expectPlaying(title) {
		await expect(this.#tile(title)).toHaveAttribute('data-active', 'true');
		await expect(this.#stopButton(title)).toBeVisible();
	}

	/** @param {string} title */
	async expectIdle(title) {
		await expect(this.#tile(title)).toHaveAttribute('data-active', 'false');
		await expect(this.#stopButton(title)).toBeHidden();
	}
}
