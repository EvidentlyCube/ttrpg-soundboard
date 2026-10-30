import { expect, test } from '../support/fixtures.js';

const SOUND = 'Base Connected';
const FILE = 'Sound MP3 with title tag.mp3';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('Customize opens a dialog with the title ready to type', async ({ sounds, dialogs }) => {
	await test.step('Choose Customize in the sound menu', async () => {
		await sounds.useMenu(SOUND, 'Customize');
	});

	await test.step('The dialog is open with the title focused', async () => {
		await dialogs.soundEditor.expectOpen();
		await dialogs.soundEditor.expectTitleFocused();
		await dialogs.soundEditor.expectTitle(SOUND);
	});
});

test('Esc and the close button close the dialog', async ({ sounds, dialogs }) => {
	await test.step('Open the dialog and press Esc', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.pressEscape();
		await dialogs.soundEditor.expectClosed();
	});

	await test.step('Open it again and click the close button', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.close();
		await dialogs.soundEditor.expectClosed();
	});
});

test('a new title shows on the tile at once but the tile moves only when the dialog closes', async ({ sounds, dialogs, disk, audio }) => {
	await test.step('Open the dialog', async () => {
		await sounds.useMenu(SOUND, 'Customize');
	});

	await test.step('Type a new title: the tile changes but stays in place', async () => {
		await dialogs.soundEditor.setTitle('Zap');
		await sounds.expectOrder(['Zap', 'Cluster Unlock', 'Sound MP3 no title tag.mp3', 'Sound OGG no title tag.ogg']);
	});

	await test.step('Close the dialog: the tile moves to its sorted place', async () => {
		await dialogs.soundEditor.close();
		await sounds.expectOrder(['Cluster Unlock', 'Sound MP3 no title tag.mp3', 'Sound OGG no title tag.ogg', 'Zap']);
	});

	await test.step('The title is on disk', async () => {
		await audio.advance(500);
		await disk.expectOptions(FILE, { title: 'Zap' });
	});
});

test('an emptied title keeps the old one', async ({ sounds, dialogs, audio, disk }) => {
	await test.step('Empty the title and close the dialog', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setTitle('');
		await dialogs.soundEditor.close();
	});

	await test.step('The tile still has the old title and nothing empty is saved', async () => {
		await sounds.expectShown(SOUND);
		await audio.advance(500);
		expect(await disk.options(FILE)).not.toMatchObject({ title: '' });
	});
});

test('the volume is saved half a second after the change, and shows as saved', async ({ sounds, dialogs, audio, disk }) => {
	await test.step('Open the dialog', async () => {
		await sounds.useMenu(SOUND, 'Customize');
	});

	await test.step('Set the volume: it shows as saving and nothing is on disk yet', async () => {
		await dialogs.soundEditor.setVolume('-6');
		await dialogs.soundEditor.expectVolume('-6.0 dB');
		await dialogs.soundEditor.expectSaving();
		expect(await disk.options(FILE)).not.toHaveProperty('gain');
	});

	await test.step('Half a second later it is on disk and shows as saved', async () => {
		await audio.advance(500);
		await disk.expectOptions(FILE, { gain: expect.closeTo(0.501, 3) });
		await dialogs.soundEditor.expectSaved();
	});
});

test('closing the dialog saves what is still waiting', async ({ sounds, dialogs, disk }) => {
	await test.step('Set the volume', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setVolume('-6');
	});

	await test.step('Close the dialog at once', async () => {
		await dialogs.soundEditor.close();
	});

	await test.step('The volume is on disk', async () => {
		await disk.expectOptions(FILE, { gain: expect.closeTo(0.501, 3) });
	});
});

test('changes survive a reload', async ({ soundboard, splash, sounds, dialogs, audio }) => {
	await test.step('Change the volume and fade-in and let them save', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setVolume('-6');
		await dialogs.soundEditor.setFadeIn('0.5');
		await audio.advance(500);
		await dialogs.soundEditor.expectSaved();
	});

	await test.step('Reload the page and open the dialog again', async () => {
		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await sounds.useMenu(SOUND, 'Customize');
	});

	await test.step('The dialog shows the saved values', async () => {
		await dialogs.soundEditor.expectVolume('-6.0 dB');
		await dialogs.soundEditor.expectFadeIn('0.500 s');
	});
});

test('a sound plays at the volume and start point set in its dialog', async ({ sounds, dialogs, audio }) => {
	await test.step('Set the volume and the start point', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setVolume('-6');
		await dialogs.soundEditor.setStart('0.5');
		await dialogs.soundEditor.expectRangeSays('Plays 1.170 s of 1.670 s');
		await dialogs.soundEditor.close();
	});

	await test.step('Play the sound', async () => {
		await sounds.click(SOUND);
	});

	await test.step('It plays at that volume from that start point', async () => {
		await audio.expectVoice(SOUND, { gain: expect.closeTo(0.501, 3), startAt: 0.5 });
	});
});

test('Reset in the dialog plays the whole sound again', async ({ sounds, dialogs, audio, disk }) => {
	await test.step('Trim the sound to 0.5 s', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setStart('0.5');
		await dialogs.soundEditor.setEnd('1');
		await dialogs.soundEditor.expectRangeSays('Plays 0.500 s of 1.670 s');
	});

	await test.step('Click Reset', async () => {
		await dialogs.soundEditor.resetRange();
	});

	await test.step('The whole sound plays again, and the disk agrees', async () => {
		await dialogs.soundEditor.expectRangeSays('Plays 1.670 s of 1.670 s');
		await audio.advance(500);
		await disk.expectOptions(FILE, { startAt: 0, endAt: null });
	});
});

test('Play in the dialog plays the sound and turns into Stop', async ({ sounds, dialogs, audio }) => {
	await test.step('Open the dialog and click Play', async () => {
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.play();
	});

	await test.step('The sound plays and the button offers Stop', async () => {
		await audio.expectPlaying(SOUND);
		await dialogs.soundEditor.expectPlaying();
	});

	await test.step('Click Stop: nothing plays', async () => {
		await dialogs.soundEditor.stop();
		await audio.expectNothingPlaying();
	});
});
