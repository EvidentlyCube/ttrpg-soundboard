/**
 * What drawing needs of a canvas context; spelled out so this module's tests compile without the DOM types.
 * @typedef {{ clearRect: (x: number, y: number, width: number, height: number) => void,
 * 	fillRect: (x: number, y: number, width: number, height: number) => void }} Painter
 */

/** The quietest level shown, in decibels below the peak: about one step of the 8-bit peaks (DESIGN.md §6.6). */
const FLOOR_DB = 42;
/** How much of each bar's height comes from its rank among the track's levels rather than from its decibels. */
const RANK_WEIGHT = 0.5;

/**
 * Reduces a waveform to the columns that fit the canvas, scaled so the track's own loudest peak fills the height
 * (DESIGN.md §9.7), then shaped so both loud and quiet stretches show detail. Pure, so it can be tested without a canvas.
 * @param {Int8Array} peaks min/max byte pairs
 * @param {number} columns
 * @returns {Float32Array} low and high of each column, from -1 to 1: low0, high0, low1, high1, …
 */
export function waveformColumns(peaks, columns) {
	return shapeLevels(linearColumns(peaks, columns));
}

/**
 * A linear scale hides the quiet parts of a loud track, and the peaks of a track that is loud throughout all reach the
 * top. Each level is therefore shown as the average of its decibels above a floor, which lifts quiet stretches, and
 * its rank among all of the track's levels, which spreads crowded levels over the whole height so spikes stand out.
 * Silence stays at 0 and the loudest level close to 1; signs are kept.
 * @param {Float32Array} levels from -1 to 1
 * @returns {Float32Array} the same array, shaped
 */
export function shapeLevels(levels) {
	const sorted = Float32Array.from(levels, Math.abs).filter((level) => level > 0).sort();
	if (sorted.length === 0) {
		return levels;
	}
	for (let index = 0; index < levels.length; index++) {
		const level = Math.abs(levels[index]);
		if (level === 0) {
			continue;
		}
		const decibels = Math.max(0, 1 + (20 * Math.log10(level)) / FLOOR_DB);
		// The middle of equal levels' ranks, so a track that is the same loudness throughout isn't drawn as a ramp.
		const rank = (lowerBound(sorted, level) + upperBound(sorted, level)) / 2 / sorted.length;
		levels[index] = Math.sign(levels[index]) * ((1 - RANK_WEIGHT) * decibels + RANK_WEIGHT * rank);
	}
	return levels;
}

/**
 * @param {Float32Array} sorted
 * @param {number} value
 * @returns {number} how many entries are below the value
 */
function lowerBound(sorted, value) {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (sorted[middle] < value) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/**
 * @param {Float32Array} sorted
 * @param {number} value
 * @returns {number} how many entries are at or below the value
 */
function upperBound(sorted, value) {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (sorted[middle] <= value) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/**
 * @param {Int8Array} peaks
 * @param {number} columns
 * @returns {Float32Array} low and high of each column as a fraction of the loudest peak
 */
function linearColumns(peaks, columns) {
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
