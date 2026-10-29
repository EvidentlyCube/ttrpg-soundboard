import { expect } from '@playwright/test';

/** What the sound and playlist Customize dialogs share (DESIGN.md §9.7). */
export class CustomizeDialog {
	_page;
	_dialog;

	/**
	 * @param {import('@playwright/test').Page} page
	 * @param {string} name the dialog's title
	 */
	constructor(page, name) {
		this._page = page;
		this._dialog = page.getByRole('dialog', { name });
	}

	async expectOpen() {
		await expect(this._dialog).toBeVisible();
	}

	async expectClosed() {
		await expect(this._dialog).toBeHidden();
	}

	async close() {
		await this._dialog.getByRole('button', { name: 'Close' }).click();
	}

	async pressEscape() {
		await this._page.keyboard.press('Escape');
	}

	async expectTitleFocused() {
		await expect(this._dialog.locator('[data-item-title]').first()).toBeFocused();
	}

	/** Types a new title, as a person would. @param {string} title */
	async setTitle(title) {
		await this._dialog.locator('[data-item-title]').first().fill(title);
	}

	/** @param {string} title */
	async expectTitle(title) {
		await expect(this._dialog.locator('[data-item-title]').first()).toHaveValue(title);
	}

	/** Types a level into the volume's dB field, such as `-6`. @param {string} db */
	async setVolume(db) {
		await this._dialog.locator('[data-gain-readout]').first().click();
		const field = this._dialog.getByLabel('Volume in dB').first();
		await field.fill(db);
		await field.press('Enter');
	}

	/** @param {string} reading as shown, such as "-6.0 dB" (the screen uses a real minus sign) */
	async expectVolume(reading) {
		await expect(this._dialog.locator('[data-gain-readout]').first()).toHaveText(reading.replace('-', '−'));
	}

	/**
	 * @param {'fadeIn' | 'fadeOut' | 'crossfade'} name
	 * @param {string} label
	 * @param {string} seconds
	 */
	async _setSeconds(name, label, seconds) {
		await this._dialog.locator(`[data-seconds-control="${name}"] [data-seconds-readout]`).click();
		const field = this._dialog.getByLabel(`${label} in seconds`);
		await field.fill(seconds);
		await field.press('Enter');
	}

	/**
	 * @param {'fadeIn' | 'fadeOut' | 'crossfade'} name
	 * @param {string} reading as shown, such as "0.500 s" or "Off"
	 */
	async _expectSeconds(name, reading) {
		await expect(this._dialog.locator(`[data-seconds-control="${name}"] [data-seconds-readout]`)).toHaveText(reading);
	}

	async play() {
		await this._dialog.getByRole('button', { name: 'Play' }).click();
	}

	async stop() {
		await this._dialog.getByRole('button', { name: 'Stop' }).click();
	}

	/** The Play button turns into Stop while the item plays. */
	async expectPlaying() {
		await expect(this._dialog.getByRole('button', { name: 'Stop' })).toBeVisible();
	}

	async expectSaving() {
		await expect(this._dialog.getByRole('status', { name: 'Saving' })).toBeVisible();
	}

	async expectSaved() {
		await expect(this._dialog.getByRole('status', { name: 'Saved' })).toBeVisible();
	}
}
