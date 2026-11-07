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
		return this.#page.locator('[data-playlist-id]').filter({ has: this.#page.getByText(title, { exact: true }) });
	}

	/** Presses "+ Add playlist". */
	async openAdd() {
		await this.#page.locator('[data-add-button=music]').click();
	}

	/** The line that says nothing was found, which is there only while the library is empty. @param {boolean} shown */
	async expectNoneFoundLine(shown) {
		await expect(this.#page.getByText('No playlists or sounds were found in this folder.')).toBeVisible({ visible: shown });
	}

	/** @param {string[]} titles */
	async expectShown(...titles) {
		for (const title of titles) {
			await expect(this.#tile(title)).toBeVisible();
		}
	}

	/** @param {string} title */
	async expectGone(title) {
		await expect(this.#tile(title)).toHaveCount(0);
	}

	/** @param {string} title */
	async click(title) {
		await this.#tile(title).click();
	}

	/**
	 * Opens the tile's context menu and picks an item, such as "Next (Instant)".
	 * @param {string} title
	 * @param {string} item
	 */
	async useMenu(title, item) {
		await this.#tile(title).click({ button: 'right' });
		await this.#page.getByRole('menuitem', { name: item, exact: true }).click();
	}

	/** @param {string} title */
	/** Whether the tile shows its image. @param {string} title @param {boolean} shown */
	async expectImage(title, shown) {
		await expect(this.#tile(title)).toHaveAttribute('data-image', String(shown));
		await expect(this.#tile(title).locator('[data-tile-image]')).toBeVisible({ visible: shown });
	}

	/** @param {string} title */
	async expectPlaying(title) {
		await expect(this.#tile(title)).toHaveAttribute('data-active', 'true');
	}

	/** @param {string} title */
	async expectIdle(title) {
		await expect(this.#tile(title)).toHaveAttribute('data-active', 'false');
	}

	/**
	 * What the tile says under the title: "Playing", "Paused", "4 tracks", "Resumes at 0:05".
	 * @param {string} title
	 * @param {string} status
	 */
	async expectStatus(title, status) {
		await expect(this.#tile(title)).toContainText(status);
	}

	/** The orange speaker for a turned-down live volume sits next to the tile button (DESIGN.md §9.1). @param {string} title */
	#levelIcon(title) {
		return this.#tile(title).locator('xpath=..').locator('[data-level-icon]');
	}

	/**
	 * @param {string} title
	 * @param {boolean} shown
	 */
	async expectLevelIcon(title, shown) {
		await expect(this.#levelIcon(title)).toBeVisible({ visible: shown });
	}

	/** @param {string} title */
	async resetLevel(title) {
		await this.#levelIcon(title).dblclick();
	}

	/** @param {string} title */
	async expectError(title) {
		await expect(this.#tile(title)).toHaveAttribute('data-error', 'true');
	}

	/** The red ring lasts two seconds of real time (DESIGN.md §9.1). @param {string} title */
	async expectNoError(title) {
		await expect(this.#tile(title)).not.toHaveAttribute('data-error', 'true');
	}

	/**
	 * A tile that cannot be pressed, with the reason its tooltip gives.
	 * @param {string} title
	 * @param {string} reason
	 */
	async expectDisabled(title, reason) {
		await expect(this.#tile(title)).toBeDisabled();
		await expect(this.#tile(title)).toHaveAttribute('title', new RegExp(reason));
	}
}
