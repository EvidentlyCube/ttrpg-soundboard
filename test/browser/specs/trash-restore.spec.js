import { test } from '../support/fixtures.js';

const PLAYLIST = 'Music MP3';
const FIRST = 'Piece by Piece';
const SECOND = 'Intro';
const SOUND = 'Base Connected';
const SOUND_FILE = 'Sound MP3 with title tag.mp3';

/**
 * Deletes the whole playlist from its dialog, as a person would.
 * @param {Pick<import('../support/fixtures.js').Fixtures, 'playlists' | 'dialogs'>} pages
 * @param {string} title
 */
async function deletePlaylist({ playlists, dialogs }, title) {
	await playlists.useMenu(title, 'Customize');
	await dialogs.playlistEditor.holdToDeletePlaylist();
	await dialogs.playlistEditor.expectClosed();
	await playlists.expectGone(title);
}

/**
 * Deletes one sound from its dialog.
 * @param {Pick<import('../support/fixtures.js').Fixtures, 'sounds' | 'dialogs'>} pages
 * @param {string} title
 */
async function deleteSound({ sounds, dialogs }, title) {
	await sounds.useMenu(title, 'Customize');
	await dialogs.soundEditor.holdToDelete();
	await sounds.expectGone(title);
}

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test.describe('what the trash lists', () => {
	test('a deleted playlist comes with its tracks indented beneath it', async ({ playlists, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await header.openTrash();

		await dialogs.trash.expectRowKinds(['playlist', 'track', 'track', 'sound']);
		await dialogs.trash.expectDetail(PLAYLIST, '2 tracks');
		await dialogs.trash.expectHolding(FIRST);
		await dialogs.trash.expectHolding(SECOND);
		await dialogs.trash.expectHolding(SOUND);
	});

	test('a deleted track shows under its playlist, which stays on the board', async ({ playlists, dialogs, header }) => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openTracksTab();
		const track = dialogs.playlistEditor.track(FIRST);
		await track.open();
		await track.holdToDelete();
		await track.expectGone();
		await dialogs.playlistEditor.close();
		await playlists.expectStatus(PLAYLIST, '1 track');

		await header.openTrash();

		await dialogs.trash.expectRowKinds(['playlist', 'track']);
		await dialogs.trash.expectDetail(PLAYLIST, '1 track');
	});
});

test.describe('restoring', () => {
	test('a playlist comes back from its saved options with all its tracks', async ({ playlists, dialogs, header, audio }) => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.chooseOrder('shuffle');
		await dialogs.playlistEditor.setCrossfade('2');
		await audio.advance(500);
		await dialogs.playlistEditor.expectSaved();
		await dialogs.playlistEditor.holdToDeletePlaylist();
		await playlists.expectGone(PLAYLIST);
		await header.openTrash();

		await dialogs.trash.restore(PLAYLIST);

		await dialogs.trash.expectClosed();
		await playlists.expectShown(PLAYLIST);
		await playlists.expectStatus(PLAYLIST, '2 tracks');
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.expectOrder('shuffle');
		await dialogs.playlistEditor.expectCrossfade('2.000 s');
	});

	test('a track goes back into its playlist', async ({ playlists, dialogs, header }) => {
		await playlists.useMenu(PLAYLIST, 'Customize');
		await dialogs.playlistEditor.openTracksTab();
		const track = dialogs.playlistEditor.track(FIRST);
		await track.open();
		await track.holdToDelete();
		await track.expectGone();
		await dialogs.playlistEditor.close();
		await header.openTrash();

		await dialogs.trash.restore(FIRST);

		await dialogs.trash.expectClosed();
		await playlists.expectStatus(PLAYLIST, '2 tracks');
	});

	test('one track of a deleted playlist brings the playlist back with just that track', async ({ playlists, dialogs, header }) => {
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);
		await header.openTrash();

		await dialogs.trash.restore(SECOND);

		await playlists.expectShown(PLAYLIST);
		await playlists.expectStatus(PLAYLIST, '1 track');
		await dialogs.trash.expectHolding(FIRST);
		await dialogs.trash.expectNotHolding(SECOND);
	});

	test('a sound whose name is taken again comes back with a (2) in its name', async ({ soundboard, splash, sounds, disk, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await disk.addCopyOf(SOUND_FILE, SOUND_FILE);
		await header.expectExternalChangesButton();
		await header.refreshExternalChanges();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await sounds.expectShown(SOUND);
		await header.openTrash();

		await dialogs.trash.restore(SOUND);

		await dialogs.trash.expectClosed();
		await sounds.expectCount(SOUND, 2);
		await disk.expectFile('Sound MP3 with title tag (2).mp3');
	});

	test('everything comes back with Restore all, only when it has been held for two seconds', async ({ playlists, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);
		await header.openTrash();

		await dialogs.trash.holdRestoreAllTooShort();
		await dialogs.trash.expectHolding(SOUND);

		await dialogs.trash.restoreAll();

		await dialogs.trash.expectClosed();
		await header.expectNoTrash();
		await sounds.expectShown(SOUND);
		await playlists.expectStatus(PLAYLIST, '2 tracks');
	});

	test('a restore that fails says why and keeps everything in the trash', async ({ page, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await page.route('**/api/trash/restore', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the folder is read-only' }) }));
		await header.openTrash();

		await dialogs.trash.restore(SOUND);

		await dialogs.trash.expectError('Could not restore: the folder is read-only');
		await dialogs.trash.expectHolding(SOUND);
		await sounds.expectGone(SOUND);
	});
});

test.describe('deleting for good', () => {
	test('one row goes and the others stay, with the total following', async ({ sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deleteSound({ sounds, dialogs }, 'Cluster Unlock');
		await header.openTrash();
		await dialogs.trash.expectRowKinds(['sound', 'sound']);

		await dialogs.trash.deleteForever(SOUND);

		await dialogs.trash.expectRowKinds(['sound']);
		await dialogs.trash.expectNotHolding(SOUND);
		await dialogs.trash.expectHolding('Cluster Unlock');
	});

	test('Delete all empties the trash and closes the dialog, and nothing comes back', async ({ soundboard, splash, playlists, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);
		await header.openTrash();

		await dialogs.trash.deleteAll();

		await dialogs.trash.expectClosed();
		await header.expectNoTrash();
		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await header.expectNoTrash();
		await sounds.expectGone(SOUND);
		await playlists.expectGone(PLAYLIST);
	});

	test('a failed delete says why and keeps the row', async ({ page, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await page.route('**/api/trash/delete', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'permission denied' }) }));
		await header.openTrash();

		await dialogs.trash.deleteForever(SOUND);

		await dialogs.trash.expectError('Could not delete: permission denied');
		await dialogs.trash.expectHolding(SOUND);
	});
});

test.describe('deleting what plays', () => {
	test('a sound that is playing stops', async ({ sounds, dialogs, audio }) => {
		await audio.script(SOUND, { duration: 30 });
		await sounds.click(SOUND);
		await audio.expectPlaying(SOUND);

		await deleteSound({ sounds, dialogs }, SOUND);

		await audio.expectNothingPlaying();
	});

	test('a playlist that is playing stops, and its bar goes', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.click(PLAYLIST);
		await audio.expectPlaying(FIRST);

		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await footer.expectEmpty();
		await audio.expectNothingPlaying();
	});
});
