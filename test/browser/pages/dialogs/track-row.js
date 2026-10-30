import { expect } from '@playwright/test';

/** One track in the Tracks tab of the playlist dialog (DESIGN.md §9.7): its header row and the settings that open under it. */
export class TrackRowPage {
	#row;
	#header;
	#body;
	#page;

	/**
	 * @param {import('@playwright/test').Page} page
	 * @param {import('@playwright/test').Locator} dialog the playlist dialog
	 * @param {string} title the track's title, as the row shows it
	 */
	constructor(page, dialog, title) {
		this.#page = page;
		this.#row = dialog.locator('[data-track-accordion] > li').filter({ has: page.locator('[data-track-row]', { hasText: title }) });
		this.#header = this.#row.locator('[data-track-row]');
		this.#body = this.#row.locator('[data-track-body]');
	}

	async open() {
		if (await this.#header.getAttribute('aria-expanded') !== 'true') {
			await this.#header.click();
		}
		await expect(this.#body).toBeVisible();
	}

	async expectOpen() {
		await expect(this.#body).toBeVisible();
	}

	async expectClosed() {
		await expect(this.#body).toBeHidden();
	}

	async toggle() {
		await this.#header.click();
	}

	async expectShown() {
		await expect(this.#row).toBeVisible();
	}

	async expectGone() {
		await expect(this.#row).toHaveCount(0);
	}

	/** @param {number} number the position shown in front of the title, from 1 */
	async expectNumber(number) {
		await expect(this.#header).toContainText(String(number));
	}

	/** Types a new title in the open row. @param {string} title */
	async rename(title) {
		await this.#body.locator('[data-item-title]').fill(title);
	}

	/** @param {string} title the row's header */
	async expectHeader(title) {
		await expect(this.#header).toContainText(title);
	}

	/** Types a level into the track's volume field. @param {string} db such as `-6` */
	async setVolume(db) {
		await this.#body.locator('[data-gain-readout]').click();
		const field = this.#body.getByLabel('Track volume in dB');
		await field.fill(db);
		await field.press('Enter');
	}

	/** The bubble in the header that shows a volume different from the file's. @param {string | null} reading such as "-6.0 dB", or null while it is hidden */
	async expectVolumeBubble(reading) {
		const bubble = this.#row.locator('[data-track-volume]');
		await (reading === null ? expect(bubble).toBeHidden() : expect(bubble).toHaveText(reading.replace('-', '−')));
	}

	/** @param {boolean} cropped whether the header says that only part of the file plays */
	async expectCropped(cropped) {
		await expect(this.#row.locator('[data-track-cropped]')).toBeVisible({ visible: cropped });
	}

	/** @param {string} seconds */
	async setStart(seconds) {
		const field = this.#body.getByLabel('Start point in seconds');
		await field.fill(seconds);
		await field.press('Enter');
	}

	async resetRange() {
		await this.#body.locator('[data-range-reset]').click();
	}

	/** Presses the play button of the row. */
	async play() {
		await this.#row.locator('[data-track-play]').click();
	}

	/** @param {'idle' | 'playing' | 'paused'} state what the row's play button shows */
	async expectPlayback(state) {
		await expect(this.#row.locator('[data-track-play]')).toHaveAttribute('data-playback', state);
	}

	/** While it plays, the points are a seek bar: the handles and the fields are out of reach. */
	async expectSeekBar() {
		await expect(this.#body.locator('[data-range-track]')).toHaveAttribute('data-mode', 'seek');
		await expect(this.#body.getByLabel('Start point in seconds')).toBeDisabled();
	}

	async expectEditableRange() {
		await expect(this.#body.locator('[data-range-track]')).toHaveAttribute('data-mode', 'edit');
		await expect(this.#body.getByLabel('Start point in seconds')).toBeEnabled();
	}

	/** Presses the progress part of the seek bar. @param {number} fraction 0 to 1 */
	async seekTo(fraction) {
		const box = await this.#body.locator('[data-range-track]').boundingBox();
		if (!box) {
			throw new Error('The seek bar is not on screen');
		}
		await this.#page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
	}

	async openMove() {
		await this.#body.locator('[data-move-item]').click();
	}

	/** Holds the delete button of the open row until it acts. */
	async holdToDelete() {
		await this.#body.getByRole('button', { name: 'Hold to delete' }).click({ delay: 700 });
	}

	/** @param {string | RegExp} text what the Move or delete card says about the last track */
	async expectNote(text) {
		await expect(this.#body).toContainText(text);
	}
}
