import { expect } from '@playwright/test';

/** The header of the page: volumes, the notices and the buttons that come and go (DESIGN.md §9.1). */
export class HeaderPage {
	#page;

	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		this.#page = page;
	}

	/** @param {'master' | 'music' | 'sfx'} bus */
	#volume(bus) {
		return this.#page.locator(`[data-volume="${bus}"]`);
	}

	/**
	 * Types a level into a volume's dB field, such as `-6`.
	 * @param {'master' | 'music' | 'sfx'} bus
	 * @param {string} db
	 */
	async setVolume(bus, db) {
		await this.#volume(bus).locator('[data-gain-readout]').click();
		const field = this.#volume(bus).getByRole('textbox');
		await field.fill(db);
		await field.press('Enter');
	}

	/**
	 * @param {'master' | 'music' | 'sfx'} bus
	 * @param {string} reading as shown, such as "-6.0 dB" (the screen uses a real minus sign)
	 */
	async expectVolume(bus, reading) {
		await expect(this.#volume(bus).locator('[data-gain-readout]')).toHaveText(reading.replace('-', '−'));
	}

	/** The yellow button that appears when files in the folder changed (DESIGN.md §6.7). */
	async expectExternalChangesButton() {
		await expect(this.#page.getByRole('button', { name: 'External Changes – Refresh' })).toBeVisible();
	}

	async expectNoExternalChangesButton() {
		await expect(this.#page.getByRole('button', { name: 'External Changes – Refresh' })).toBeHidden();
	}

	async refreshExternalChanges() {
		await this.#page.getByRole('button', { name: 'External Changes – Refresh' }).click();
	}

	/** @param {string} text as shown, such as "Waveforms 0 / 10" */
	async expectWaveforms(text) {
		await expect(this.#page.locator('[data-waveform-indicator]')).toBeVisible();
		await expect(this.#page.locator('[data-waveform-indicator]')).toContainText(text);
	}

	async expectNoWaveforms() {
		await expect(this.#page.locator('[data-waveform-indicator]')).toBeHidden();
	}

	async stopWaveforms() {
		await this.#page.getByRole('button', { name: 'Stop making waveforms' }).click();
	}

	async continueWaveforms() {
		await this.#page.getByRole('button', { name: 'Make the missing waveforms' }).click();
	}

	/** @param {string} size as shown, such as "0.1 MB" */
	async expectTrash(size) {
		await expect(this.#page.locator('[data-trash-button]')).toHaveText(`Trash · ${size}`);
	}

	async expectNoTrash() {
		await expect(this.#page.locator('[data-trash-button]')).toBeHidden();
	}

	async openTrash() {
		await this.#page.locator('[data-trash-button]').click();
	}
}
