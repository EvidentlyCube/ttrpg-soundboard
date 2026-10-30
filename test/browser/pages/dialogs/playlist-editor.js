import { expect } from '@playwright/test';
import { CustomizeDialog } from './customize-dialog.js';
import { TrackRowPage } from './track-row.js';

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

	/** A track's row on the Tracks tab. @param {string} title the track's title */
	track(title) {
		return new TrackRowPage(this._page, this._dialog, title);
	}

	/** @param {'playlist' | 'tracks'} tab */
	async expectTabSelected(tab) {
		await expect(this._dialog.locator(`[data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
	}

	/** @param {string[]} titles the tracks listed on the open Tracks tab, in order */
	async expectTrackTitles(titles) {
		await expect(this._dialog.locator('[data-track-row]')).toHaveText(titles.map((title) => new RegExp(title)));
	}

	/** The crossfade field's note, such as the limit set by the shortest track. @param {string | RegExp} text */
	async expectCrossfadeNote(text) {
		await expect(this._dialog.locator('[data-seconds-control="crossfade"]')).toContainText(text);
	}

	/** Holds the playlist's own delete button down, on the first tab. */
	async holdToDeletePlaylist() {
		await this._dialog.getByRole('button', { name: 'Hold to delete' }).first().click({ delay: 700 });
	}

	/** @param {string} reading as shown, such as "1.000 s" */
	async expectFadeIn(reading) {
		await this._expectSeconds('fadeIn', reading);
	}

	/** @param {string} reading as shown, such as "2.500 s" */
	async expectFadeOut(reading) {
		await this._expectSeconds('fadeOut', reading);
	}

	async openPlaylistTab() {
		await this._dialog.locator('[data-tab="playlist"]').click();
	}

	/** @param {string} message part of the reason shown in the save status */
	async expectSaveFailed(message) {
		await expect(this._dialog.getByRole('status')).toContainText(new RegExp(`Could not save: .*${message}`));
	}

	/** Presses "+ Add tracks" on the Tracks tab. */
	async addTracks() {
		await this._dialog.locator('[data-add-tracks]').click();
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
