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

	async #volumeBox() {
		const box = await this._dialog.locator('[data-gain-track]').first().boundingBox();
		if (!box) {
			throw new Error('The volume bar is not on screen');
		}
		return box;
	}

	/**
	 * Presses the volume bar and drags on, if asked.
	 * @param {number} from where on the bar, from 0 (silent) to 1 (the boost's end); 0.75 is 0 dB
	 * @param {number} [to] where to drag to before letting go
	 */
	async dragVolume(from, to = from) {
		const box = await this.#volumeBox();
		const y = box.y + box.height / 2;
		await this._page.mouse.move(box.x + box.width * from, y);
		await this._page.mouse.down();
		await this._page.mouse.move(box.x + box.width * to, y, { steps: 5 });
		await this._page.mouse.up();
	}

	async resetVolumeByDoubleClick() {
		await this._dialog.locator('[data-gain-track]').first().dblclick();
	}

	/** Focuses the volume bar and presses keys on it, such as `ArrowUp` or `Home`. @param {...string} keys */
	async pressOnVolume(...keys) {
		await this._dialog.locator('[data-gain-track]').first().focus();
		for (const key of keys) {
			await this._page.keyboard.press(key);
		}
	}

	/** Opens the dB field, unless it is open, and types, without confirming. @param {string} text */
	async typeVolume(text) {
		const readout = this._dialog.locator('[data-gain-readout]').first();
		if (await readout.isVisible()) {
			await readout.click();
		}
		await this._dialog.getByLabel('Volume in dB').first().fill(text);
	}

	async pressEnterInVolumeField() {
		await this._dialog.getByLabel('Volume in dB').first().press('Enter');
	}

	async pressEscapeInVolumeField() {
		await this._dialog.getByLabel('Volume in dB').first().press('Escape');
	}

	/** @param {boolean} invalid whether the open dB field is marked red */
	async expectVolumeFieldInvalid(invalid) {
		await expect(this._dialog.getByLabel('Volume in dB').first()).toHaveAttribute('data-invalid', String(invalid));
	}

	/** @param {boolean} boosted whether the readout shows the orange boost state above 0 dB */
	async expectVolumeBoosted(boosted) {
		await expect(this._dialog.locator('[data-gain-readout]').first()).toHaveAttribute('data-boost', String(boosted));
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

	/** Holds the delete button down until it acts. */
	async holdToDelete() {
		await this._dialog.getByRole('button', { name: 'Hold to delete' }).click({ delay: 700 });
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
