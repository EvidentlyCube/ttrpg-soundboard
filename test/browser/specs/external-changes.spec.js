import { test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('a file copied into the folder brings the refresh button, and refreshing loads it', async ({ soundboard, splash, header, sounds, disk }) => {
	await disk.addCopyOf('Sound MP3 no title tag.mp3', 'Fanfare.mp3');

	await header.expectExternalChangesButton();
	await header.refreshExternalChanges();

	await splash.expectVisible();
	await splash.click();
	await soundboard.waitUntilLoaded();
	await sounds.expectShown('Fanfare.mp3');
});

test('deleting a file brings the button too, and refreshing drops it', async ({ soundboard, splash, header, sounds, disk }) => {
	await disk.remove('Sound OGG no title tag.ogg');

	await header.expectExternalChangesButton();
	await header.refreshExternalChanges();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await sounds.expectGone('Sound OGG no title tag.ogg');
});

test('customizing and moving the volume sliders never bring the button', async ({ soundboard, sounds, dialogs, header, audio }) => {
	await header.setVolume('music', '-3');
	await sounds.useMenu('Base Connected', 'Customize');
	await dialogs.soundEditor.setVolume('-6');
	await audio.advance(500);
	await dialogs.soundEditor.expectSaved();

	await soundboard.waitForTheFolderToSettle();

	await header.expectNoExternalChangesButton();
});
