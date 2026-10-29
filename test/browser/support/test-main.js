// The composition root of the page under test: public/app/main.js with the fakes from test/helpers/ in place of the
// browser's audio and waveform decoding. The fixtures serve this file as /app/main.js and the helpers as
// /test-support/*, so the relative imports below only resolve in the browser.
import { HttpBackendApi } from './api/backend-api.js';
import { EventSourceServerEvents } from './api/server-events.js';
import { Soundboard } from './logic/soundboard.js';
import { App } from './ui/app.js';
import { FakeAudioEngine } from '../test-support/fake-audio-engine.js';
import { FakeClock } from '../test-support/fake-clock.js';
import { FakeWaveformDecoder } from '../test-support/fake-waveform-decoder.js';

const clock = new FakeClock();
const engine = new FakeAudioEngine(clock);
const decoder = new FakeWaveformDecoder();

const soundboard = new Soundboard({
	engine,
	clock,
	api: new HttpBackendApi(),
	decoder,
	serverEvents: new EventSourceServerEvents(),
	logger: console,
});

// The only way the tests reach the fakes (test/browser/support/audio.js).
globalThis.soundboardTest = { clock, engine, decoder };

const root = document.getElementById('app');
if (!root) {
	throw new Error('index.html is missing the #app element');
}
new App(soundboard).mount(root);
