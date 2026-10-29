// Samples the fade gain of a sound with fades and an end point, through the real Soundboard and WebAudioEngine.
import { launch } from './harness.js';

const pageHtml = `<!doctype html><meta charset="utf-8"><script type="module">
const gains = [];
const original = AudioContext.prototype.createGain;
AudioContext.prototype.createGain = function () { const node = original.call(this); gains.push(node); return node; };
import('./app/audio/web-audio-engine.js').then(async ({ WebAudioEngine }) => {
	const { Soundboard } = await import('./app/logic/soundboard.js');
	const { HttpBackendApi } = await import('./app/api/backend-api.js');
	const soundboard = new Soundboard({ engine: new WebAudioEngine(), clock: window, api: new HttpBackendApi(''), logger: console });
	await soundboard.start();
	const id = 'Sound MP3 with title tag.mp3';
	soundboard.customizeSound(id, { startAt: 0.2, endAt: 1.2, fadeIn: 0.3, fadeOut: 0.3 });
	const before = gains.length;
	const t0 = performance.now();
	let ended = null;
	soundboard.on('sound.activeChanged', (e) => { if (!e.active) ended = performance.now() - t0; });
	soundboard.playSound(id);
	const samples = [];
	await new Promise((resolve) => {
		const timer = setInterval(() => {
			// Each voice has two gain nodes: its volume, then its fade.
			const fade = gains[before + 1];
			samples.push([Math.round(performance.now() - t0), fade ? +fade.gain.value.toFixed(2) : null]);
			if (performance.now() - t0 > 1400) { clearInterval(timer); resolve(); }
		}, 50);
	});
	window.results = { ended: Math.round(ended), samples };
});
</script>`;

const app = await launch({ page: 'fades.html', pageHtml, autoplay: true });
try {
	for (let i = 0; i < 60 && !(await app.evaluate('!!window.results')); i++) {
		await app.sleep(100);
	}
	const { ended, samples } = await app.evaluate('window.results');
	console.log('ended after', ended, 'ms');
	console.log(samples.map(([t, g]) => `${t}:${g}`).join('  '));
} finally {
	console.log(app.logs.filter((line) => !line.includes('favicon')).join('\n') || '(no console output)');
	await app.close();
}
