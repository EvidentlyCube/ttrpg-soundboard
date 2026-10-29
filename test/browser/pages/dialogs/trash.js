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
}
