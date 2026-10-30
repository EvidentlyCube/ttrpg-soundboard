import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('a file copied into the folder brings the refresh button, and refreshing loads it', async ({ soundboard, splash, header, sounds, disk }) => {
	await test.step('Copy a file into the folder: the refresh button appears', async () => {
		await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');
		await header.expectExternalChangesButton();
	});

	await test.step('Click it: the splash comes back', async () => {
		await header.refreshExternalChanges();
		await splash.expectVisible();
	});

	await test.step('Click the splash: the new file is a sound', async () => {
		await splash.click();
		await soundboard.waitUntilLoaded();
		await sounds.expectShown('Fanfare.mp3');
	});
});

test('deleting a file brings the button too, and refreshing drops it', async ({ soundboard, splash, header, sounds, disk }) => {
	await test.step('Delete a file from the folder: the refresh button appears', async () => {
		await disk.remove('Sound OGG no title tag.ogg');
		await header.expectExternalChangesButton();
	});

	await test.step('Refresh and click through the splash', async () => {
		await header.refreshExternalChanges();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The sound is gone', async () => {
		await sounds.expectGone('Sound OGG no title tag.ogg');
	});
});

test('customizing and moving the volume sliders never bring the button', async ({ soundboard, sounds, dialogs, header, audio }) => {
	await test.step('Move the music volume and customize a sound', async () => {
		await header.setVolume('music', '-3');
		await sounds.useMenu('Base Connected', 'Customize');
		await dialogs.soundEditor.setVolume('-6');
		await audio.advance(500);
		await dialogs.soundEditor.expectSaved();
	});

	await test.step('Wait for the folder watcher to settle', async () => {
		await soundboard.waitForTheFolderToSettle();
	});

	await test.step('No refresh button appears', async () => {
		await header.expectNoExternalChangesButton();
	});
});
