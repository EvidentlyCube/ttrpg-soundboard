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

	/** Presses "+ Add sound". */
	async openAdd() {
		await this.#page.locator('[data-add-button=sfx]').click();
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

	/** @param {string} title @param {number} count how many tiles carry that title */
	async expectCount(title, count) {
		await expect(this.#tile(title)).toHaveCount(count);
	}

	/** @param {string} title */
	async expectGone(title) {
		await expect(this.#tile(title)).toBeHidden();
	}

	/** @param {string} title */
	async click(title) {
		await this.#tile(title).click();
	}

	/**
	 * Opens the tile's context menu and picks an item, such as "Customize".
	 * @param {string} title
	 * @param {string} item
	 */
	async useMenu(title, item) {
		await this.#tile(title).click({ button: 'right' });
		await this.#page.getByRole('menuitem', { name: item, exact: true }).click();
	}

	/** Opens the tile's context menu without picking anything. @param {string} title */
	async openMenu(title) {
		await this.#tile(title).click({ button: 'right' });
	}

	/** @param {boolean} open whether a context menu is on screen */
	async expectMenuOpen(open) {
		await expect(this.#page.getByRole('menu')).toBeVisible({ visible: open });
	}

	/** @param {string[]} titles every sound's title, in the order the tiles are laid out */
	async expectOrder(titles) {
		await expect(this.#page.locator('[data-sound-id] > span')).toHaveText(titles);
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
