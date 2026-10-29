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
const visible = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); return !!el && el.checkVisibility(); })()`);
const order = () => evaluate('[...document.querySelectorAll("[data-playlist-id]")].map((el) => el.dataset.playlistId)');
const options = async (name) => JSON.parse(await readFile(join(app.music, `${name}.json`), 'utf8'));
const typeText = async (value) => send('Input.insertText', { text: value });
const PLAYLIST = 'Music Mix';
const bar = `[data-player-bar="${PLAYLIST}"]`;

try {
	await click('[data-splash]');
	await sleep(800);
	const initialOrder = await order();

	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(200);
	check('Customize is enabled in the playlist menu', (await evaluate('document.querySelector("[data-menu-item=customize]")?.disabled')) === false, null);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	check('the playlist dialog opens with its title focused and the folder below', (await visible('[data-dialog]'))
	&& (await text('[data-dialog] h2')) === 'Customize playlist'
	&& (await evaluate('document.activeElement?.value')) === PLAYLIST
	&& (await evaluate('document.querySelector("[data-dialog]").textContent.includes("Folder: Music Mix")')), await evaluate('document.activeElement?.outerHTML'));

	await click('[data-item-preview]');
	await sleep(1200);
	check('Play starts the playlist and the button turns into Stop', (await text('[data-item-preview]'))?.trim() === 'Stop' && (await visible(bar)), null);

	const box = await evaluate('(() => { const r = document.querySelector("[data-dialog] [data-gain-track]").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()');
	await app.mouse(box.left + box.width * 0.375, box.top + box.height / 2);
	await sleep(100);
	check('the volume widget sets −6 dB', (await text('[data-dialog] [data-gain-readout]')) === '−6.0 dB', await text('[data-dialog] [data-gain-readout]'));

	await evaluate('document.querySelector("[data-item-title]").select()');
	await typeText('Zzz Mix');
	await sleep(150);
	check('the tile and the player bar show the new title at once', (await text(`[data-playlist-id="${PLAYLIST}"] span`)) === 'Zzz Mix'
	&& (await text(`${bar} span`)) === 'Zzz Mix', [await text(`[data-playlist-id="${PLAYLIST}"] span`), await text(`${bar} span`)]);
	check('the tile does not move while the dialog is open', JSON.stringify(await order()) === JSON.stringify(initialOrder), await order());
	await sleep(700);
	check('the checkmark appears once saved', (await evaluate('document.querySelector("[data-save-status]").dataset.state')) === 'saved', null);
	await screenshot(join(SHOTS, '8-playlist-dialog.png'));

	await key('Escape');
	await sleep(300);
	check('closing re-sorts the playlist tiles', (await order()).at(-1) === PLAYLIST, await order());
	const saved = await options(PLAYLIST);
	check('title and gain saved, subdirectories kept', saved.title === 'Zzz Mix' && Math.abs(saved.gain - 0.5) < 0.01 && Array.isArray(saved.includedSubdirectories), saved);
	check('the playlist keeps playing after the dialog closes', await visible(bar), null);

	await click(`${bar} [data-control="stop"]`);
	await sleep(300);
	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(800);
	check('a bar opened after the rename shows the new title', (await text(`${bar} span`)) === 'Zzz Mix', await text(`${bar} span`));
	await click(`${bar} [data-control="stop"]`);

	await send('Page.reload');
	await sleep(1000);
	await click('[data-splash]');
	await sleep(800);
	check('after a reload the title and order are kept', (await text(`[data-playlist-id="${PLAYLIST}"] span`)) === 'Zzz Mix' && (await order()).at(-1) === PLAYLIST, await order());
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.join('\n') || '(nothing)'}`);
	await app.close();
}
