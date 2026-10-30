import { expect } from '@playwright/test';

/** The dialog that shows the download while it runs (DESIGN.md §9.10). */
export class DownloadDialogPage {
	#page;
	#dialog;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
		this.#dialog = page.getByRole('dialog', { name: 'Download' });
	}

	async expectOpen() {
		await expect(this.#dialog).toBeVisible();
	}

	async expectClosed() {
		await expect(this.#dialog).toBeHidden();
	}

	/** @param {string | RegExp} text such as "Downloading Me at the zoo" or "Download finished" */
	async expectHeading(text) {
		await expect(this.#dialog.locator('h2')).toHaveText(text);
	}

	/** @param {string} text such as "Adding sound effects" or "Adding to Rain" */
	async expectTarget(text) {
		await expect(this.#dialog).toContainText(text);
	}

	/** @param {string | RegExp} text such as "Downloading · Item 1 of 3: Song a" */
	async expectCurrent(text) {
		await expect(this.#dialog.locator('[data-download-current]')).toContainText(text);
	}

	/** @param {string} line a line of the tool's output */
	async expectLog(line) {
		await expect(this.#dialog.locator('[data-download-log]')).toContainText(line);
	}

	/** @param {string | RegExp} text the summary after the download, such as "1 added." */
	async expectSummary(text) {
		await expect(this.#dialog.locator('[data-download-summary]')).toContainText(text);
	}

	/** Cancel is there while it runs; Close once it has ended. @param {'cancel' | 'close'} button */
	async expectButton(button) {
		await expect(this.#dialog.locator('[data-download-cancel]')).toBeVisible({ visible: button === 'cancel' });
		await expect(this.#dialog.locator('[data-download-close]')).toBeVisible({ visible: button === 'close' });
	}

	/** Presses Cancel and agrees to the question. */
	async cancel() {
		this.#page.once('dialog', (dialog) => dialog.accept());
		await this.#dialog.locator('[data-download-cancel]').click();
	}

	/** Presses Cancel and answers no. */
	async cancelButChangeMind() {
		this.#page.once('dialog', (dialog) => dialog.dismiss());
		await this.#dialog.locator('[data-download-cancel]').click();
	}

	async close() {
		await this.#dialog.locator('[data-download-close]').click();
	}
}
