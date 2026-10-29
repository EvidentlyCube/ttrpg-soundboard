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
