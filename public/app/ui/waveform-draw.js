/**
 * What drawing needs of a canvas context; spelled out so this module's tests compile without the DOM types.
 * @typedef {{ clearRect: (x: number, y: number, width: number, height: number) => void,
 * 	fillRect: (x: number, y: number, width: number, height: number) => void }} Painter
 */

/**
 * Reduces a waveform to the columns that fit the canvas, scaled so the track's own loudest peak fills the height
 * (DESIGN.md §9.7). Pure, so it can be tested without a canvas.
 * @param {Int8Array} peaks min/max byte pairs
 * @param {number} columns
 * @returns {Float32Array} low and high of each column, from -1 to 1: low0, high0, low1, high1, …
 */
export function waveformColumns(peaks, columns) {
	const result = new Float32Array(columns * 2);
	const buckets = peaks.length / 2;
	let loudest = 0;
	for (const value of peaks) {
		loudest = Math.max(loudest, Math.abs(value));
	}
	if (buckets === 0 || columns === 0 || loudest === 0) {
		return result;
	}
	for (let column = 0; column < columns; column++) {
		const from = Math.min(buckets - 1, Math.floor(column * buckets / columns));
		const to = Math.max(from + 1, Math.floor((column + 1) * buckets / columns));
		let low = 0;
		let high = 0;
		for (let bucket = from; bucket < to; bucket++) {
			low = Math.min(low, peaks[bucket * 2]);
			high = Math.max(high, peaks[bucket * 2 + 1]);
		}
		result[column * 2] = low / loudest;
		result[column * 2 + 1] = high / loudest;
	}
	return result;
}

/**
 * Draws columns as vertical bars mirrored around the middle, at least one pixel tall so silence still shows a line.
 * @param {Painter} context a canvas 2D context
 * @param {Float32Array} columns from `waveformColumns`
 * @param {number} width canvas pixels
 * @param {number} height canvas pixels
 * @param {number} pitch canvas pixels from one bar to the next
 * @param {number} barWidth canvas pixels
 */
export function drawWaveform(context, columns, width, height, pitch, barWidth) {
	context.clearRect(0, 0, width, height);
	const middle = height / 2;
	for (let column = 0; column < columns.length / 2; column++) {
		const top = middle - columns[column * 2 + 1] * middle;
		const bottom = middle - columns[column * 2] * middle;
		context.fillRect(column * pitch, Math.min(top, middle - 0.5), barWidth, Math.max(bottom - top, 1));
	}
}
