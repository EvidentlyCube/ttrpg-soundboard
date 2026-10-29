import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const PLAYLIST = 'Music Order';
const app = await launch({ readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, mouse, key, sleep, screenshot, logs } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const bar = `[data-player-bar="${PLAYLIST}"]`;
const trackTitle = () => evaluate(`document.querySelector('${bar} button[title="Choose a track"]')?.textContent ?? null`);
const seekNearEnd = async () => {
	const r = await evaluate(`(() => { const r = document.querySelector('${bar} [data-progress]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
	await mouse(r.x + r.w * 0.93, r.y + r.h / 2);
};
const openDialog = async () => {
	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);
};

try {
	await click('[data-splash]');
	await sleep(800);
	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(600);
	await openDialog();
	check('the checkbox starts unchecked', (await evaluate('document.querySelector("[data-checkbox=track-looping]").checked')) === false, null);
	await click('[data-checkbox="track-looping"]');
	await sleep(700);
	const saved = JSON.parse(await readFile(join(app.music, `${PLAYLIST}.json`), 'utf8'));
	check('checking it saves trackLooping', saved.trackLooping === true, saved);
	await screenshot(join(SHOTS, 'loop-1-dialog.png'));
	await key('Escape');
	await sleep(300);

	check('the first track plays', (await trackTitle()) === 'Order 1', await trackTitle());
	await seekNearEnd();
	await sleep(2000);
	check('the looping track starts over instead of moving on', (await trackTitle()) === 'Order 1', await trackTitle());
	const time = await evaluate(`document.querySelector('${bar}').textContent`);
	check('the time went back to the start', /0:0[0-2] \//.test(time), time);

	await openDialog();
	await click('[data-checkbox="track-looping"]');
	await sleep(300);
	await key('Escape');
	await sleep(300);
	await seekNearEnd();
	await sleep(2000);
	check('with looping off the playlist moves on', (await trackTitle()) === 'Order 2', await trackTitle());
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.filter((line) => !line.includes('favicon')).join('\n') || '(nothing)'}`);
	await app.close();
}
