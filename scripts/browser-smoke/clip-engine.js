// Checks WebAudioEngine's startAt/endAt for buffer and stream voices in headless Chromium.
import { launch } from './harness.js';

const pageHtml = `<!doctype html><meta charset="utf-8"><script type="module">
import { WebAudioEngine } from './app/audio/web-audio-engine.js';
const engine = new WebAudioEngine();
engine.unlock();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(kind, url, startAt, endAt) {
	const voice = kind === 'buffer'
		? engine.createBufferVoice({ buffer: await engine.loadBuffer(url), bus: 'sfx', startAt, endAt })
		: engine.createStreamVoice({ url, bus: 'music', startAt, endAt });
	const t0 = performance.now();
	let loadedAt = null;
	const ended = new Promise((resolve) => voice.on('ended', () => resolve(performance.now())));
	voice.on('loaded', () => { loadedAt = performance.now(); });
	voice.play();
	await wait(150);
	const early = voice.position;
	const endedAt = await Promise.race([ended, wait(8000).then(() => null)]);
	const result = { kind, startAt, endAt, positionAfter150ms: +early.toFixed(3), finalPosition: +voice.position.toFixed(3),
		playedMs: endedAt && loadedAt ? Math.round(endedAt - loadedAt) : null, ended: endedAt !== null };
	voice.stop();
	return result;
}
window.results = (async () => [
	await run('buffer', '/media/Sound%20MP3%20with%20title%20tag.mp3', 0.5, 1.0),
	await run('buffer', '/media/Sound%20MP3%20with%20title%20tag.mp3', 0, null),
	await run('stream', '/media/Music%20MP3/Song%201%20MP3%20with%20title%20tag.mp3', 5, 6.5),
	await run('stream', '/media/Music%20MP3/Song%201%20MP3%20with%20title%20tag.mp3', 2, null),
])();
</script>`;

const app = await launch({ page: 'clip.html', pageHtml, autoplay: true });
try {
	const results = await app.evaluate('Promise.race([window.results, new Promise((r) => setTimeout(() => r("timeout"), 30000))])');
	console.log(JSON.stringify(results, null, 1));
} finally {
	console.log(app.logs.filter((line) => !line.includes('favicon')).join('\n') || '(no console output)');
	await app.close();
}
