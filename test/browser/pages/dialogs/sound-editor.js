import { expect } from '@playwright/test';
import { CustomizeDialog } from './customize-dialog.js';

/** The Customize dialog of a sound (DESIGN.md §9.7). */
export class SoundEditorPage extends CustomizeDialog {
	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		super(page, 'Customize sound');
	}

	/** @param {string} seconds */
	async setFadeIn(seconds) {
		await this._setSeconds('fadeIn', 'Fade in', seconds);
	}

	/** @param {string} reading */
	async expectFadeIn(reading) {
		await this._expectSeconds('fadeIn', reading);
	}

	/** @param {string} seconds */
	async setFadeOut(seconds) {
		await this._setSeconds('fadeOut', 'Fade out', seconds);
	}

	/** Types where the sound starts. @param {string} seconds */
	async setStart(seconds) {
		const field = this._dialog.getByLabel('Start point in seconds');
		await field.fill(seconds);
		await field.press('Enter');
	}

	/** Types where the sound ends. @param {string} seconds */
	async setEnd(seconds) {
		const field = this._dialog.getByLabel('End point in seconds');
		await field.fill(seconds);
		await field.press('Enter');
	}

	async resetRange() {
		await this._dialog.locator('[data-range-reset]').click();
	}

	/** @param {string} text as shown between the handles, such as "Plays 1.170 s of 1.670 s" */
	async expectRangeSays(text) {
		await expect(this._dialog.locator('[data-range-length]')).toHaveText(text);
	}
}
