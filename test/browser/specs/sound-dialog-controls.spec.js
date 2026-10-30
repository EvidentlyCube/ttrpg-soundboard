import { expect, test } from '../support/fixtures.js';

const SOUND = 'Base Connected';
const FILE = 'Sound MP3 with title tag.mp3';
// The example sound is 1.670 s long; the shortest part that plays is 10 ms.
const LENGTH = 1670;

test.beforeEach(async ({ soundboard, sounds }) => {
	await soundboard.startAndWaitUntilLoaded();
	await sounds.useMenu(SOUND, 'Customize');
});

test.describe('the start and end handles', () => {
	test('pressing the slider moves the nearer handle there', async ({ dialogs, audio, disk }) => {
		await dialogs.soundEditor.dragOnRange(0.1);
		await dialogs.soundEditor.expectHandleAt('start', 167);
		await dialogs.soundEditor.expectHandleAt('end', LENGTH);

		await dialogs.soundEditor.dragOnRange(0.9);

		await dialogs.soundEditor.expectHandleAt('start', 167);
		await dialogs.soundEditor.expectHandleAt('end', 1503);
		await dialogs.soundEditor.expectField('end', '1.503');
		await audio.advance(500);
		await disk.expectOptions(FILE, { startAt: 0.167, endAt: 1.503 });
	});

	test('dragging a handle follows the pointer and the fields follow the handle', async ({ dialogs }) => {
		await dialogs.soundEditor.dragHandle('end', 0.6);

		await dialogs.soundEditor.expectHandleAt('end', 1002);
		await dialogs.soundEditor.expectField('end', '1.002');
		await dialogs.soundEditor.expectRangeSays('Plays 1.002 s of 1.670 s');
	});

	test('the handles never cross, and stay 10 ms apart', async ({ dialogs }) => {
		await dialogs.soundEditor.setEnd('1');

		await dialogs.soundEditor.dragHandle('start', 1);

		await dialogs.soundEditor.expectHandleAt('start', 990);
		await dialogs.soundEditor.expectHandleAt('end', 1000);
		await dialogs.soundEditor.expectRangeSays('Plays 0.010 s of 1.670 s');

		await dialogs.soundEditor.dragHandle('end', 0);

		await dialogs.soundEditor.expectHandleAt('start', 990);
		await dialogs.soundEditor.expectHandleAt('end', 1000);
	});

	test('the arrow keys step by 10 ms, and Shift by 100 ms', async ({ dialogs }) => {
		await dialogs.soundEditor.pressOnHandle('start', 'ArrowRight', 'ArrowRight');
		await dialogs.soundEditor.expectHandleAt('start', 20);

		await dialogs.soundEditor.pressOnHandle('start', 'Shift+ArrowRight');
		await dialogs.soundEditor.expectHandleAt('start', 120);

		await dialogs.soundEditor.pressOnHandle('start', 'ArrowLeft');
		await dialogs.soundEditor.expectHandleAt('start', 110);

		await dialogs.soundEditor.pressOnHandle('end', 'Shift+ArrowLeft');
		await dialogs.soundEditor.expectHandleAt('end', 1570);
	});

	test('Home and End send a handle as far as it can go', async ({ dialogs }) => {
		await dialogs.soundEditor.setStart('0.5');
		await dialogs.soundEditor.setEnd('1');

		await dialogs.soundEditor.pressOnHandle('start', 'End');
		await dialogs.soundEditor.expectHandleAt('start', 990);

		await dialogs.soundEditor.pressOnHandle('start', 'Home');
		await dialogs.soundEditor.expectHandleAt('start', 0);

		await dialogs.soundEditor.pressOnHandle('end', 'Home');
		await dialogs.soundEditor.expectHandleAt('end', 10);

		await dialogs.soundEditor.pressOnHandle('end', 'End');
		await dialogs.soundEditor.expectHandleAt('end', LENGTH);
	});
});

test.describe('the start and end fields', () => {
	test('read seconds with a comma, a point or an "s"', async ({ dialogs }) => {
		await dialogs.soundEditor.setStart('0,25');
		await dialogs.soundEditor.expectHandleAt('start', 250);
		await dialogs.soundEditor.expectField('start', '0.250');

		await dialogs.soundEditor.setEnd('1.5 s');
		await dialogs.soundEditor.expectHandleAt('end', 1500);
		await dialogs.soundEditor.expectField('end', '1.500');
	});

	test('clamp a point that is too far to the nearest one that fits', async ({ dialogs }) => {
		await dialogs.soundEditor.setEnd('1');

		await dialogs.soundEditor.setStart('5');
		await dialogs.soundEditor.expectField('start', '0.990');

		await dialogs.soundEditor.setEnd('99');
		await dialogs.soundEditor.expectField('end', '1.670');
	});

	test('mark text that is not a number red until it is changed', async ({ dialogs }) => {
		await dialogs.soundEditor.typeInField('start', 'soon');
		await dialogs.soundEditor.pressEnterInField('start');

		await dialogs.soundEditor.expectFieldInvalid('start', true);
		await dialogs.soundEditor.expectHandleAt('start', 0);

		await dialogs.soundEditor.typeInField('start', '0.5');

		await dialogs.soundEditor.expectFieldInvalid('start', false);
	});

	test('Esc puts the old value back and leaves the dialog open', async ({ dialogs }) => {
		await dialogs.soundEditor.typeInField('start', '1');

		await dialogs.soundEditor.pressEscapeInField('start');

		await dialogs.soundEditor.expectField('start', '0.000');
		await dialogs.soundEditor.expectHandleAt('start', 0);
		await dialogs.soundEditor.expectOpen();
	});
});

test.describe('fades longer than the part that plays', () => {
	test('show no warning while they fit', async ({ dialogs }) => {
		await dialogs.soundEditor.setFadeIn('0.5');
		await dialogs.soundEditor.setFadeOut('0.5');

		await dialogs.soundEditor.expectFadeWarning(false);
	});

	test('warn when the fade-in and the fade-out overlap', async ({ dialogs }) => {
		await dialogs.soundEditor.setFadeIn('1');
		await dialogs.soundEditor.setFadeOut('1');

		await dialogs.soundEditor.expectFadeWarning(true);
	});

	test('warn when one is longer than the whole part, and stop when the part grows', async ({ dialogs }) => {
		await dialogs.soundEditor.setFadeOut('1');
		await dialogs.soundEditor.setStart('1');
		await dialogs.soundEditor.expectFadeWarning(true);

		await dialogs.soundEditor.resetRange();

		await dialogs.soundEditor.expectFadeWarning(false);
	});
});

test.describe('the volume widget', () => {
	test('pressing and dragging the bar sets the level', async ({ dialogs }) => {
		await dialogs.soundEditor.dragVolume(0.375);
		await dialogs.soundEditor.expectVolume('-6.0 dB');

		await dialogs.soundEditor.dragVolume(0.375, 0.75);
		await dialogs.soundEditor.expectVolume('0.0 dB');
	});

	test('a double-click brings it back to 0 dB', async ({ dialogs }) => {
		await dialogs.soundEditor.setVolume('-9');
		await dialogs.soundEditor.expectVolume('-9.0 dB');

		await dialogs.soundEditor.resetVolumeByDoubleClick();

		await dialogs.soundEditor.expectVolume('0.0 dB');
	});

	test('the arrows step by 1 dB, Home is silent and End is the loudest', async ({ dialogs }) => {
		await dialogs.soundEditor.pressOnVolume('ArrowDown', 'ArrowDown');
		await dialogs.soundEditor.expectVolume('-2.0 dB');

		await dialogs.soundEditor.pressOnVolume('ArrowUp');
		await dialogs.soundEditor.expectVolume('-1.0 dB');

		await dialogs.soundEditor.pressOnVolume('Home');
		await dialogs.soundEditor.expectVolume('-∞ dB');

		await dialogs.soundEditor.pressOnVolume('End');
		await dialogs.soundEditor.expectVolume('+12.0 dB');
	});

	test('"-inf" in the field means silence', async ({ dialogs }) => {
		await dialogs.soundEditor.setVolume('-inf');

		await dialogs.soundEditor.expectVolume('-∞ dB');
	});

	test('text that is not a level is marked red and the field stays open', async ({ dialogs }) => {
		await dialogs.soundEditor.typeVolume('loud');
		await dialogs.soundEditor.pressEnterInVolumeField();

		await dialogs.soundEditor.expectVolumeFieldInvalid(true);

		await dialogs.soundEditor.typeVolume('-3');

		await dialogs.soundEditor.expectVolumeFieldInvalid(false);
	});

	test('Esc cancels the edit only, not the dialog', async ({ dialogs }) => {
		await dialogs.soundEditor.typeVolume('-20');

		await dialogs.soundEditor.pressEscapeInVolumeField();

		await dialogs.soundEditor.expectOpen();
		await dialogs.soundEditor.expectVolume('0.0 dB');
	});

	test('a level above 0 dB turns the readout orange', async ({ dialogs }) => {
		await dialogs.soundEditor.expectVolumeBoosted(false);

		await dialogs.soundEditor.setVolume('+3');

		await dialogs.soundEditor.expectVolume('+3.0 dB');
		await dialogs.soundEditor.expectVolumeBoosted(true);

		await dialogs.soundEditor.setVolume('-3');

		await dialogs.soundEditor.expectVolumeBoosted(false);
	});
});

test.describe('changing a sound that is playing', () => {
	test('a new volume reaches the copies already playing', async ({ sounds, dialogs, audio }) => {
		await dialogs.soundEditor.close();
		await audio.script(SOUND, { duration: 30 });
		await sounds.click(SOUND);
		await audio.expectVoice(SOUND, { gain: 1 });
		await sounds.useMenu(SOUND, 'Customize');

		await dialogs.soundEditor.setVolume('-6');

		await audio.expectVoice(SOUND, { gain: expect.closeTo(0.501, 3) });
	});

	test('a copy that already plays keeps the points it started with', async ({ sounds, dialogs, audio }) => {
		await dialogs.soundEditor.close();
		await audio.script(SOUND, { duration: 30 });
		await sounds.click(SOUND);
		await audio.expectVoice(SOUND, { startAt: 0 });
		await sounds.useMenu(SOUND, 'Customize');
		await dialogs.soundEditor.setStart('0.5');
		await dialogs.soundEditor.close();

		await sounds.click(SOUND);

		await audio.expectPlayingCount(2, { title: SOUND });
		await audio.expectVoice(SOUND, { startAt: 0 });
		await audio.expectVoice(SOUND, { startAt: 0.5 });
	});
});
