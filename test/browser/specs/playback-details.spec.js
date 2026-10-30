import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../../helpers/tmp-tree.js';
import { expect, test } from '../support/fixtures.js';

const MP3 = readFileSync(join(FIXTURES_DIR, 'example_soundboard', 'Sound MP3 no title tag.mp3'));
const ORDERED = ['Order 1', 'Order 2', 'Order 3', 'Order 4', 'Order 5', 'Order 6'];

/**
 * Presses Next until the bar has shown this many tracks, starting with the one it shows now.
 * @param {import('../pages/footer.js').PlayerBarPage} player
 * @param {number} count
 */
async function titlesPlayed(player, count) {
	const titles = [await player.currentTrack()];
	while (titles.length < count) {
		await player.next();
		await expect.poll(() => player.currentTrack()).not.toBe(titles.at(-1));
		titles.push(await player.currentTrack());
	}
	return titles;
}

test.describe('the playback orders', () => {
	test.use({ randomSeed: 7 });

	test.beforeEach(async ({ soundboard }) => {
		await soundboard.startAndWaitUntilLoaded();
	});

	test('ordered goes through the tracks as listed', async ({ playlists, footer }) => {
		await playlists.click('Music Order');

		expect(await titlesPlayed(footer.player('Music Order'), 6)).toEqual(ORDERED);
	});

	test('shuffle plays every track once before any comes again, in an order of its own', async ({ playlists, dialogs, footer }) => {
		await playlists.useMenu('Music Order', 'Customize');
		await dialogs.playlistEditor.chooseOrder('shuffle');
		await dialogs.playlistEditor.close();
		await playlists.click('Music Order');

		const first = await titlesPlayed(footer.player('Music Order'), 6);

		expect([...first].sort()).toEqual(ORDERED);
		expect(first).not.toEqual(ORDERED);
	});

	test('random never plays the same track twice in a row, and does not follow the list', async ({ playlists, dialogs, footer }) => {
		await playlists.useMenu('Music Order', 'Customize');
		await dialogs.playlistEditor.chooseOrder('random');
		await dialogs.playlistEditor.close();
		await playlists.click('Music Order');

		const titles = await titlesPlayed(footer.player('Music Order'), 12);

		expect(new Set(titles).size).toBeGreaterThan(2);
		expect(titles).not.toEqual(ORDERED.concat(ORDERED).slice(0, 12));
	});

	test('Previous goes back through the tracks that were played, not through the list', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.useMenu('Music Order', 'Customize');
		await dialogs.playlistEditor.chooseOrder('shuffle');
		await dialogs.playlistEditor.close();
		await playlists.click('Music Order');
		const player = footer.player('Music Order');
		const played = await titlesPlayed(player, 3);

		await player.previous();
		await expect.poll(() => player.currentTrack()).toBe(played[1]);
		await player.previous();
		await expect.poll(() => player.currentTrack()).toBe(played[0]);
		await audio.expectPlaying(played[0]);
	});
});

test.describe('fades and crossfades', () => {
	test.beforeEach(async ({ soundboard, audio }) => {
		await soundboard.startAndWaitUntilLoaded();
		await audio.script('Piece by Piece', { duration: 30 });
		await audio.script('Intro', { duration: 30 });
	});

	test('a fade-in ramps the track up from silence over that long', async ({ playlists, dialogs, audio }) => {
		await playlists.useMenu('Music MP3', 'Customize');
		await dialogs.playlistEditor.setFadeIn('2');
		await dialogs.playlistEditor.close();

		await playlists.click('Music MP3');

		await audio.expectRamp('Piece by Piece', [0, 0]);
		await audio.expectRamp('Piece by Piece', [1, 2]);
	});

	test('a crossfade starts the next track while this one is fading out, and shows on the progress bar', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.useMenu('Music MP3', 'Customize');
		await dialogs.playlistEditor.setCrossfade('3');
		await dialogs.playlistEditor.close();
		await playlists.click('Music MP3');
		const player = footer.player('Music MP3');
		await audio.expectPlaying('Piece by Piece');
		await player.expectCrossfadeBand(10);

		await audio.advance(27_000);

		await audio.expectPlaying('Intro');
		await audio.expectPlaying('Piece by Piece');
		await audio.expectRamp('Piece by Piece', [0, 3]);
		await audio.expectRamp('Intro', [1, 3]);
		await player.expectTrack('Intro');
	});

	test('without a crossfade the progress bar has no band', async ({ playlists, footer, audio }) => {
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');

		await footer.player('Music MP3').expectCrossfadeBand(null);
	});

	test('a fade-out brings a stopped playlist down over that long', async ({ playlists, dialogs, footer, audio }) => {
		await playlists.useMenu('Music MP3', 'Customize');
		await dialogs.playlistEditor.setFadeOut('2');
		await dialogs.playlistEditor.close();
		await playlists.click('Music MP3');
		await audio.expectPlaying('Piece by Piece');

		await footer.player('Music MP3').stop();

		await audio.expectRamp('Piece by Piece', [0, 2]);
	});
});

test.describe('the track list', () => {
	test.describe('in a browser that cannot play Ogg', () => {
		test.use({ unplayableFormats: ['ogg'] });

		test('shows a track in that format but will not take it', async ({ soundboard, playlists, footer }) => {
			await soundboard.startAndWaitUntilLoaded();
			await playlists.click('Music Mix');
			const player = footer.player('Music Mix');

			await player.openTrackList();

			await player.expectTrackList(['Piece by Piece', 'Intro']);
			await player.expectTrackDisabled('Intro');
		});
	});

	test.describe('with many tracks', () => {
		test.use({
			library: { Long: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`t${String(index + 1).padStart(2, '0')}.mp3`, MP3])) },
		});

		test('opens scrolled to the track that plays', async ({ soundboard, playlists, footer }) => {
			await soundboard.startAndWaitUntilLoaded();
			await playlists.click('Long');
			const player = footer.player('Long');
			await player.openTrackList();
			await player.jumpTo('t28.mp3');
			await player.expectTrack('t28.mp3');

			await player.openTrackList();

			await player.expectTrackListShows('t28.mp3');
		});
	});
});

test.describe('the footer', () => {
	test.use({
		library: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`List ${index + 1}`, { 'song.mp3': MP3 }])),
	});

	test('puts three bars in a row, two rows at most and then scrolls', async ({ soundboard, playlists, footer }) => {
		await soundboard.startAndWaitUntilLoaded();

		for (let number = 1; number <= 3; number++) {
			await playlists.click(`List ${number}`);
		}
		await footer.expectRows([3]);
		await footer.expectScrolls(false);
		const oneRow = await footer.height();

		for (let number = 4; number <= 6; number++) {
			await playlists.click(`List ${number}`);
		}
		await footer.expectRows([3, 3]);
		await footer.expectScrolls(false);
		const twoRows = await footer.height();

		await playlists.click('List 7');
		await footer.expectRows([3, 3, 1]);
		await footer.expectScrolls(true);

		test.expect(twoRows).toBeGreaterThan(oneRow);
		test.expect(await footer.height()).toBe(twoRows);
	});
});

test.describe('sound instances', () => {
	test.describe('of a small sound', () => {
		test('the ninth press replaces the oldest of eight', async ({ soundboard, sounds, audio }) => {
			await soundboard.startAndWaitUntilLoaded();
			await audio.script('Base Connected', { duration: 30 });

			for (let press = 0; press < 8; press++) {
				await sounds.click('Base Connected');
			}
			await audio.expectPlayingCount(8, { title: 'Base Connected' });

			await sounds.click('Base Connected');

			await audio.expectPlayingCount(8, { title: 'Base Connected' });
		});

		test('is played from memory', async ({ soundboard, sounds, audio }) => {
			await soundboard.startAndWaitUntilLoaded();

			await sounds.click('Base Connected');

			await audio.expectVoice('Base Connected', { kind: 'buffer' });
		});
	});

	test.describe('of a large sound', () => {
		test.use({ library: { 'Big.mp3': Buffer.concat(Array.from({ length: 8 }, () => MP3)), 'Small.mp3': MP3 } });

		test('is streamed from the file instead, and a small one next to it is not', async ({ soundboard, sounds, audio }) => {
			await soundboard.startAndWaitUntilLoaded();

			await sounds.click('Big.mp3');
			await sounds.click('Small.mp3');

			await audio.expectVoice('Big.mp3', { kind: 'stream' });
			await audio.expectVoice('Small.mp3', { kind: 'buffer' });
		});
	});
});
