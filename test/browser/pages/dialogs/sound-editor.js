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

	/** @param {'start' | 'end'} which */
	#handle(which) {
		return this._dialog.locator(`[data-range-handle="${which}"]`);
	}

	/** @param {'start' | 'end'} which */
	#field(which) {
		return this._dialog.getByLabel(`${which === 'start' ? 'Start' : 'End'} point in seconds`);
	}

	/** The slider the handles sit on, to press and drag. */
	async #trackBox() {
		const box = await this._dialog.locator('[data-range-track]').boundingBox();
		if (!box) {
			throw new Error('The range slider is not on screen');
		}
		return box;
	}

	/**
	 * Presses the slider at a point, which moves the nearer handle there, and drags on to another if asked.
	 * @param {number} from where on the slider, from 0 (start of the file) to 1 (end)
	 * @param {number} [to] where to drag to before letting go
	 */
	async dragOnRange(from, to = from) {
		const box = await this.#trackBox();
		const y = box.y + box.height / 2;
		await this._page.mouse.move(box.x + box.width * from, y);
		await this._page.mouse.down();
		await this._page.mouse.move(box.x + box.width * to, y, { steps: 5 });
		await this._page.mouse.up();
	}

	/**
	 * Presses a handle itself and drags it, so the handle that moves is the one grabbed, not the nearer one.
	 * @param {'start' | 'end'} which
	 * @param {number} to where on the slider, from 0 to 1
	 */
	async dragHandle(which, to) {
		const handle = await this.#handle(which).boundingBox();
		const box = await this.#trackBox();
		if (!handle) {
			throw new Error(`The ${which} handle is not on screen`);
		}
		const y = handle.y + handle.height / 2;
		await this._page.mouse.move(handle.x + handle.width / 2, y);
		await this._page.mouse.down();
		await this._page.mouse.move(box.x + box.width * to, y, { steps: 5 });
		await this._page.mouse.up();
	}

	/**
	 * Focuses a handle and presses keys on it, such as `ArrowRight` or `Shift+ArrowLeft`.
	 * @param {'start' | 'end'} which
	 * @param {...string} keys
	 */
	async pressOnHandle(which, ...keys) {
		await this.#handle(which).focus();
		for (const key of keys) {
			await this._page.keyboard.press(key);
		}
	}

	/** @param {'start' | 'end'} which @param {number} milliseconds where the handle is */
	async expectHandleAt(which, milliseconds) {
		await expect(this.#handle(which)).toHaveAttribute('aria-valuenow', String(milliseconds));
	}

	/** Types into a point's field and leaves Enter alone, as when a person is still typing. @param {'start' | 'end'} which @param {string} text */
	async typeInField(which, text) {
		await this.#field(which).fill(text);
	}

	/** @param {'start' | 'end'} which */
	async pressEnterInField(which) {
		await this.#field(which).press('Enter');
	}

	/** @param {'start' | 'end'} which */
	async pressEscapeInField(which) {
		await this.#field(which).press('Escape');
	}

	/** @param {'start' | 'end'} which @param {string} text as the field shows it, such as "1.250" */
	async expectField(which, text) {
		await expect(this.#field(which)).toHaveValue(text);
	}

	/** @param {'start' | 'end'} which @param {boolean} invalid whether the field is marked red for text it could not read */
	async expectFieldInvalid(which, invalid) {
		await expect(this.#field(which)).toHaveAttribute('data-invalid', String(invalid));
	}

	/** The pulsing red bands that say the fades cannot play out, since they overlap or are longer than the part that plays. @param {boolean} shown */
	async expectFadeWarning(shown) {
		const warning = this._dialog.locator('[data-range-control] .animate-warn:not([style*="width: 0%"])');
		await (shown ? expect(warning.first()).toBeVisible() : expect(warning).toHaveCount(0));
	}

	/** @param {boolean} shown whether the file's waveform is drawn above the slider */
	async expectWaveform(shown) {
		await expect(this._dialog.locator('[data-range-waveform]')).toBeVisible({ visible: shown });
	}

	async resetRange() {
		await this._dialog.locator('[data-range-reset]').click();
	}

	/** @param {string} text as shown between the handles, such as "Plays 1.170 s of 1.670 s" */
	async expectRangeSays(text) {
		await expect(this._dialog.locator('[data-range-length]')).toHaveText(text);
	}
}
