import { expect, test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await soundboard.startAndWaitUntilLoaded();
});

test('each volume slider sets its own bus', async ({ header, audio }) => {
	await header.setVolume('music', '-6');
	await header.setVolume('sfx', '-12');

	await header.expectVolume('music', '-6.0 dB');
	await audio.expectBusGain('music', expect.closeTo(0.501, 3));
	await audio.expectBusGain('sfx', expect.closeTo(0.251, 3));
	await audio.expectBusGain('master', 1);
});

test('volumes are saved a moment later and are still there after a reload', async ({ soundboard, splash, header, audio, disk }) => {
	await header.setVolume('master', '-6');
	await audio.advance(500);
	// What is saved is the slider's position, not the gain: -6 dB is a gain of 0.501, the slider's 0.708 squared.
	await disk.expectSettings({ volumes: { master: expect.closeTo(0.708, 3) } });

	await soundboard.reload();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await header.expectVolume('master', '-6.0 dB');
	await audio.expectBusGain('master', expect.closeTo(0.501, 3));
});
