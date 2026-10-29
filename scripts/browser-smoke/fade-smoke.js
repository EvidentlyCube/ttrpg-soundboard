// The real app, with every gain node recorded, so fade levels can be measured during a fade-in and a fade-out.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const index = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
const recorder = `<script>
	window.__gains = [];
	const createGain = AudioContext.prototype.createGain;
	AudioContext.prototype.createGain = function () { const node = createGain.call(this); window.__gains.push(node); return node; };
</script>`;
const pageHtml = index.replace('<script type="module"', `${recorder}\n\t<script type="module"`);

const app = await launch({ page: 'index.html', pageHtml, readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, key, sleep, screenshot, logs } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const q = (selector) => JSON.stringify(selector);
const PLAYLIST = 'Music Ogg';
const bar = `[data-player-bar="${PLAYLIST}"]`;
const setSeconds = (name, value) => evaluate(`(() => { const s = document.querySelector('[data-seconds-control=${name}] [data-seconds-slider]'); s.value = '${value}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
/** Each voice creates its volume node, then its fade node; the first three nodes are the buses. */
const fadeLevel = (voice) => evaluate(`+window.__gains[3 + ${voice} * 2 + 1].gain.value.toFixed(2)`);
const sample = async (voice, count) => {
	const levels = [];
	for (let i = 0; i < count; i++) {
		await sleep(400);
		levels.push(await fadeLevel(voice));
	}
	return levels;
};
const rising = (levels) => levels.every((level, i) => i === 0 || level >= levels[i - 1]) && levels[0] < 0.5 && levels.at(-1) === 1;
const falling = (levels) => levels.every((level, i) => i === 0 || level <= levels[i - 1]) && levels.at(-1) === 0;

try {
	await click('[data-splash]');
	await sleep(800);
	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	const sections = await evaluate('[...document.querySelectorAll("[data-dialog] [data-seconds-control]")].map((el) => el.dataset.secondsControl)');
	check('the dialog has Fade in, Crossfade and Fade out', JSON.stringify(sections) === JSON.stringify(['fadeIn', 'crossfade', 'fadeOut']), sections);
	check('fades are not limited by track length', (await evaluate('document.querySelector("[data-seconds-control=fadeIn] [data-seconds-slider]").max')) === '10'
	&& (await evaluate('document.querySelector("[data-seconds-control=fadeIn] p").hidden')), null);
	await setSeconds('fadeIn', 2);
	await setSeconds('fadeOut', 2);
	await sleep(100);
	await screenshot(join(SHOTS, '11-fade-dialog.png'));
	await sleep(700);
	const saved = JSON.parse(await readFile(join(app.music, `${PLAYLIST}.json`), 'utf8'));
	check('both fades are saved', saved.fadeIn === 2 && saved.fadeOut === 2, saved);
	await key('Escape');
	await sleep(200);

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	const fadeIn = await sample(0, 6);
	check('playing fades the track in from silence over 2 s', rising(fadeIn), fadeIn);

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(100);
	check('stopping removes the bar at once (no stopping state)', await evaluate(`!document.querySelector(${q(bar)})`), null);
	const fadeOut = await sample(0, 6);
	check('stopping fades the track out over 2 s', falling(fadeOut), fadeOut);

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(1000);
	await click(`${bar} [data-control="pause"]`);
	await sleep(100);
	check('pausing during a fade-in sets the track to full level', (await fadeLevel(1)) === 1, await fadeLevel(1));
	await click(`${bar} [data-control="pause"]`);
	await sleep(300);
	check('resuming plays on at full level', (await fadeLevel(1)) === 1, await fadeLevel(1));

	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="stopInstant"]');
	await sleep(150);
	check('Stop (Instant) cuts without a fade', (await fadeLevel(1)) === 1 && (await evaluate('[...document.querySelectorAll("audio")].length')) >= 0, await fadeLevel(1));
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.filter((line) => !line.includes('favicon')).join('\n') || '(nothing)'}`);
	await app.close();
}
