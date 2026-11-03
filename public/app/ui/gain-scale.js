import { dbToGain, gainToDb, MAX_GAIN, sliderToGain } from '../logic/volume.js';
import { formatFixed } from './text.js';

/** The part of the gain widget's width taken by the bars for gain 0 to 1; the boost from 1 to MAX_GAIN gets the rest. */
export const BARS_SHARE = 0.75;

/**
 * How a gain widget maps the value it controls onto its width and onto a real gain for the dB readout.
 * @typedef {object} GainScale
 * @property {number} max the highest value
 * @property {boolean} boost whether there is a boost section above gain 1
 * @property {(value: number) => number} toPosition 0 (left) to 1 (right)
 * @property {(position: number) => number} fromPosition
 * @property {(value: number) => number} toGain
 * @property {(gain: number) => number} fromGain clamped to the scale's range
 */

/**
 * A sound's or track's own gain, from silent to MAX_GAIN, with the boost section.
 * @type {GainScale}
 */
export const ITEM_SCALE = {
	max: MAX_GAIN,
	boost: true,
	toPosition: gainToPosition,
	fromPosition: positionToGain,
	toGain: (value) => value,
	fromGain: (gain) => clamp(gain, 0, MAX_GAIN),
};

/**
 * A header volume: a slider position from 0 to 1 over the full width, whose gain is its square (DESIGN.md §6.4).
 * @type {GainScale}
 */
export const BUS_SCALE = {
	max: 1,
	boost: false,
	toPosition: (value) => clamp(value, 0, 1),
	fromPosition: (position) => clamp(position, 0, 1),
	toGain: sliderToGain,
	fromGain: (gain) => Math.sqrt(clamp(gain, 0, 1)),
};

/** Typed values at or below this mean silence, as does stepping below it. */
const SILENCE_DB = -60;

const DB_PATTERN = /^\s*([+\-−]?)\s*(\d+(?:[.,]\d+)?|inf|∞)\s*(?:db)?\s*$/iu;

/**
 * Where a gain sits on the widget, from 0 (left) to 1 (right).
 * @param {number} gain
 */
export function gainToPosition(gain) {
	const clamped = clamp(gain, 0, MAX_GAIN);
	return clamped <= 1
		? clamped * BARS_SHARE
		: BARS_SHARE + ((clamped - 1) / (MAX_GAIN - 1)) * (1 - BARS_SHARE);
}

/**
 * The gain for a press on the widget.
 * @param {number} position 0 (left) to 1 (right), clamped
 */
export function positionToGain(position) {
	const clamped = clamp(position, 0, 1);
	return clamped <= BARS_SHARE
		? clamped / BARS_SHARE
		: 1 + ((clamped - BARS_SHARE) / (1 - BARS_SHARE)) * (MAX_GAIN - 1);
}

/**
 * `+3.5 dB`, `0.0 dB`, `−12.0 dB` or `−∞ dB`.
 * @param {number} gain
 */
export function formatDb(gain) {
	if (gain <= 0) {
		return '−∞ dB';
	}
	const db = Math.round(gainToDb(gain) * 10) / 10;
	if (db === 0) {
		return `${formatFixed(0, 1)} dB`;
	}
	return `${db > 0 ? '+' : '−'}${formatFixed(Math.abs(db), 1)} dB`;
}

/**
 * Reads what someone typed into the dB field, such as `-6`, `+3.5 dB`, `−2,5` or `-inf`.
 * @param {string} text
 * @returns {number | null} the gain, clamped to the allowed range, or null when the text is not a level
 */
export function parseDb(text) {
	const match = DB_PATTERN.exec(text);
	if (!match) {
		return null;
	}
	const negative = match[1] === '-' || match[1] === '−';
	const magnitude = /^(inf|∞)$/iu.test(match[2]) ? Infinity : Number(match[2].replace(',', '.'));
	const db = negative ? -magnitude : magnitude;
	return db <= SILENCE_DB ? 0 : Math.min(MAX_GAIN, dbToGain(db));
}

/**
 * The gain one keyboard step away: whole decibels, stepping into and out of silence below -59 dB.
 * @param {number} gain
 * @param {number} steps +1 or -1 dB
 */
export function stepGain(gain, steps) {
	const db = gain > 0 ? Math.max(gainToDb(gain), SILENCE_DB) : SILENCE_DB;
	const next = Math.round(db + steps);
	return next <= SILENCE_DB ? 0 : Math.min(MAX_GAIN, dbToGain(next));
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
