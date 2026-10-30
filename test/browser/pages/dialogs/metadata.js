import { expect } from '@playwright/test';

/** The Metadata dialog of a sound or a playlist (DESIGN.md §9.13). */
export class MetadataPage {
	#dialog;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#dialog = page.getByRole('dialog', { name: /^Metadata/ });
	}

	/** @param {string} file the file's id, such as `Boom.mp3` or `Rain/a.mp3` */
	#card(file) {
		return this.#dialog.locator(`[data-metadata-file="${file}"]`);
	}

	/**
	 * @param {string} file
	 * @param {string} label the row's name, such as "Video"
	 */
	#value(file, label) {
		return this.#card(file).locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
	}

	/** @param {string} title the dialog's title, such as `Metadata: "Boom.mp3"` */
	async expectTitle(title) {
		await expect(this.#dialog).toHaveAccessibleName(title);
	}

	async expectOpen() {
		await expect(this.#dialog).toBeVisible();
	}

	async expectClosed() {
		await expect(this.#dialog).toBeHidden();
	}

	/** @param {string[]} titles the cards' headings, in order, such as "1. a.mp3" */
	async expectCards(titles) {
		await expect(this.#dialog.locator('[data-metadata="playlist"] > *')).toHaveCount(titles.length);
		for (const title of titles) {
			await expect(this.#dialog).toContainText(title);
		}
	}

	/** @param {string} file @param {string} label @param {string} text what the row says */
	async expectRow(file, label, text) {
		await expect(this.#value(file, label)).toContainText(text);
	}

	/** A row without a value says "n/a". @param {string} file @param {string} label */
	async expectNotAvailable(file, label) {
		await expect(this.#value(file, label)).toHaveText('n/a');
	}

	/** @param {string} file @param {string} label @param {string} href where the row's value links to */
	async expectLink(file, label, href) {
		await expect(this.#value(file, label).locator('a').first()).toHaveAttribute('href', href);
	}

	/** @param {string} file @param {string} label */
	async expectNoLink(file, label) {
		await expect(this.#value(file, label)).toBeVisible();
		await expect(this.#value(file, label).locator('a')).toHaveCount(0);
	}

	/** The second link after a value, such as "in playlist". @param {string} file @param {string} label @param {string} text @param {string} href */
	async expectExtraLink(file, label, text, href) {
		const link = this.#value(file, label).getByRole('link', { name: text });
		await expect(link).toHaveAttribute('href', href);
	}
}
