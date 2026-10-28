/** Min/max pairs per waveform; the server stores exactly this many (DESIGN.md §5.1). */
export const WAVEFORM_BUCKETS = 1024;

/**
 * Reduces decoded audio to a waveform: for each of `buckets` equal slices of the audio, the lowest and highest sample
 * across all channels, scaled to -127..127 bytes. Layout: min0, max0, min1, max1, …
 * @param {ArrayLike<number>[]} channels equal-length samples in -1..1
 * @param {number} [buckets]
 * @returns {Int8Array}
 */
export function computePeaks(channels, buckets = WAVEFORM_BUCKETS) {
	const peaks = new Int8Array(buckets * 2);
	const length = channels[0]?.length ?? 0;
	if (length === 0) {
		return peaks;
	}
	for (let bucket = 0; bucket < buckets; bucket++) {
		const from = Math.min(length - 1, Math.floor(bucket * length / buckets));
		// A file shorter than the bucket count still gives each bucket at least one sample.
		const to = Math.max(from + 1, Math.floor((bucket + 1) * length / buckets));
		let low = 0;
		let high = 0;
		for (const channel of channels) {
			for (let index = from; index < to; index++) {
				const sample = channel[index];
				if (sample < low) {
					low = sample;
				} else if (sample > high) {
					high = sample;
				}
			}
		}
		peaks[bucket * 2] = toByte(low);
		peaks[bucket * 2 + 1] = toByte(high);
	}
	return peaks;
}

/** @param {number} sample */
function toByte(sample) {
	return Math.round(Math.max(-1, Math.min(1, sample)) * 127);
}
