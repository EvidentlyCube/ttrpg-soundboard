import { expect } from '@playwright/test';

/** The Trash dialog (DESIGN.md §9.12). */
export class TrashPage {
	#dialog;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#dialog = page.getByRole('dialog', { name: 'Trash' });
	}

	/** @param {string} title */
	#row(title) {
		return this.#dialog.locator('[data-trash-item]').filter({ hasText: title });
	}

	async expectOpen() {
		await expect(this.#dialog).toBeVisible();
	}

	async expectClosed() {
		await expect(this.#dialog).toBeHidden();
	}

	/** @param {string} title */
	async expectHolding(title) {
		await expect(this.#row(title)).toBeVisible();
	}

	/** Holds the row's Restore button down until it acts. @param {string} title */
	async restore(title) {
		await this.#row(title).getByRole('button', { name: 'Restore' }).click({ delay: 700 });
	}

	/** Holds the row's Delete button down until it acts. @param {string} title */
	async deleteForever(title) {
		await this.#row(title).getByRole('button', { name: 'Delete' }).click({ delay: 700 });
	}

	/** @param {string[]} kinds the kind of every row, top to bottom: 'playlist', 'track' (indented under its playlist) or 'sound' */
	async expectRowKinds(kinds) {
		const rows = this.#dialog.locator('[data-trash-item]');
		await expect.poll(() => rows.evaluateAll((elements) => elements.map((element) => /** @type {HTMLElement} */ (element).dataset.trashItem))).toEqual(kinds);
	}

	/** @param {string} title @param {string} detail text under the title, such as "2 tracks" */
	async expectDetail(title, detail) {
		await expect(this.#row(title)).toContainText(detail);
	}

	/** @param {string} title */
	async expectNotHolding(title) {
		await expect(this.#row(title)).toHaveCount(0);
	}

	/** @param {string} text such as "0.7 MB in total" */
	async expectTotal(text) {
		await expect(this.#dialog.getByText(/ in total$/)).toHaveText(text);
	}

	/** Holds Restore all down for the two seconds it takes. */
	async restoreAll() {
		await this.#dialog.getByRole('button', { name: 'Restore all' }).click({ delay: 2300 });
	}

	/** Holds Delete all down for the two seconds it takes. */
	async deleteAll() {
		await this.#dialog.getByRole('button', { name: 'Delete all' }).click({ delay: 2300 });
	}

	/** Holds Restore all for a second, which is not long enough. */
	async holdRestoreAllTooShort() {
		await this.#dialog.getByRole('button', { name: 'Restore all' }).click({ delay: 1000 });
	}

	/** @param {string | RegExp} text what the red line in the dialog says */
	async expectError(text) {
		await expect(this.#dialog.locator('[data-trash-error]')).toContainText(text);
	}
}
