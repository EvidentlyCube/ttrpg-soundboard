import { test, expect } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';
const SOUND = 'Base Connected';

/**
 * Whether the page would ask before unloading: a cancelable `beforeunload` is dispatched and checked, so no
 * real navigation happens.
 * @param {import('@playwright/test').Page} page
 */
function asksBeforeUnload(page) {
	return page.evaluate(() => {
		const event = new Event('beforeunload', { cancelable: true });
		globalThis.dispatchEvent(event);
		return event.defaultPrevented;
	});
}

test.beforeEach(async ({ soundboard, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.script('Piece by Piece', { duration: 100 });
	await audio.script(SOUND, { duration: 60 });
});

test('a silent board lets the page go', async ({ page }) => {
	expect(await asksBeforeUnload(page)).toBe(false);
});

test('a playing playlist makes the page ask, and stopping it ends that', async ({ page, playlists, footer, audio }) => {
	await playlists.click(PLAYLIST);
	await audio.expectPlaying('Piece by Piece');
	expect(await asksBeforeUnload(page)).toBe(true);

	await footer.pressPanic();
	await footer.pressPanic();
	await audio.expectNothingPlaying();
	expect(await asksBeforeUnload(page)).toBe(false);
});

test('a paused playlist makes the page ask', async ({ page, playlists, footer, audio }) => {
	await playlists.click(PLAYLIST);
	await audio.expectPlaying('Piece by Piece');
	await footer.player(PLAYLIST).pause();
	expect(await asksBeforeUnload(page)).toBe(true);
});

test('a playing sound makes the page ask, and its end ends that', async ({ page, sounds, audio }) => {
	await sounds.click(SOUND);
	await audio.expectPlaying(SOUND);
	expect(await asksBeforeUnload(page)).toBe(true);

	await audio.advance(61000);
	await audio.expectNothingPlaying();
	expect(await asksBeforeUnload(page)).toBe(false);
});

test('the reload after refreshing external changes does not ask', async ({ page, playlists, audio, header, disk, splash }) => {
	await playlists.click(PLAYLIST);
	await audio.expectPlaying('Piece by Piece');
	/** @type {string[]} */
	const prompts = [];
	page.on('dialog', async (dialog) => {
		prompts.push(dialog.type());
		await dialog.dismiss();
	});
	await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');

	await header.expectExternalChangesButton();
	await header.refreshExternalChanges();

	await splash.expectVisible();
	expect(prompts).toEqual([]);
});
