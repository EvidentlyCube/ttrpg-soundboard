import { expect, test } from '../support/fixtures.js';

test.beforeEach(async ({ soundboard }) => {
	await test.step('Open the page', async () => {
		await soundboard.startAndWaitUntilLoaded();
	});
});

test('each volume slider sets its own bus', async ({ header, audio }) => {
	await test.step('Set the music and sound effects volumes', async () => {
		await header.setVolume('music', '-6');
		await header.setVolume('sfx', '-12');
	});

	await test.step('Each bus has its own gain and the master is untouched', async () => {
		await header.expectVolume('music', '-6.0 dB');
		await audio.expectBusGain('music', expect.closeTo(0.501, 3));
		await audio.expectBusGain('sfx', expect.closeTo(0.251, 3));
		await audio.expectBusGain('master', 1);
	});
});

test('volumes are saved a moment later and are still there after a reload', async ({ soundboard, splash, header, audio, disk }) => {
	await test.step('Set the master volume and let it save', async () => {
		await header.setVolume('master', '-6');
		await audio.advance(500);
		// What is saved is the slider's position, not the gain: -6 dB is a gain of 0.501, the slider's 0.708 squared.
		await disk.expectSettings({ volumes: { master: expect.closeTo(0.708, 3) } });
	});

	await test.step('Reload the page', async () => {
		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The slider and the bus have the saved volume', async () => {
		await header.expectVolume('master', '-6.0 dB');
		await audio.expectBusGain('master', expect.closeTo(0.501, 3));
	});
});
