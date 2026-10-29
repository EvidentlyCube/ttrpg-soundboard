import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const PLAYLIST = 'Music Order';
const app = await launch({ readyExpression: '!!document.querySelector("[data-splash]")' });
const { evaluate, click, key, sleep, screenshot, logs } = app;
const results = {};
const check = (name, ok, detail) => {
	results[name] = ok ? 'ok' : `FAIL ${JSON.stringify(detail)}`;
};
const bar = `[data-player-bar="${PLAYLIST}"]`;
const trackTitle = () => evaluate(`document.querySelector('${bar} button[title="Choose a track"]')?.textContent ?? null`);

try {
	await click('[data-splash]');
	await sleep(800);
	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);

	const radios = await evaluate('[...document.querySelectorAll("[data-radio-group=playback-order] input")].map((r) => [r.value, r.checked])');
	check('the card offers the three orders, Ordered checked', JSON.stringify(radios) === JSON.stringify([['ordered', true], ['random', false], ['shuffle', false]]), radios);
	check('each choice has its description', (await evaluate('document.querySelector("[data-radio-group=playback-order]").textContent')).includes('Every track once in a shuffled order, then shuffled again.'), null);
	await click('[data-radio-value="shuffle"]');
	await sleep(700);
	const saved = JSON.parse(await readFile(join(app.music, `${PLAYLIST}.json`), 'utf8'));
	check('choosing Shuffle saves it', saved.order === 'shuffle', saved);
	await screenshot(join(SHOTS, 'order-1-dialog.png'));
	await key('Escape');
	await sleep(300);

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(600);
	const round = [await trackTitle()];
	for (let i = 0; i < 5; i++) {
		await click(`${bar} [data-control="next"]`);
		await sleep(300);
		round.push(await trackTitle());
	}
	check('a shuffled round plays all six tracks', new Set(round).size === 6, round);
	check('it is not simply in order', round.join() !== 'Order 1,Order 2,Order 3,Order 4,Order 5,Order 6', round);

	await click(`${bar} [data-control="previous"]`);
	await sleep(300);
	check('previous goes back through the history', (await trackTitle()) === round[4], [await trackTitle(), round[4]]);

	// Choose a track from the list: in Shuffle it starts a fresh round, so previous restarts it.
	await click(`${bar} button[title="Choose a track"]`);
	await sleep(250);
	await click('[data-track-index="2"]');
	await sleep(400);
	check('choosing a track plays it', (await trackTitle()) === 'Order 3', await trackTitle());
	await click(`${bar} [data-control="previous"]`);
	await sleep(300);
	check('previous at the start of the fresh history restarts the chosen track', (await trackTitle()) === 'Order 3', await trackTitle());
	await screenshot(join(SHOTS, 'order-2-playing.png'));
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.filter((line) => !line.includes('favicon')).join('\n') || '(nothing)'}`);
	await app.close();
}
