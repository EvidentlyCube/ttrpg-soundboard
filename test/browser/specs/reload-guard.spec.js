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
	await test.step('Make the files long enough to still be playing', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.givenFile('Piece by Piece', { duration: 100 });
		await audio.givenFile(SOUND, { duration: 60 });
	});
});

test('a silent board lets the page go', async ({ page }) => {
	await test.step('Nothing plays: the page does not ask', async () => {
		expect(await asksBeforeUnload(page)).toBe(false);
	});
});

test('a playing playlist makes the page ask, and stopping it ends that', async ({ page, playlists, footer, audio }) => {
	await test.step('Start the playlist: the page asks', async () => {
		await playlists.click(PLAYLIST);
		await audio.expectPlaying('Piece by Piece');
		expect(await asksBeforeUnload(page)).toBe(true);
	});

	await test.step('Stop everything: the page does not ask', async () => {
		await footer.pressPanic();
		await footer.pressPanic();
		await audio.expectNothingPlaying();
		expect(await asksBeforeUnload(page)).toBe(false);
	});
});

test('a paused playlist makes the page ask', async ({ page, playlists, footer, audio }) => {
	await test.step('Start the playlist', async () => {
		await playlists.click(PLAYLIST);
		await audio.expectPlaying('Piece by Piece');
	});

	await test.step('Pause it: the page still asks', async () => {
		await footer.player(PLAYLIST).pause();
		expect(await asksBeforeUnload(page)).toBe(true);
	});
});

test('a playing sound makes the page ask, and its end ends that', async ({ page, sounds, audio }) => {
	await test.step('Play the sound: the page asks', async () => {
		await sounds.click(SOUND);
		await audio.expectPlaying(SOUND);
		expect(await asksBeforeUnload(page)).toBe(true);
	});

	await test.step('Let the sound end: the page does not ask', async () => {
		await audio.advance(61000);
		await audio.expectNothingPlaying();
		expect(await asksBeforeUnload(page)).toBe(false);
	});
});

test('the reload after refreshing external changes does not ask', async ({ page, playlists, audio, header, disk, splash }) => {
	/** @type {string[]} */
	const prompts = [];

	await test.step('Start the playlist and record any prompt the page raises', async () => {
		await playlists.click(PLAYLIST);
		await audio.expectPlaying('Piece by Piece');
		page.on('dialog', async (dialog) => {
			prompts.push(dialog.type());
			await dialog.dismiss();
		});
	});

	await test.step('Copy a file into the folder: the refresh button appears', async () => {
		await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');
		await header.expectExternalChangesButton();
	});

	await test.step('Refresh: the page reloads without a prompt', async () => {
		await header.refreshExternalChanges();
		await splash.expectVisible();
		expect(prompts).toEqual([]);
	});
});
