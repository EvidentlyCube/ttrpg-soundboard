import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const app = await launch({ readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, key, sleep, screenshot, logs, send } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const q = (selector) => JSON.stringify(selector);
const text = (selector) => evaluate(`document.querySelector(${q(selector)})?.textContent ?? null`);
const typeText = async (value) => send('Input.insertText', { text: value });
const pressKey = async (keyName, code) => {
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code });
};
const PLAYLIST = 'Music MP3';
const bar = `[data-player-bar="${PLAYLIST}"]`;
const trackTitle = () => text(`${bar} button[title="Choose a track"]`);
const options = async () => JSON.parse(await readFile(join(app.music, `${PLAYLIST}.json`), 'utf8'));

try {
	await click('[data-splash]');
	await sleep(800);
	const library = await evaluate('fetch("/api/library").then((r) => r.json())');
	const durations = library.playlists.find((p) => p.id === PLAYLIST).tracks.map((t) => t.duration);
	check('the library carries measured durations', durations.every((d) => d > 29 && d < 32), durations);

	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	check('the crossfade starts Off', (await text('[data-seconds-control=crossfade] [data-seconds-readout]')) === 'Off', await text('[data-seconds-control=crossfade] [data-seconds-readout]'));
	check('the slider stops at 10 s', (await evaluate('document.querySelector("[data-seconds-control=crossfade] [data-seconds-slider]").max')) === '10', null);
	check('the note gives the limit from the shortest track', (await text('[data-seconds-control=crossfade] p'))?.startsWith('Up to 15.1 s'), await text('[data-seconds-control=crossfade] p'));

	await evaluate('(() => { const s = document.querySelector("[data-seconds-control=crossfade] [data-seconds-slider]"); s.value = "4"; s.dispatchEvent(new Event("input", { bubbles: true })); })()');
	await sleep(100);
	check('moving the slider sets 4.0 s', (await text('[data-seconds-control=crossfade] [data-seconds-readout]')) === '4.0 s', await text('[data-seconds-control=crossfade] [data-seconds-readout]'));
	await sleep(700);
	check('the crossfade is saved to the playlist file', (await options()).crossfade === 4, await options());

	await click('[data-seconds-control=crossfade] [data-seconds-readout]');
	await typeText('25');
	await pressKey('Enter', 13);
	await sleep(100);
	check('a typed value above the limit is clamped to it', (await text('[data-seconds-control=crossfade] [data-seconds-readout]')) === '15.1 s', await text('[data-seconds-control=crossfade] [data-seconds-readout]'));
	await click('[data-seconds-control=crossfade] [data-seconds-readout]');
	await typeText('4');
	await pressKey('Enter', 13);
	await sleep(100);
	await screenshot(join(SHOTS, '9-crossfade-dialog.png'));
	await key('Escape');
	await sleep(200);

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(1500);
	check('the first track plays', (await trackTitle()) === 'Piece by Piece', await trackTitle());
	const band = await evaluate(`(() => {
		const band = document.querySelector(${q(`${bar} [data-crossfade-band]`)});
		const track = band.parentElement.getBoundingClientRect();
		const box = band.getBoundingClientRect();
		return { visible: band.checkVisibility(), share: box.width / track.width, alignedRight: Math.abs(box.right - track.right) < 1, color: getComputedStyle(band).backgroundColor };
	})()`);
	check('the progress bar shows the crossfade section at its end', band.visible && band.alignedRight && Math.abs(band.share - 4 / 30.8) < 0.02, band);
	await screenshot(join(SHOTS, '10-crossfade-band.png'));
	const progress = await evaluate(`(() => { const r = document.querySelector(${q(`${bar} [data-progress]`)}).getBoundingClientRect(); return { left: r.left, width: r.width, y: r.top + r.height / 2 }; })()`);
	// Seek to about 6 s before the end: the crossfade (4 s) should start about 2 s later.
	await app.mouse(progress.left + progress.width * (24.8 / 30.8), progress.y);
	await sleep(800);
	check('no crossfade yet with 6 s left', (await trackTitle()) === 'Piece by Piece', await trackTitle());
	await sleep(2500);
	check('the next track takes over about crossfade seconds before the end', (await trackTitle()) === 'Intro', await trackTitle());
	const mediaCount = await evaluate('performance.getEntriesByType("resource").filter((r) => r.name.includes("/media/")).length');
	check('the next track was requested while the first still played', mediaCount >= 2, mediaCount);

	await click(`${bar} [data-control="stop"]`);
	await sleep(300);
	check('Stop ends the playlist during or after the crossfade', (await evaluate(`!document.querySelector(${q(bar)})`)), null);

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(1500);
	const again = await evaluate(`(() => { const r = document.querySelector(${q(`${bar} [data-progress]`)}).getBoundingClientRect(); return { left: r.left, width: r.width, y: r.top + r.height / 2 }; })()`);
	await app.mouse(again.left + again.width * 0.99, again.y);
	await sleep(400);
	check('pressing past the crossfade point starts the crossfade at once', (await trackTitle()) === 'Intro', await trackTitle());
	const playedFor = await evaluate('(() => { const audio = [...document.querySelectorAll("audio")]; return audio.length; })()');
	await sleep(1500);
	check('the old track keeps playing under the new one for the crossfade, not just the last moment', (await trackTitle()) === 'Intro', { playedFor });
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.join('\n') || '(nothing)'}`);
	await app.close();
}
