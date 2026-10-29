// What test-main.js puts on the page for the tests to reach (support/audio.js).
declare var soundboardTest: {
	clock: import('../../helpers/fake-clock.js').FakeClock;
	engine: import('../../helpers/fake-audio-engine.js').FakeAudioEngine;
	decoder: import('../../helpers/fake-waveform-decoder.js').FakeWaveformDecoder;
};
declare var soundboardTestOptions: { unplayableFormats: string[] } | undefined;
