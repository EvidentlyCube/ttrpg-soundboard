import { expect, test } from '../support/fixtures.js';

const SOUND = 'Base Connected';
const FILE = 'Sound MP3 with title tag.mp3';

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('Customize opens a dialog with the title ready to type', async ({ sounds, dialogs }) => {
	await sounds.useMenu(SOUND, 'Customize');

	await dialogs.soundEditor.expectOpen();
	await dialogs.soundEditor.expectTitleFocused();
	await dialogs.soundEditor.expectTitle(SOUND);
});

test('Esc and the close button close the dialog', async ({ sounds, dialogs }) => {
	await sounds.useMenu(SOUND, 'Customize');
	await dialogs.soundEditor.pressEscape();
	await dialogs.soundEditor.expectClosed();

	await sounds.useMenu(SOUND, 'Customize');
	await dialogs.soundEditor.close();
	await dialogs.soundEditor.expectClosed();
});

test('a new title shows on the tile at once but the tile moves only when the dialog closes', async ({ sounds, dialogs, disk, audio }) => {
	await sounds.useMenu(SOUND, 'Customize');

	await dialogs.soundEditor.setTitle('Zap');

	await sounds.expectOrder(['Zap', 'Cluster Unlock', 'Sound MP3 no title tag.mp3', 'Sound OGG no title tag.ogg']);
	await dialogs.soundEditor.close();
	await sounds.expectOrder(['Cluster Unlock', 'Sound MP3 no title tag.mp3', 'Sound OGG no title tag.ogg', 'Zap']);
	await audio.advance(500);
	await disk.expectOptions(FILE, { title: 'Zap' });
});

test('an emptied title keeps the old one', async ({ sounds, dialogs, audio, disk }) => {
	await sounds.useMenu(SOUND, 'Customize');

	await dialogs.soundEditor.setTitle('');
	await dialogs.soundEditor.close();

	await sounds.expectShown(SOUND);
	await audio.advance(500);
	expect(await disk.options(FILE)).not.toMatchObject({ title: '' });
});

test('the volume is saved half a second after the change, and shows as saved', async ({ sounds, dialogs, audio, disk }) => {
	await sounds.useMenu(SOUND, 'Customize');

	await dialogs.soundEditor.setVolume('-6');

	await dialogs.soundEditor.expectVolume('-6.0 dB');
	await dialogs.soundEditor.expectSaving();
	expect(await disk.options(FILE)).not.toHaveProperty('gain');
	await audio.advance(500);
	await disk.expectOptions(FILE, { gain: expect.closeTo(0.501, 3) });
	await dialogs.soundEditor.expectSaved();
});

test('closing the dialog saves what is still waiting', async ({ sounds, dialogs, disk }) => {
	await sounds.useMenu(SOUND, 'Customize');
	await dialogs.soundEditor.setVolume('-6');

	await dialogs.soundEditor.close();

	await disk.expectOptions(FILE, { gain: expect.closeTo(0.501, 3) });
});

test('changes survive a reload', async ({ soundboard, splash, sounds, dialogs, audio }) => {
	await sounds.useMenu(SOUND, 'Customize');
	await dialogs.soundEditor.setVolume('-6');
	await dialogs.soundEditor.setFadeIn('0.5');
	await audio.advance(500);
	await dialogs.soundEditor.expectSaved();

	await soundboard.reload();
	await splash.click();
	await soundboard.waitUntilLoaded();
	await sounds.useMenu(SOUND, 'Customize');

	await dialogs.soundEditor.expectVolume('-6.0 dB');
	await dialogs.soundEditor.expectFadeIn('0.500 s');
});

test('a sound plays at the volume and start point set in its dialog', async ({ sounds, dialogs, audio }) => {
	await sounds.useMenu(SOUND, 'Customize');
	await dialogs.soundEditor.setVolume('-6');
	await dialogs.soundEditor.setStart('0.5');
	await dialogs.soundEditor.expectRangeSays('Plays 1.170 s of 1.670 s');
	await dialogs.soundEditor.close();

	await sounds.click(SOUND);

	await audio.expectVoice(SOUND, { gain: expect.closeTo(0.501, 3), startAt: 0.5 });
});

test('Reset in the dialog plays the whole sound again', async ({ sounds, dialogs, audio, disk }) => {
	await sounds.useMenu(SOUND, 'Customize');
	await dialogs.soundEditor.setStart('0.5');
	await dialogs.soundEditor.setEnd('1');
	await dialogs.soundEditor.expectRangeSays('Plays 0.500 s of 1.670 s');

	await dialogs.soundEditor.resetRange();

	await dialogs.soundEditor.expectRangeSays('Plays 1.670 s of 1.670 s');
	await audio.advance(500);
	await disk.expectOptions(FILE, { startAt: 0, endAt: null });
});

test('Play in the dialog plays the sound and turns into Stop', async ({ sounds, dialogs, audio }) => {
	await sounds.useMenu(SOUND, 'Customize');

	await dialogs.soundEditor.play();

	await audio.expectPlaying(SOUND);
	await dialogs.soundEditor.expectPlaying();
	await dialogs.soundEditor.stop();
	await audio.expectNothingPlaying();
});
