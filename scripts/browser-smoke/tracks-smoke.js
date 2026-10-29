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
const attr = (selector, name) => evaluate(`document.querySelector(${q(selector)})?.getAttribute(${q(name)}) ?? null`);
const typeText = async (value) => send('Input.insertText', { text: value });
const pressKey = async (keyName, code) => {
	await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code });
	await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code });
};
const PLAYLIST = 'Music MP3';
const FIRST = 'Music MP3/Song 1 MP3 with title tag.mp3';
const SECOND = 'Music MP3/Song 2 MP3 with title tag.mp3';
const bar = `[data-player-bar="${PLAYLIST}"]`;

try {
	await click('[data-splash]');
	await sleep(800);
	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(1200);
	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);

	check('the dialog opens on the Playlist tab', (await attr('[data-tab="playlist"]', 'aria-selected')) === 'true' && (await visible('#panel-playlist')) && !(await visible('#panel-tracks')), null);
	check('the Tracks tab shows the count', (await text('[data-tab="tracks"]')) === 'Tracks (2)', await text('[data-tab="tracks"]'));
	await evaluate('document.querySelector("[data-tab=playlist]").focus()');
	await pressKey('ArrowRight', 39);
	await sleep(100);
	check('the right arrow moves to the Tracks tab', (await attr('[data-tab="tracks"]', 'aria-selected')) === 'true' && (await visible('#panel-tracks')) && !(await visible('#panel-playlist')), null);
	check('Play and the save status stay visible on the Tracks tab', await visible('[data-dialog] [data-item-preview]'), null);

	const rows = await evaluate('[...document.querySelectorAll("[data-track-row]")].map((row) => row.textContent)');
	check('each row shows number, title and duration', rows.length === 2 && /^1Piece by Piece0:3\d$/.test(rows[0]) && /^2Intro0:3\d$/.test(rows[1]), rows);
	check('all rows start closed', !(await visible(`[data-track-body="${FIRST}"]`)) && !(await visible(`[data-track-body="${SECOND}"]`)), null);
	await click(`[data-track-row="${FIRST}"]`);
	await sleep(100);
	check('clicking a row opens it', (await visible(`[data-track-body="${FIRST}"]`)) && (await attr(`[data-track-row="${FIRST}"]`, 'aria-expanded')) === 'true', null);
	await click(`[data-track-row="${SECOND}"]`);
	await sleep(100);
	check('opening another row closes the first', !(await visible(`[data-track-body="${FIRST}"]`)) && (await visible(`[data-track-body="${SECOND}"]`)), null);
	await click(`[data-track-row="${SECOND}"]`);
	await sleep(100);
	check('clicking the open row closes it', !(await visible(`[data-track-body="${SECOND}"]`)), null);

	await click(`[data-track-row="${FIRST}"]`);
	await sleep(100);
	check('the open track shows its file', (await text(`[data-track-body="${FIRST}"] p`)) === `File: ${FIRST}`, await text(`[data-track-body="${FIRST}"] p`));
	await evaluate(`(() => { const input = document.querySelector(${q(`[data-track-body="${FIRST}"] [data-item-title]`)}); input.focus(); input.select(); })()`);
	await typeText('Opening Theme');
	await sleep(150);
	check('the row header follows the new title while typing', (await text(`[data-track-row="${FIRST}"] .truncate`)) === 'Opening Theme', await text(`[data-track-row="${FIRST}"] .truncate`));
	check('the title field keeps focus', (await evaluate('document.activeElement?.value')) === 'Opening Theme', null);
	check('the footer shows the new title of the playing track', (await text(`${bar} button[title="Choose a track"]`)) === 'Opening Theme', await text(`${bar} button[title="Choose a track"]`));
	await sleep(700);
	check('the save status shows the checkmark', (await attr('[data-save-status]', 'data-state')) === 'saved', null);
	await screenshot(join(SHOTS, '12-tracks-tab.png'));

	await key('Escape');
	await sleep(300);
	const saved = JSON.parse(await readFile(join(app.music, `${FIRST}.json`), 'utf8'));
	check('the title is saved to the track options file', saved.title === 'Opening Theme' && typeof saved.duration === 'number', saved);
	await click(`${bar} button[title="Choose a track"]`);
	await sleep(250);
	check('the footer track list shows the new title', (await text('[data-track-index="0"]'))?.includes('Opening Theme'), await text('[data-track-index="0"]'));
	await key('Escape');
	check('the tracks keep their order', (await evaluate('fetch("/api/library").then((r) => r.json())')).playlists.find((p) => p.id === PLAYLIST).tracks.map((t) => t.title).join() === 'Opening Theme,Intro', null);

	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	check('the dialog opens on the Playlist tab again', (await attr('[data-tab="playlist"]', 'aria-selected')) === 'true', null);
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.filter((line) => !line.includes('favicon')).join('\n') || '(nothing)'}`);
	await app.close();
}
