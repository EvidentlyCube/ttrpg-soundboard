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
	await test.step(`Delete the playlist "${title}" from its dialog`, async () => {
		await playlists.useMenu(title, 'Customize');
		await dialogs.playlistEditor.holdToDeletePlaylist();
		await dialogs.playlistEditor.expectClosed();
		await playlists.expectGone(title);
	});
}

/**
 * Deletes one sound from its dialog.
 * @param {Pick<import('../support/fixtures.js').Fixtures, 'sounds' | 'dialogs'>} pages
 * @param {string} title
 */
async function deleteSound({ sounds, dialogs }, title) {
	await test.step(`Delete the sound "${title}" from its dialog`, async () => {
		await sounds.useMenu(title, 'Customize');
		await dialogs.soundEditor.holdToDelete();
		await sounds.expectGone(title);
	});
}

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test.describe('what the trash lists', () => {
	test('a deleted playlist comes with its tracks indented beneath it', async ({ playlists, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await test.step('Open the trash', async () => {
			await header.openTrash();
		});

		await test.step('It lists the playlist with its two tracks, then the sound', async () => {
			await dialogs.trash.expectRowKinds(['playlist', 'track', 'track', 'sound']);
			await dialogs.trash.expectDetail(PLAYLIST, '2 tracks');
			await dialogs.trash.expectHolding(FIRST);
			await dialogs.trash.expectHolding(SECOND);
			await dialogs.trash.expectHolding(SOUND);
		});
	});

	test('a deleted track shows under its playlist, which stays on the board', async ({ playlists, dialogs, header }) => {
		await test.step("Delete the first track from the playlist's dialog", async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.openTracksTab();
			const track = dialogs.playlistEditor.track(FIRST);
			await track.open();
			await track.holdToDelete();
			await track.expectGone();
			await dialogs.playlistEditor.close();
		});

		await test.step('The playlist stays on the board with one track', async () => {
			await playlists.expectStatus(PLAYLIST, '1 track');
		});

		await test.step('Open the trash: the track is listed under its playlist', async () => {
			await header.openTrash();
			await dialogs.trash.expectRowKinds(['playlist', 'track']);
			await dialogs.trash.expectDetail(PLAYLIST, '1 track');
		});
	});
});

test.describe('restoring', () => {
	test('a playlist comes back from its saved options with all its tracks', async ({ playlists, dialogs, header, audio }) => {
		await test.step('Give the playlist a shuffle order and a crossfade, and let them save', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.chooseOrder('shuffle');
			await dialogs.playlistEditor.setCrossfade('2');
			await audio.advance(500);
			await dialogs.playlistEditor.expectSaved();
		});

		await test.step('Delete the playlist and open the trash', async () => {
			await dialogs.playlistEditor.holdToDeletePlaylist();
			await playlists.expectGone(PLAYLIST);
			await header.openTrash();
		});

		await test.step('Restore it', async () => {
			await dialogs.trash.restore(PLAYLIST);
		});

		await test.step('The playlist is back with its two tracks', async () => {
			await dialogs.trash.expectClosed();
			await playlists.expectShown(PLAYLIST);
			await playlists.expectStatus(PLAYLIST, '2 tracks');
		});

		await test.step('Its dialog shows the saved order and crossfade', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.expectOrder('shuffle');
			await dialogs.playlistEditor.expectCrossfade('2.000 s');
		});
	});

	test('a track goes back into its playlist', async ({ playlists, dialogs, header }) => {
		await test.step('Delete the first track and open the trash', async () => {
			await playlists.useMenu(PLAYLIST, 'Customize');
			await dialogs.playlistEditor.openTracksTab();
			const track = dialogs.playlistEditor.track(FIRST);
			await track.open();
			await track.holdToDelete();
			await track.expectGone();
			await dialogs.playlistEditor.close();
			await header.openTrash();
		});

		await test.step('Restore the track', async () => {
			await dialogs.trash.restore(FIRST);
		});

		await test.step('The playlist has its two tracks again', async () => {
			await dialogs.trash.expectClosed();
			await playlists.expectStatus(PLAYLIST, '2 tracks');
		});
	});

	test('one track of a deleted playlist brings the playlist back with just that track', async ({ playlists, dialogs, header }) => {
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await test.step('Open the trash and restore the second track', async () => {
			await header.openTrash();
			await dialogs.trash.restore(SECOND);
		});

		await test.step('The playlist is back with one track, and the other is still in the trash', async () => {
			await playlists.expectShown(PLAYLIST);
			await playlists.expectStatus(PLAYLIST, '1 track');
			await dialogs.trash.expectHolding(FIRST);
			await dialogs.trash.expectNotHolding(SECOND);
		});
	});

	test('a sound whose name is taken again comes back with a (2) in its name', async ({ soundboard, splash, sounds, disk, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);

		await test.step('Put a new file with the same name in the folder and refresh', async () => {
			await disk.addCopyOf(SOUND_FILE, SOUND_FILE);
			await header.expectExternalChangesButton();
			await header.refreshExternalChanges();
			await splash.click();
			await soundboard.waitUntilLoaded();
			await sounds.expectShown(SOUND);
		});

		await test.step('Open the trash and restore the old sound', async () => {
			await header.openTrash();
			await dialogs.trash.restore(SOUND);
		});

		await test.step('There are two sounds, and the restored file has "(2)" in its name', async () => {
			await dialogs.trash.expectClosed();
			await sounds.expectCount(SOUND, 2);
			await disk.expectFile('Sound MP3 with title tag (2).mp3');
		});
	});

	test('everything comes back with Restore all, only when it has been held for two seconds', async ({ playlists, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await test.step('Open the trash and hold Restore all for too short a time: nothing happens', async () => {
			await header.openTrash();
			await dialogs.trash.holdRestoreAllTooShort();
			await dialogs.trash.expectHolding(SOUND);
		});

		await test.step('Hold it long enough', async () => {
			await dialogs.trash.restoreAll();
		});

		await test.step('The trash closes and empties, and everything is back', async () => {
			await dialogs.trash.expectClosed();
			await header.expectNoTrash();
			await sounds.expectShown(SOUND);
			await playlists.expectStatus(PLAYLIST, '2 tracks');
		});
	});

	test('a restore that fails says why and keeps everything in the trash', async ({ page, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);

		await test.step('Make the server refuse restores and open the trash', async () => {
			await page.route('**/api/trash/restore', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the folder is read-only' }) }));
			await header.openTrash();
		});

		await test.step('Try to restore the sound', async () => {
			await dialogs.trash.restore(SOUND);
		});

		await test.step('The dialog says why, the sound stays in the trash and off the board', async () => {
			await dialogs.trash.expectError('Could not restore: the folder is read-only');
			await dialogs.trash.expectHolding(SOUND);
			await sounds.expectGone(SOUND);
		});
	});
});

test.describe('deleting for good', () => {
	test('one row goes and the others stay, with the total following', async ({ sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deleteSound({ sounds, dialogs }, 'Cluster Unlock');

		await test.step('Open the trash: two sounds are listed', async () => {
			await header.openTrash();
			await dialogs.trash.expectRowKinds(['sound', 'sound']);
		});

		await test.step('Delete one for good', async () => {
			await dialogs.trash.deleteForever(SOUND);
		});

		await test.step('Only the other one is left', async () => {
			await dialogs.trash.expectRowKinds(['sound']);
			await dialogs.trash.expectNotHolding(SOUND);
			await dialogs.trash.expectHolding('Cluster Unlock');
		});
	});

	test('Delete all empties the trash and closes the dialog, and nothing comes back', async ({ soundboard, splash, playlists, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);
		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await test.step('Open the trash and click Delete all', async () => {
			await header.openTrash();
			await dialogs.trash.deleteAll();
		});

		await test.step('The dialog closes and the trash is empty', async () => {
			await dialogs.trash.expectClosed();
			await header.expectNoTrash();
		});

		await test.step('Reload the page', async () => {
			await soundboard.reload();
			await splash.click();
			await soundboard.waitUntilLoaded();
		});

		await test.step('The trash is still empty and nothing came back', async () => {
			await header.expectNoTrash();
			await sounds.expectGone(SOUND);
			await playlists.expectGone(PLAYLIST);
		});
	});

	test('a failed delete says why and keeps the row', async ({ page, sounds, dialogs, header }) => {
		await deleteSound({ sounds, dialogs }, SOUND);

		await test.step('Make the server refuse deletes and open the trash', async () => {
			await page.route('**/api/trash/delete', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'permission denied' }) }));
			await header.openTrash();
		});

		await test.step('Try to delete the sound for good', async () => {
			await dialogs.trash.deleteForever(SOUND);
		});

		await test.step('The dialog says why and the row stays', async () => {
			await dialogs.trash.expectError('Could not delete: permission denied');
			await dialogs.trash.expectHolding(SOUND);
		});
	});
});

test.describe('deleting what plays', () => {
	test('a sound that is playing stops', async ({ sounds, dialogs, audio }) => {
		await test.step('Make the sound long and play it', async () => {
			await audio.script(SOUND, { duration: 30 });
			await sounds.click(SOUND);
			await audio.expectPlaying(SOUND);
		});

		await deleteSound({ sounds, dialogs }, SOUND);

		await test.step('Nothing plays', async () => {
			await audio.expectNothingPlaying();
		});
	});

	test('a playlist that is playing stops, and its bar goes', async ({ playlists, dialogs, footer, audio }) => {
		await test.step('Play the playlist', async () => {
			await playlists.click(PLAYLIST);
			await audio.expectPlaying(FIRST);
		});

		await deletePlaylist({ playlists, dialogs }, PLAYLIST);

		await test.step('The footer is empty and nothing plays', async () => {
			await footer.expectEmpty();
			await audio.expectNothingPlaying();
		});
	});
});
