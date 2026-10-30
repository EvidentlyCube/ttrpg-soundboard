import { test } from '../support/fixtures.js';

test('while waveforms are made the header counts them, and the indicator goes when all are done', async ({ soundboard, splash, header, audio, disk }) => {
	await soundboard.open();
	await audio.holdWaveforms();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await header.expectWaveforms('Waveforms 0 / 16');
	await audio.releaseWaveforms();
	await audio.finishWaveforms();

	await header.expectNoWaveforms();
	await disk.expectFile('Sound MP3 with title tag.mp3.wf');
	await disk.expectFile('Music MP3/Song 1 MP3 with title tag.mp3.wf');
});

test('the stop button halts the making and the play button carries on', async ({ soundboard, splash, header, audio }) => {
	await soundboard.open();
	await audio.holdWaveforms();
	await splash.click();
	await soundboard.waitUntilLoaded();
	await header.expectWaveforms('Waveforms 0 / 16');

	await header.stopWaveforms();
	await audio.releaseWaveforms();
	await header.expectWaveforms('stopped');

	await header.continueWaveforms();
	await audio.finishWaveforms();
	await header.expectNoWaveforms();
});

test('the menu regenerates every waveform, sounds and tracks alike, even when none is missing', async ({ soundboard, header, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.finishWaveforms();
	await audio.expectDecodedCount(16);
	await audio.holdWaveforms();

	await header.regenerateWaveforms();

	await header.expectWaveforms('Waveforms 0 / 16');
	await audio.releaseWaveforms();
	await audio.finishWaveforms();
	await header.expectNoWaveforms();
	await audio.expectDecodedCount(32);
});

test('the stop button halts a regeneration too', async ({ soundboard, header, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.finishWaveforms();
	await audio.holdWaveforms();
	await header.regenerateWaveforms();
	await header.expectWaveforms('Waveforms 0 / 16');

	await header.stopWaveforms();
	await audio.releaseWaveforms();

	await header.expectWaveforms('stopped');
});

test('files that cannot be decoded are counted as failed and the rest are still made', async ({ soundboard, splash, header, audio, disk }) => {
	await soundboard.open();
	await audio.failWaveform('Base Connected');
	await audio.failWaveform('Cluster Unlock');
	await splash.click();
	await soundboard.waitUntilLoaded();

	await audio.finishWaveformsWith('Waveforms 16 / 16, 2 failed');

	await header.expectWaveforms('Waveforms 16 / 16, 2 failed');
	await disk.expectFile('Music MP3/Song 1 MP3 with title tag.mp3.wf');
	await disk.expectFile('Sound MP3 no title tag.mp3.wf');
});

test('a second visit makes none again, since the server kept them', async ({ soundboard, splash, header, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.finishWaveforms();

	await soundboard.reload();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await header.expectNoWaveforms();
	await audio.expectDecodedCount(0);
});

test('a waveform shows in a dialog that is open when it is made', async ({ soundboard, splash, sounds, dialogs, audio }) => {
	await soundboard.open();
	await audio.holdWaveforms();
	await splash.click();
	await soundboard.waitUntilLoaded();
	await sounds.useMenu('Base Connected', 'Customize');
	await dialogs.soundEditor.expectWaveform(false);

	await audio.releaseWaveforms();
	await audio.finishWaveforms();

	await dialogs.soundEditor.expectWaveform(true);
});

test('a dialog opened afterwards shows the waveform at once', async ({ soundboard, sounds, dialogs, audio }) => {
	await soundboard.startAndWaitUntilLoaded();
	await audio.finishWaveforms();

	await sounds.useMenu('Base Connected', 'Customize');

	await dialogs.soundEditor.expectWaveform(true);
});
