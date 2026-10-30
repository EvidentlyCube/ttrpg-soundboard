import { expect } from '@playwright/test';

/** The Move dialog for a sound or a track (DESIGN.md §9.11). */
export class MoveDialogPage {
	#dialog;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#dialog = page.getByRole('dialog', { name: /^Move/ });
	}

	/** @param {string} title */
	#target(title) {
		return this.#dialog.locator('[data-move-target]').filter({ hasText: title });
	}

	async expectOpen() {
		await expect(this.#dialog).toBeVisible();
	}

	async expectClosed() {
		await expect(this.#dialog).toBeHidden();
	}

	/** @param {string[]} titles every destination, the sound effects first */
	async expectDestinations(titles) {
		await expect(this.#dialog.locator('[data-move-target] span.truncate')).toHaveText(titles);
	}

	/** @param {string} title the item's current place, which cannot be picked */
	async expectHere(title) {
		await expect(this.#target(title)).toBeDisabled();
		await expect(this.#target(title)).toContainText('Here now');
	}

	/** Picks a destination, which moves the item at once. @param {string} title "Sound effects" or a playlist's title */
	async moveTo(title) {
		await this.#target(title).click();
	}

	/** @param {string} message part of the error the dialog shows */
	async expectError(message) {
		await expect(this.#dialog.locator('[data-move-error]')).toContainText(message);
	}
}
