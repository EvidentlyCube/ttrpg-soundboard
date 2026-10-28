import { computePeaks } from '../logic/peaks.js';

/** @typedef {import('../logic/ports.js').WaveformDecoder} WaveformDecoder */

/** The lowest rate the Web Audio spec requires; only the shape of the sound matters here, and decoding is resampled to it. */
const DECODE_SAMPLE_RATES = [8000, 22050, 44100];

/**
 * Decodes a file at a low sample rate, so a long stereo track takes about 10 MB instead of 100 MB, reduces it to peaks
 * and drops the decoded audio (DESIGN.md §12).
 * @implements {WaveformDecoder}
 */
export class WebAudioWaveformDecoder {
	/**
	 * @param {string} url
	 * @returns {Promise<Int8Array>}
	 */
	async decode(url) {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
		}
		const encoded = await response.arrayBuffer();
		const decoded = await decodeAtLowRate(encoded);
		// Only the peaks leave this method, so the samples can be collected before the next file is decoded.
		return computePeaks(Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel)));
	}
}

/** @param {ArrayBuffer} encoded */
async function decodeAtLowRate(encoded) {
	let lastError;
	for (const sampleRate of DECODE_SAMPLE_RATES) {
		let context;
		try {
			context = new OfflineAudioContext(1, 1, sampleRate);
		} catch (error) {
			lastError = error;
			continue;
		}
		// decodeAudioData detaches its input, and a failed attempt must not leave the next one without bytes.
		return context.decodeAudioData(encoded.slice(0));
	}
	throw lastError;
}
