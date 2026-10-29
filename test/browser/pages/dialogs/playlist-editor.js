import { expect } from '@playwright/test';
import { CustomizeDialog } from './customize-dialog.js';

/** The Customize dialog of a playlist (DESIGN.md §9.7). */
export class PlaylistEditorPage extends CustomizeDialog {
	/** @param {import('@playwright/test').Page} page */
	constructor(page) {
		super(page, 'Customize playlist');
	}

	/** @param {'ordered' | 'random' | 'shuffle'} order */
	async chooseOrder(order) {
		await this._dialog.locator(`[data-radio-group="playback-order"] [data-radio-value="${order}"]`).check();
	}

	/** @param {'ordered' | 'random' | 'shuffle'} order */
	async expectOrder(order) {
		await expect(this._dialog.locator(`[data-radio-group="playback-order"] [data-radio-value="${order}"]`)).toBeChecked();
	}

	/** @param {boolean} on */
	async setRepeatPlaylist(on) {
		await this._dialog.locator('[data-checkbox="playlist-looping"]').setChecked(on);
	}

	/** @param {boolean} on */
	async setRepeatTrack(on) {
		await this._dialog.locator('[data-checkbox="track-looping"]').setChecked(on);
	}

	/** @param {'pause' | 'resetTrack' | 'resetPlaylist'} mode */
	async chooseWhenStopped(mode) {
		await this._dialog.locator(`[data-radio-group="stop-mode"] [data-radio-value="${mode}"]`).check();
	}

	/** @param {string} seconds */
	async setCrossfade(seconds) {
		await this._setSeconds('crossfade', 'Crossfade', seconds);
	}

	/** @param {string} reading */
	async expectCrossfade(reading) {
		await this._expectSeconds('crossfade', reading);
	}

	/** @param {string} seconds */
	async setFadeIn(seconds) {
		await this._setSeconds('fadeIn', 'Fade in', seconds);
	}

	/** @param {string} seconds */
	async setFadeOut(seconds) {
		await this._setSeconds('fadeOut', 'Fade out', seconds);
	}

	async openTracksTab() {
		await this._dialog.locator('[data-tab="tracks"]').click();
	}

	/** @param {string} label as shown on the tab, such as "Tracks (2)" */
	async expectTracksTab(label) {
		await expect(this._dialog.locator('[data-tab="tracks"]')).toHaveText(label);
	}

	/** @param {number} count the tracks listed on the open Tracks tab */
	async expectTrackCount(count) {
		await expect(this._dialog.locator('[data-track-row]')).toHaveCount(count);
	}
}
