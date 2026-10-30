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

	/** The button while the server rebuilds its library: disabled, and reading "Refreshing…". */
	async expectRefreshing() {
		const button = this.#page.locator('[data-external-changes]');
		await expect(button).toBeDisabled();
		await expect(button).toHaveText('Refreshing…');
	}

	/** The dialog that lists why a refresh failed. @param {string} path the file @param {string} message part of what is wrong with it */
	async expectRefreshFailure(path, message) {
		const dialog = this.#page.getByRole('dialog', { name: 'Could not load the changes' });
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText(path);
		await expect(dialog).toContainText(message);
	}

	async dismissRefreshFailure() {
		await this.#page.getByRole('dialog', { name: 'Could not load the changes' }).getByRole('button', { name: 'Close' }).click();
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

	/** Picks "Regenerate waveforms" in the ☰ menu. */
	async regenerateWaveforms() {
		await this.#page.getByRole('button', { name: 'Menu' }).click();
		await this.#page.getByRole('menuitem', { name: 'Regenerate waveforms', exact: true }).click();
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

	/** @param {string} text as shown, such as "2 problems" */
	async expectProblems(text) {
		await expect(this.#page.locator('[data-problems-button]')).toHaveText(text);
	}

	async expectNoProblems() {
		await expect(this.#page.locator('[data-problems-button]')).toBeHidden();
	}

	async openProblems() {
		await this.#page.locator('[data-problems-button]').click();
	}

	/** The bug button that opens or closes the debug view (DESIGN.md §9.8). */
	async toggleDebug() {
		await this.#page.getByRole('button', { name: 'Debug view' }).click();
	}

	/** @param {boolean} open whether the debug panel is on screen */
	async expectDebugOpen(open) {
		await expect(this.#page.locator('[data-debug-panel]')).toBeVisible({ visible: open });
	}

	async expectDebugEmpty() {
		await expect(this.#page.locator('[data-debug-empty]')).toBeVisible();
	}

	/** @param {string} label a voice's title @param {string} status such as "playing" or "ended" */
	async expectDebugVoice(label, status) {
		const row = this.#page.locator('[data-voice]').filter({ hasText: label });
		await expect(row).toHaveAttribute('data-status', status);
	}

	async openTrash() {
		await this.#page.locator('[data-trash-button]').click();
	}
}
