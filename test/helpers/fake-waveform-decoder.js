/** @typedef {import('../../public/app/logic/ports.js').WaveformDecoder} WaveformDecoder */

/**
 * A decoder that answers each URL with a fixed waveform, or fails or waits when a test says so.
 * @implements {WaveformDecoder}
 */
export class FakeWaveformDecoder {
	/** @type {string[]} */
	decoded = [];
	/** URLs that fail to decode. @type {Set<string>} */
	failing = new Set();
	/** When set, decoding waits for it, so a test can act while a file is being decoded. @type {Promise<void> | null} */
	gate = null;

	/** @param {string} url */
	async decode(url) {
		this.decoded.push(url);
		await this.gate;
		if (this.failing.has(url)) {
			throw new Error('Could not decode');
		}
		return Int8Array.of(-url.length, url.length);
	}
}
