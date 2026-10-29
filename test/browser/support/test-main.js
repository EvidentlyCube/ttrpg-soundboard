// The composition root of the page under test: public/app/main.js with the fakes from test/helpers/ in place of the
// browser's audio and waveform decoding. The fixtures serve this file as /app/main.js and the helpers as
// /test-support/*, so the relative imports below only resolve in the browser.
import { WAVEFORM_BUCKETS } from './logic/peaks.js';
import { HttpBackendApi } from './api/backend-api.js';
import { EventSourceServerEvents } from './api/server-events.js';
import { Soundboard } from './logic/soundboard.js';
import { App } from './ui/app.js';
import { FakeAudioEngine } from '../test-support/fake-audio-engine.js';
import { FakeClock } from '../test-support/fake-clock.js';
import { FakeWaveformDecoder } from '../test-support/fake-waveform-decoder.js';

const clock = new FakeClock();
// Loading takes no time unless a test scripts it, so a press needs no `advance` before its sound starts.
// The fixtures say which formats this "browser" cannot play (support/fixtures.js).
const unplayable = /** @type {string[]} */ (globalThis.soundboardTestOptions?.unplayableFormats ?? []);
const engine = new FakeAudioEngine(clock, { defaultScript: { loadDelay: 0 }, canPlay: (format) => !unplayable.includes(format) });
// The server only accepts waveforms of the full size, which the plain fake's two bytes are not.
class FullSizeDecoder extends FakeWaveformDecoder {
	/** @param {string} url */
	async decode(url) {
		const peaks = await super.decode(url);
		return Int8Array.from({ length: WAVEFORM_BUCKETS * 2 }, (_, index) => peaks[index % 2]);
	}
}
const decoder = new FullSizeDecoder();

const soundboard = new Soundboard({
	engine,
	clock,
	api: new HttpBackendApi(),
	decoder,
	serverEvents: new EventSourceServerEvents(),
	logger: console,
});

// Work that is already due (a load that takes no time) runs by itself; the clock never moves otherwise.
setInterval(() => clock.advance(0), 10);

// The only way the tests reach the fakes (test/browser/support/audio.js).
globalThis.soundboardTest = { clock, engine, decoder };

const root = document.getElementById('app');
if (!root) {
	throw new Error('index.html is missing the #app element');
}
new App(soundboard).mount(root);
