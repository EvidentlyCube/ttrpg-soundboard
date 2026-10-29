import { expect } from '@playwright/test';

/** The full-screen message before audio may start (DESIGN.md §9.0). */
export class SplashPage {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	async click() {
		await this.#page.locator('[data-splash]').click();
	}

	async expectVisible(text = 'Click anywhere to start') {
		await expect(this.#page.locator('[data-splash]')).toBeVisible();
		await expect(this.#page.locator('[data-splash]')).toContainText(text);
	}

	async expectHidden() {
		await expect(this.#page.locator('[data-splash]')).toBeHidden();
	}
}
