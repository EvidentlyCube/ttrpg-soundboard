import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, SHOTS } from './harness.js';

const WIDTH = Number(process.argv[2] ?? 1440);
const LONG = 'Averyveryverylongtitlewithoutanyspacesatall'.repeat(5);
const SOUND = `${LONG}.mp3`;
const soundBytes = await readFile(new URL('../../test_fixtures/example_soundboard/Sound MP3 with title tag.mp3', import.meta.url));
const PLAYLIST = 'Music MP3';
const TRACK = 'Music MP3/Song 1 MP3 with title tag.mp3';

const app = await launch({ extraFiles: { [SOUND]: soundBytes }, readyExpression: '!!document.querySelector("[data-splash]")', viewport: { width: WIDTH, height: 900 } });
const { evaluate, click, sleep, screenshot, logs, send, key } = app;
const results = {};
const q = (selector) => JSON.stringify(selector);
/** Every element matching `inner` must lie within its closest `outer`, and nothing may scroll sideways. */
const contained = (name, inner, outer) => evaluate(`(() => {
	const bad = [];
	for (const el of document.querySelectorAll(${q(inner)})) {
		const box = el.closest(${q(outer)}).getBoundingClientRect();
		// Text spilling out of a block element leaves the element's own box alone, so measure the text there.
		const range = document.createRange();
		range.selectNodeContents(el);
		const r = getComputedStyle(el).overflow === 'visible' ? range.getBoundingClientRect() : el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) {
			continue;
		}
		if (r.right > box.right + 0.5 || r.left < box.left - 0.5 || r.width > box.width + 0.5) {
			bad.push({ text: el.textContent.slice(0, 30), r: [r.left, r.right], box: [box.left, box.right] });
		}
	}
	return bad;
})()`).then((bad) => {
	results[name] = bad.length === 0 ? 'ok' : `FAIL ${JSON.stringify(bad)}`;
});
const noPageScroll = async (name) => {
	const widths = await evaluate('[document.documentElement.scrollWidth, window.innerWidth]');
	results[name] = widths[0] <= widths[1] ? 'ok' : `FAIL ${widths}`;
};

try {
	const patch = (path, body) => evaluate(`fetch(${q(path)}, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: ${q(JSON.stringify(body))} }).then((r) => r.status)`);
	console.log('patch', await patch(`/api/sounds/${encodeURIComponent(SOUND)}`, { title: LONG }), await patch(`/api/playlists/${encodeURIComponent(PLAYLIST)}`, { title: LONG }), await patch(`/api/tracks/${encodeURIComponent(TRACK)}`, { title: LONG }));
	await send('Page.reload');
	await sleep(1500);
	await click('[data-splash]');
	await sleep(800);

	await contained('sound tile title stays in the tile', '[data-sound-id] > span', '[data-sound-id]');
	await contained('playlist tile title stays in the tile', '[data-playlist-id] > span', '[data-playlist-id]');
	await contained('tiles stay in their grid', '[data-sound-id], [data-playlist-id]', 'section');
	const lines = await evaluate(`(() => { const s = document.querySelector('[data-playlist-id] > span'); return Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight)); })()`);
	results['the playlist title is clamped to 3 lines'] = lines === 3 ? 'ok' : `FAIL ${lines}`;
	await noPageScroll('board does not scroll sideways');

	await click(`[data-playlist-id="${PLAYLIST}"]`);
	await sleep(1200);
	await contained('player bar titles stay in the bar', '[data-player-bar] span', '[data-player-bar]');
	await screenshot(join(SHOTS, `overflow-${WIDTH}-board.png`));

	await click('[data-player-bar] button[title="Choose a track"]');
	await sleep(250);
	await contained('track list rows stay in the popover', '[data-track-index] span', '[role=menu]');
	await screenshot(join(SHOTS, `overflow-${WIDTH}-tracklist.png`));
	await key('Escape');
	await sleep(150);

	await click(`[data-sound-id="${SOUND}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	await contained('sound dialog title and hint stay in the dialog', '[data-dialog] h2, [data-dialog] p', '[data-dialog]');
	await screenshot(join(SHOTS, `overflow-${WIDTH}-sound-dialog.png`));
	await key('Escape');
	await sleep(300);

	await click(`[data-playlist-id="${PLAYLIST}"]`, 'right');
	await sleep(150);
	await click('[data-menu-item="customize"]');
	await sleep(300);
	await contained('playlist dialog title and hint stay in the dialog', '[data-dialog] h2, [data-dialog] p', '[data-dialog]');
	await click('[data-tab="tracks"]');
	await sleep(100);
	await click(`[data-track-row="${TRACK}"]`);
	await sleep(100);
	await contained('track rows and hints stay in the dialog', '[data-track-row] span, [data-track-body] p', '[data-dialog]');
	await noPageScroll('dialog does not scroll sideways');
	await screenshot(join(SHOTS, `overflow-${WIDTH}-tracks-tab.png`));
} catch (error) {
	results.crashed = String(error.stack ?? error);
} finally {
	console.log(JSON.stringify(results, null, 2));
	console.log(`--- browser console ---\n${logs.filter((line) => !line.includes('favicon')).join('\n') || '(nothing)'}`);
	await app.close();
}
