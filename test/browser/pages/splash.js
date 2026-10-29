import { expect } from '@playwright/test';

/** The full-screen message before audio may start (DESIGN.md §9.0). */
export class SplashPage {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	/** Starts as standalone, or clicks the screen when it shows a message (a retry, a resume). */
	async click() {
		const standalone = this.#page.locator('[data-start-mode=standalone]');
		if (await standalone.isVisible()) {
			await standalone.click();
		} else {
			await this.#page.locator('[data-splash]').click();
		}
	}

	/** @param {'standalone' | 'host' | 'remote'} mode */
	async choose(mode) {
		await this.#page.locator(`[data-start-mode=${mode}]`).click();
	}

	async expectVisible(text = 'Choose how to start') {
		await expect(this.#page.locator('[data-splash]')).toBeVisible();
		await expect(this.#page.locator('[data-splash]')).toContainText(text);
	}

	async expectHidden() {
		await expect(this.#page.locator('[data-splash]')).toBeHidden();
	}
}
