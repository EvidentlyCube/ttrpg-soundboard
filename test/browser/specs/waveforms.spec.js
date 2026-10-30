import { test } from '../support/fixtures.js';

test('while waveforms are made the header counts them, and the indicator goes when all are done', async ({ soundboard, splash, header, audio, disk }) => {
	await test.step('Hold waveform making, open the page and click through the splash', async () => {
		await soundboard.open();
		await audio.holdWaveforms();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('The header counts 0 of 16', async () => {
		await header.expectWaveforms('Waveforms 0 / 16');
	});

	await test.step('Let the waveforms be made', async () => {
		await audio.releaseWaveforms();
		await audio.finishWaveforms();
	});

	await test.step('The indicator goes and the server has kept the waveforms', async () => {
		await header.expectNoWaveforms();
		await disk.expectFile('Sound MP3 with title tag.mp3.wf');
		await disk.expectFile('Music MP3/Song 1 MP3 with title tag.mp3.wf');
	});
});

test('the stop button halts the making and the play button carries on', async ({ soundboard, splash, header, audio }) => {
	await test.step('Hold waveform making and start the page: the header counts 0 of 16', async () => {
		await soundboard.open();
		await audio.holdWaveforms();
		await splash.click();
		await soundboard.waitUntilLoaded();
		await header.expectWaveforms('Waveforms 0 / 16');
	});

	await test.step('Press stop and let the held decode go: the header says stopped', async () => {
		await header.stopWaveforms();
		await audio.releaseWaveforms();
		await header.expectWaveforms('stopped');
	});

	await test.step('Press play: the rest are made and the indicator goes', async () => {
		await header.continueWaveforms();
		await audio.finishWaveforms();
		await header.expectNoWaveforms();
	});
});

test('the menu regenerates every waveform, sounds and tracks alike, even when none is missing', async ({ soundboard, header, audio }) => {
	await test.step('Open the page and let all 16 waveforms be made', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.finishWaveforms();
		await audio.expectDecodedCount(16);
	});

	await test.step('Choose to regenerate them while holding the work', async () => {
		await audio.holdWaveforms();
		await header.regenerateWaveforms();
		await header.expectWaveforms('Waveforms 0 / 16');
	});

	await test.step('Let the work run: all of them are made again', async () => {
		await audio.releaseWaveforms();
		await audio.finishWaveforms();
		await header.expectNoWaveforms();
		await audio.expectDecodedCount(32);
	});
});

test('the stop button halts a regeneration too', async ({ soundboard, header, audio }) => {
	await test.step('Make all the waveforms, then regenerate them while holding the work', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.finishWaveforms();
		await audio.holdWaveforms();
		await header.regenerateWaveforms();
		await header.expectWaveforms('Waveforms 0 / 16');
	});

	await test.step('Press stop and let the held decode go', async () => {
		await header.stopWaveforms();
		await audio.releaseWaveforms();
	});

	await test.step('The header says stopped', async () => {
		await header.expectWaveforms('stopped');
	});
});

test('files that cannot be decoded are counted as failed and the rest are still made', async ({ soundboard, splash, header, audio, disk }) => {
	await test.step('Make two sounds fail to decode and start the page', async () => {
		await soundboard.open();
		await audio.failWaveform('Base Connected');
		await audio.failWaveform('Cluster Unlock');
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('Let the waveforms be made', async () => {
		await audio.finishWaveformsWith('Waveforms 16 / 16, 2 failed');
	});

	await test.step('The header counts two failures and the other waveforms exist', async () => {
		await header.expectWaveforms('Waveforms 16 / 16, 2 failed');
		await disk.expectFile('Music MP3/Song 1 MP3 with title tag.mp3.wf');
		await disk.expectFile('Sound MP3 no title tag.mp3.wf');
	});
});

test('a second visit makes none again, since the server kept them', async ({ soundboard, splash, header, audio }) => {
	await test.step('Open the page and let the waveforms be made', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.finishWaveforms();
	});

	await test.step('Reload the page', async () => {
		await soundboard.reload();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('No waveform is made again', async () => {
		await header.expectNoWaveforms();
		await audio.expectDecodedCount(0);
	});
});

test('a waveform shows in a dialog that is open when it is made', async ({ soundboard, splash, sounds, dialogs, audio }) => {
	await test.step('Hold waveform making and start the page', async () => {
		await soundboard.open();
		await audio.holdWaveforms();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step("Open the sound's dialog: it has no waveform yet", async () => {
		await sounds.useMenu('Base Connected', 'Customize');
		await dialogs.soundEditor.expectWaveform(false);
	});

	await test.step('Let the waveforms be made', async () => {
		await audio.releaseWaveforms();
		await audio.finishWaveforms();
	});

	await test.step('The open dialog shows the waveform', async () => {
		await dialogs.soundEditor.expectWaveform(true);
	});
});

test('a dialog opened afterwards shows the waveform at once', async ({ soundboard, sounds, dialogs, audio }) => {
	await test.step('Open the page and let the waveforms be made', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.finishWaveforms();
	});

	await test.step("Open the sound's dialog", async () => {
		await sounds.useMenu('Base Connected', 'Customize');
	});

	await test.step('It shows the waveform', async () => {
		await dialogs.soundEditor.expectWaveform(true);
	});
});

test('the waveform in a sound dialog is painted on its canvas', async ({ soundboard, sounds, dialogs, audio }) => {
	await test.step('Open the page and let the waveforms be made', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.finishWaveforms();
	});

	await test.step("Open the sound's dialog", async () => {
		await sounds.useMenu('Base Connected', 'Customize');
	});

	await test.step('The waveform is shown and its canvas has been painted', async () => {
		await dialogs.soundEditor.expectWaveform(true);
		await dialogs.soundEditor.expectWaveformPainted();
	});
});

test('the waveform of the playing track is painted behind its progress bar', async ({ soundboard, playlists, footer, audio }) => {
	await test.step('Open the page and let the waveforms be made', async () => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.finishWaveforms();
	});

	await test.step('Start the playlist', async () => {
		await playlists.click('Music MP3');
	});

	await test.step('The progress bar has the waveform painted behind it', async () => {
		await footer.player('Music MP3').expectWaveformPainted();
	});
});

test('before the waveform exists nothing is painted in the bar', async ({ soundboard, splash, playlists, footer, audio }) => {
	await test.step('Hold waveform making and start the page', async () => {
		await soundboard.open();
		await audio.holdWaveforms();
		await splash.click();
		await soundboard.waitUntilLoaded();
	});

	await test.step('Start the playlist', async () => {
		await playlists.click('Music MP3');
	});

	await test.step('The progress bar has nothing painted', async () => {
		await footer.player('Music MP3').expectNoWaveformPainted();
	});
});
