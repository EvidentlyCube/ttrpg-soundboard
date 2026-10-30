import { expect, test } from '../support/fixtures.js';

const SOUND = 'Base Connected';
const FILE = 'Sound MP3 with title tag.mp3';
// The example sound is 1.670 s long; the shortest part that plays is 10 ms.
const LENGTH = 1670;

test.beforeEach(async ({ soundboard, sounds }) => {
	await test.step("Open the sound's Customize dialog", async () => {
		await soundboard.startAndWaitUntilLoaded();
		await sounds.useMenu(SOUND, 'Customize');
	});
});

test.describe('the start and end handles', () => {
	test('pressing the slider moves the nearer handle there', async ({ dialogs, audio, disk }) => {
		await test.step('Press the slider near the start: the start handle moves there', async () => {
			await dialogs.soundEditor.dragOnRange(0.1);
			await dialogs.soundEditor.expectHandleAt('start', 167);
			await dialogs.soundEditor.expectHandleAt('end', LENGTH);
		});

		await test.step('Press the slider near the end: the end handle moves there', async () => {
			await dialogs.soundEditor.dragOnRange(0.9);
			await dialogs.soundEditor.expectHandleAt('start', 167);
			await dialogs.soundEditor.expectHandleAt('end', 1503);
			await dialogs.soundEditor.expectField('end', '1.503');
		});

		await test.step('Half a second later both points are on disk', async () => {
			await audio.advance(500);
			await disk.expectOptions(FILE, { startAt: 0.167, endAt: 1.503 });
		});
	});

	test('dragging a handle follows the pointer and the fields follow the handle', async ({ dialogs }) => {
		await test.step('Drag the end handle to 60 %', async () => {
			await dialogs.soundEditor.dragHandle('end', 0.6);
		});

		await test.step('The handle, the field and the summary agree', async () => {
			await dialogs.soundEditor.expectHandleAt('end', 1002);
			await dialogs.soundEditor.expectField('end', '1.002');
			await dialogs.soundEditor.expectRangeSays('Plays 1.002 s of 1.670 s');
		});
	});

	test('the handles never cross, and stay 10 ms apart', async ({ dialogs }) => {
		await test.step('Set the end to 1 s', async () => {
			await dialogs.soundEditor.setEnd('1');
		});

		await test.step('Drag the start handle past the end: it stops 10 ms short', async () => {
			await dialogs.soundEditor.dragHandle('start', 1);
			await dialogs.soundEditor.expectHandleAt('start', 990);
			await dialogs.soundEditor.expectHandleAt('end', 1000);
			await dialogs.soundEditor.expectRangeSays('Plays 0.010 s of 1.670 s');
		});

		await test.step('Drag the end handle past the start: nothing moves', async () => {
			await dialogs.soundEditor.dragHandle('end', 0);
			await dialogs.soundEditor.expectHandleAt('start', 990);
			await dialogs.soundEditor.expectHandleAt('end', 1000);
		});
	});

	test('the arrow keys step by 10 ms, and Shift by 100 ms', async ({ dialogs }) => {
		await test.step('Press the right arrow twice on the start handle: it moves 20 ms', async () => {
			await dialogs.soundEditor.pressOnHandle('start', 'ArrowRight', 'ArrowRight');
			await dialogs.soundEditor.expectHandleAt('start', 20);
		});

		await test.step('Press Shift and the right arrow: it moves 100 ms', async () => {
			await dialogs.soundEditor.pressOnHandle('start', 'Shift+ArrowRight');
			await dialogs.soundEditor.expectHandleAt('start', 120);
		});

		await test.step('Press the left arrow: it moves back 10 ms', async () => {
			await dialogs.soundEditor.pressOnHandle('start', 'ArrowLeft');
			await dialogs.soundEditor.expectHandleAt('start', 110);
		});

		await test.step('Press Shift and the left arrow on the end handle: it moves back 100 ms', async () => {
			await dialogs.soundEditor.pressOnHandle('end', 'Shift+ArrowLeft');
			await dialogs.soundEditor.expectHandleAt('end', 1570);
		});
	});

	test('Home and End send a handle as far as it can go', async ({ dialogs }) => {
		await test.step('Set the start to 0.5 s and the end to 1 s', async () => {
			await dialogs.soundEditor.setStart('0.5');
			await dialogs.soundEditor.setEnd('1');
		});

		await test.step('End on the start handle: it stops 10 ms before the end handle', async () => {
			await dialogs.soundEditor.pressOnHandle('start', 'End');
			await dialogs.soundEditor.expectHandleAt('start', 990);
		});

		await test.step('Home on the start handle: it goes to the beginning', async () => {
			await dialogs.soundEditor.pressOnHandle('start', 'Home');
			await dialogs.soundEditor.expectHandleAt('start', 0);
		});

		await test.step('Home on the end handle: it stops 10 ms after the start handle', async () => {
			await dialogs.soundEditor.pressOnHandle('end', 'Home');
			await dialogs.soundEditor.expectHandleAt('end', 10);
		});

		await test.step('End on the end handle: it goes to the end of the sound', async () => {
			await dialogs.soundEditor.pressOnHandle('end', 'End');
			await dialogs.soundEditor.expectHandleAt('end', LENGTH);
		});
	});
});

test.describe('the start and end fields', () => {
	test('read seconds with a comma, a point or an "s"', async ({ dialogs }) => {
		await test.step('Type a start with a comma', async () => {
			await dialogs.soundEditor.setStart('0,25');
			await dialogs.soundEditor.expectHandleAt('start', 250);
			await dialogs.soundEditor.expectField('start', '0.250');
		});

		await test.step('Type an end with an "s"', async () => {
			await dialogs.soundEditor.setEnd('1.5 s');
			await dialogs.soundEditor.expectHandleAt('end', 1500);
			await dialogs.soundEditor.expectField('end', '1.500');
		});
	});

	test('clamp a point that is too far to the nearest one that fits', async ({ dialogs }) => {
		await test.step('Set the end to 1 s', async () => {
			await dialogs.soundEditor.setEnd('1');
		});

		await test.step('Type a start after the end: it stops 10 ms short', async () => {
			await dialogs.soundEditor.setStart('5');
			await dialogs.soundEditor.expectField('start', '0.990');
		});

		await test.step("Type an end after the sound: it stops at the sound's length", async () => {
			await dialogs.soundEditor.setEnd('99');
			await dialogs.soundEditor.expectField('end', '1.670');
		});
	});

	test('mark text that is not a number red until it is changed', async ({ dialogs }) => {
		await test.step('Type text that is not a number and press Enter', async () => {
			await dialogs.soundEditor.typeInField('start', 'soon');
			await dialogs.soundEditor.pressEnterInField('start');
		});

		await test.step('The field is marked red and the handle stays put', async () => {
			await dialogs.soundEditor.expectFieldInvalid('start', true);
			await dialogs.soundEditor.expectHandleAt('start', 0);
		});

		await test.step('Type a number: the mark goes', async () => {
			await dialogs.soundEditor.typeInField('start', '0.5');
			await dialogs.soundEditor.expectFieldInvalid('start', false);
		});
	});

	test('Esc puts the old value back and leaves the dialog open', async ({ dialogs }) => {
		await test.step('Type a new start without confirming it', async () => {
			await dialogs.soundEditor.typeInField('start', '1');
		});

		await test.step('Press Esc in the field', async () => {
			await dialogs.soundEditor.pressEscapeInField('start');
		});

		await test.step('The old value is back and the dialog is still open', async () => {
			await dialogs.soundEditor.expectField('start', '0.000');
			await dialogs.soundEditor.expectHandleAt('start', 0);
			await dialogs.soundEditor.expectOpen();
		});
	});
});

test.describe('fades longer than the part that plays', () => {
	test('show no warning while they fit', async ({ dialogs }) => {
		await test.step('Set a short fade-in and fade-out', async () => {
			await dialogs.soundEditor.setFadeIn('0.5');
			await dialogs.soundEditor.setFadeOut('0.5');
		});

		await test.step('There is no warning', async () => {
			await dialogs.soundEditor.expectFadeWarning(false);
		});
	});

	test('warn when the fade-in and the fade-out overlap', async ({ dialogs }) => {
		await test.step('Set a fade-in and fade-out that add up to more than the sound', async () => {
			await dialogs.soundEditor.setFadeIn('1');
			await dialogs.soundEditor.setFadeOut('1');
		});

		await test.step('A warning shows', async () => {
			await dialogs.soundEditor.expectFadeWarning(true);
		});
	});

	test('warn when one is longer than the whole part, and stop when the part grows', async ({ dialogs }) => {
		await test.step('Set a 1 s fade-out and start the sound at 1 s: a warning shows', async () => {
			await dialogs.soundEditor.setFadeOut('1');
			await dialogs.soundEditor.setStart('1');
			await dialogs.soundEditor.expectFadeWarning(true);
		});

		await test.step('Reset the range so the whole sound plays', async () => {
			await dialogs.soundEditor.resetRange();
		});

		await test.step('The warning goes', async () => {
			await dialogs.soundEditor.expectFadeWarning(false);
		});
	});
});

test.describe('the volume widget', () => {
	test('pressing and dragging the bar sets the level', async ({ dialogs }) => {
		await test.step('Press the bar at 37.5 %', async () => {
			await dialogs.soundEditor.dragVolume(0.375);
			await dialogs.soundEditor.expectVolume('-6.0 dB');
		});

		await test.step('Drag it on to 75 %', async () => {
			await dialogs.soundEditor.dragVolume(0.375, 0.75);
			await dialogs.soundEditor.expectVolume('0.0 dB');
		});
	});

	test('a double-click brings it back to 0 dB', async ({ dialogs }) => {
		await test.step('Set the volume to -9 dB', async () => {
			await dialogs.soundEditor.setVolume('-9');
			await dialogs.soundEditor.expectVolume('-9.0 dB');
		});

		await test.step('Double-click the bar', async () => {
			await dialogs.soundEditor.resetVolumeByDoubleClick();
		});

		await test.step('The volume is 0 dB again', async () => {
			await dialogs.soundEditor.expectVolume('0.0 dB');
		});
	});

	test('the arrows step by 1 dB, Home is silent and End is the loudest', async ({ dialogs }) => {
		await test.step('Press the down arrow twice', async () => {
			await dialogs.soundEditor.pressOnVolume('ArrowDown', 'ArrowDown');
			await dialogs.soundEditor.expectVolume('-2.0 dB');
		});

		await test.step('Press the up arrow', async () => {
			await dialogs.soundEditor.pressOnVolume('ArrowUp');
			await dialogs.soundEditor.expectVolume('-1.0 dB');
		});

		await test.step('Press Home: silent', async () => {
			await dialogs.soundEditor.pressOnVolume('Home');
			await dialogs.soundEditor.expectVolume('-∞ dB');
		});

		await test.step('Press End: the loudest', async () => {
			await dialogs.soundEditor.pressOnVolume('End');
			await dialogs.soundEditor.expectVolume('+12.0 dB');
		});
	});

	test('"-inf" in the field means silence', async ({ dialogs }) => {
		await test.step('Type "-inf" as the volume', async () => {
			await dialogs.soundEditor.setVolume('-inf');
		});

		await test.step('The volume is silent', async () => {
			await dialogs.soundEditor.expectVolume('-∞ dB');
		});
	});

	test('text that is not a level is marked red and the field stays open', async ({ dialogs }) => {
		await test.step('Type text that is not a level and press Enter', async () => {
			await dialogs.soundEditor.typeVolume('loud');
			await dialogs.soundEditor.pressEnterInVolumeField();
		});

		await test.step('The field is marked red', async () => {
			await dialogs.soundEditor.expectVolumeFieldInvalid(true);
		});

		await test.step('Type a level: the mark goes', async () => {
			await dialogs.soundEditor.typeVolume('-3');
			await dialogs.soundEditor.expectVolumeFieldInvalid(false);
		});
	});

	test('Esc cancels the edit only, not the dialog', async ({ dialogs }) => {
		await test.step('Type a level without confirming it', async () => {
			await dialogs.soundEditor.typeVolume('-20');
		});

		await test.step('Press Esc in the field', async () => {
			await dialogs.soundEditor.pressEscapeInVolumeField();
		});

		await test.step('The dialog is still open and the volume unchanged', async () => {
			await dialogs.soundEditor.expectOpen();
			await dialogs.soundEditor.expectVolume('0.0 dB');
		});
	});

	test('a level above 0 dB turns the readout orange', async ({ dialogs }) => {
		await test.step('At 0 dB the readout is not orange', async () => {
			await dialogs.soundEditor.expectVolumeBoosted(false);
		});

		await test.step('Boost the volume to +3 dB: the readout turns orange', async () => {
			await dialogs.soundEditor.setVolume('+3');
			await dialogs.soundEditor.expectVolume('+3.0 dB');
			await dialogs.soundEditor.expectVolumeBoosted(true);
		});

		await test.step('Lower it to -3 dB: the orange goes', async () => {
			await dialogs.soundEditor.setVolume('-3');
			await dialogs.soundEditor.expectVolumeBoosted(false);
		});
	});
});

test.describe('changing a sound that is playing', () => {
	test('a new volume reaches the copies already playing', async ({ sounds, dialogs, audio }) => {
		await test.step('Close the dialog, make the sound long and play it', async () => {
			await dialogs.soundEditor.close();
			await audio.givenFile(SOUND, { duration: 30 });
			await sounds.click(SOUND);
			await audio.expectVoice(SOUND, { gain: 1 });
		});

		await test.step('Open the dialog again and lower the volume', async () => {
			await sounds.useMenu(SOUND, 'Customize');
			await dialogs.soundEditor.setVolume('-6');
		});

		await test.step('The copy that is playing gets quieter', async () => {
			await audio.expectVoice(SOUND, { gain: expect.closeTo(0.501, 3) });
		});
	});

	test('a copy that already plays keeps the points it started with', async ({ sounds, dialogs, audio }) => {
		await test.step('Close the dialog, make the sound long and play it from the start', async () => {
			await dialogs.soundEditor.close();
			await audio.givenFile(SOUND, { duration: 30 });
			await sounds.click(SOUND);
			await audio.expectVoice(SOUND, { startAt: 0 });
		});

		await test.step('Set a start point of 0.5 s and close the dialog', async () => {
			await sounds.useMenu(SOUND, 'Customize');
			await dialogs.soundEditor.setStart('0.5');
			await dialogs.soundEditor.close();
		});

		await test.step('Play the sound again', async () => {
			await sounds.click(SOUND);
		});

		await test.step('The first copy kept its start and the new one has the new start', async () => {
			await audio.expectPlayingCount(2, { title: SOUND });
			await audio.expectVoice(SOUND, { startAt: 0 });
			await audio.expectVoice(SOUND, { startAt: 0.5 });
		});
	});
});
