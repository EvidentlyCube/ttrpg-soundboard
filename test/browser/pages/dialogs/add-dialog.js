import { expect } from '@playwright/test';

/** The dialog that adds sounds, a playlist or tracks from a link (DESIGN.md §9.9). */
export class AddDialogPage {
	#page;
	#dialog;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
		this.#dialog = page.getByRole('dialog', { name: /^Add (sounds|a playlist|tracks)/ });
	}

	async expectOpen() {
		await expect(this.#dialog).toBeVisible();
	}

	/** The notice that shows instead when yt-dlp or ffmpeg is missing. @param {string | RegExp} text */
	async expectUnavailable(text) {
		const notice = this.#page.getByRole('dialog', { name: 'Downloads are not available' });
		await expect(notice).toBeVisible();
		await expect(notice).toContainText(text);
	}

	async expectClosed() {
		await expect(this.#dialog).toBeHidden();
	}

	/** @param {string} title the dialog's title, such as "Add tracks to Rain" */
	async expectTitle(title) {
		await expect(this.#dialog).toHaveAccessibleName(title);
	}

	/** Types a link and presses Look up. @param {string} url */
	async lookUp(url) {
		await this.#dialog.locator('[data-add-link]').fill(url);
		await this.#dialog.locator('[data-add-look-up]').click();
	}

	/** Types a link and presses Enter in the field. @param {string} url */
	async lookUpWithEnter(url) {
		const field = this.#dialog.locator('[data-add-link]');
		await field.fill(url);
		await field.press('Enter');
	}

	/** Presses Look up with the field empty. */
	async pressLookUp() {
		await this.#dialog.locator('[data-add-look-up]').click();
	}

	async expectLinkFocused() {
		await expect(this.#dialog.locator('[data-add-link]')).toBeFocused();
	}

	/** @param {string | RegExp} message what the red line under the field says */
	async expectError(message) {
		await expect(this.#dialog.locator('[data-add-error]')).toContainText(message);
	}

	/** @param {string | RegExp} text something the lookup found, such as a title or "3 entries" */
	async expectFound(text) {
		await expect(this.#dialog).toContainText(text);
	}

	/** @param {string} label such as "Download 1.0 MB", or just "Download" */
	async expectDownloadButton(label) {
		await expect(this.#dialog.locator('[data-add-download]')).toHaveText(label);
	}

	/** @param {boolean} enabled */
	async expectDownloadEnabled(enabled) {
		await expect(this.#dialog.locator('[data-add-download]')).toBeEnabled({ enabled });
	}

	async download() {
		await this.#dialog.locator('[data-add-download]').click();
	}

	/** @param {string | null} text the warning above the Download button, or null when there is none */
	async expectWarning(text) {
		const warning = this.#dialog.locator('[data-add-warning]');
		await (text === null ? expect(warning).toBeHidden() : expect(warning).toHaveText(text));
	}

	/** Looks up the playlist a video link also names. */
	async showWholePlaylist() {
		await this.#dialog.locator('[data-add-whole-playlist]').click();
	}

	async expectWholePlaylistOffered(offered = true) {
		await expect(this.#dialog.locator('[data-add-whole-playlist]')).toBeVisible({ visible: offered });
	}

	/** @param {'whole' | 'chapters'} mode */
	async chooseMode(mode) {
		await this.#dialog.locator(`[data-radio-group="add-mode"] [data-radio-value="${mode}"]`).check();
	}

	/** @param {string} id a chapter's number from 0, or a playlist entry's id @param {boolean} chosen */
	async choose(id, chosen) {
		await this.#dialog.locator(`[data-add-choice="${id}"]`).setChecked(chosen);
	}

	async selectNone() {
		await this.#dialog.getByRole('button', { name: 'Select none' }).click();
	}

	async selectAll() {
		await this.#dialog.getByRole('button', { name: 'Select all' }).click();
	}

	/** @param {string} text such as "2 of 3 chosen" */
	async expectChosen(text) {
		await expect(this.#dialog).toContainText(text);
	}

	/** @param {string} title */
	async setPlaylistTitle(title) {
		await this.#dialog.locator('[data-add-playlist-title]').fill(title);
	}

	/** @param {string} title */
	async expectPlaylistTitle(title) {
		await expect(this.#dialog.locator('[data-add-playlist-title]')).toHaveValue(title);
	}

	async pressEscape() {
		await this.#page.keyboard.press('Escape');
	}
}
