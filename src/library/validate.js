/**
 * Shape checks for the JSON files the app reads. Each validator returns every problem it finds, or an empty list.
 * Unknown keys are always allowed, so files written by future versions still load.
 */

/** @typedef {{ size: number, modified: string, sha1: string }} MeasuredFrom what a stored duration was measured from */
/**
 * @typedef {{ title?: string, gain?: number, duration?: number | null, measuredFrom?: MeasuredFrom, startAt?: number,
 * 	endAt?: number | null, fadeIn?: number, fadeOut?: number }} AudioOptions
 */
/**
 * @typedef {{ title?: string, gain?: number, crossfade?: number, fadeIn?: number, fadeOut?: number,
 * 	order?: PlaybackOrder, includedSubdirectories?: string[] }} PlaylistOptions
 */
/** @typedef {typeof PLAYBACK_ORDERS[number]} PlaybackOrder */
/** @typedef {{ master: number, music: number, sfx: number }} Volumes */
/** @typedef {{ version: number, volumes?: Partial<Volumes> }} SettingsFile */

export const SETTINGS_VERSION = 1;

/** @type {readonly (keyof Volumes)[]} */
export const VOLUME_BUSES = ['master', 'music', 'sfx'];

/** The loudest boost a sound, track or playlist may have: just over +12 dB. */
export const MAX_GAIN = 4;

/** The longest crossfade, fade-in or fade-out a playlist or sound may have, in seconds. */
export const MAX_CROSSFADE = 30;

/** How a playlist moves through its tracks; the first is the default. */
export const PLAYBACK_ORDERS = /** @type {const} */ (['ordered', 'random', 'shuffle']);

/** How much of a sound must stay between its start and end points, in milliseconds. */
export const MIN_CLIP_MS = 10;

const NOT_AN_OBJECT = 'must be a JSON object';

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateAudioOptions(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	return [
		...checkTitle(value),
		...checkGain(value),
		...checkDuration(value),
		...checkClip(value),
		...checkSeconds(value, ['fadeIn', 'fadeOut']),
	];
}

/**
 * Checks start and end points on their own and against each other; a missing start counts as 0.
 * @param {Record<string, unknown>} value
 * @returns {string[]}
 */
export function checkClip(value) {
	const { startAt = 0, endAt = null } = value;
	const problems = [];
	const validStart = isSeconds(startAt);
	if (!validStart) {
		problems.push('"startAt" must be a non-negative number of seconds');
	}
	if (endAt !== null && !isSeconds(endAt)) {
		problems.push('"endAt" must be a non-negative number of seconds or null');
	} else if (
		validStart
		&& typeof endAt === 'number'
		// Compared in whole milliseconds, so that floating-point noise never turns 10 ms into 9.999….
		&& Math.round(endAt * 1000) - Math.round(/** @type {number} */ (startAt) * 1000) < MIN_CLIP_MS
	) {
		problems.push(`"endAt" must be at least ${MIN_CLIP_MS / 1000} seconds after "startAt"`);
	}
	return problems;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validatePlaylistOptions(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	const problems = [...checkTitle(value), ...checkGain(value), ...checkSeconds(value, ['crossfade', 'fadeIn', 'fadeOut'])];
	if ('order' in value && !(/** @type {readonly unknown[]} */ (PLAYBACK_ORDERS)).includes(value.order)) {
		problems.push('"order" must be "ordered", "random" or "shuffle"');
	}
	if (
		'includedSubdirectories' in value
		&& !(Array.isArray(value.includedSubdirectories) && value.includedSubdirectories.every((entry) => typeof entry === 'string'))
	) {
		problems.push('"includedSubdirectories" must be an array of strings');
	}
	return problems;
}

/**
 * @param {unknown} value
 * @param {string} [keyPrefix] prepended to keys in messages, for volumes nested in another object
 * @returns {string[]}
 */
export function validateVolumes(value, keyPrefix = '') {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	return VOLUME_BUSES
		.filter((bus) => bus in value && !isVolume(value[bus]))
		.map((bus) => `"${keyPrefix}${bus}" must be a number from 0 to 1`);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateSettingsFile(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	const problems = [];
	const { version } = value;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		problems.push('"version" must be a positive integer');
	} else if (version > SETTINGS_VERSION) {
		problems.push(`was created by a newer version of the app (version ${version}, this app supports up to ${SETTINGS_VERSION})`);
	}
	if ('volumes' in value) {
		problems.push(...(isPlainObject(value.volumes)
			? validateVolumes(value.volumes, 'volumes.')
			: ['"volumes" must be a JSON object']));
	}
	return problems;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value */
function checkTitle(value) {
	if ('title' in value && !(typeof value.title === 'string' && value.title.trim() !== '')) {
		return ['"title" must be a non-empty string'];
	}
	return [];
}

/** @param {Record<string, unknown>} value */
function checkDuration(value) {
	const problems = [];
	if (('duration' in value) !== ('measuredFrom' in value)) {
		problems.push('"duration" and "measuredFrom" must be present together');
	}
	const { duration, measuredFrom } = value;
	if ('duration' in value && duration !== null && !(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0)) {
		problems.push('"duration" must be a non-negative number or null');
	}
	if ('measuredFrom' in value && !isMeasuredFrom(measuredFrom)) {
		problems.push('"measuredFrom" must be an object with "size", "modified" and a 40-character hex "sha1"');
	}
	return problems;
}

/** @param {unknown} value */
function isMeasuredFrom(value) {
	return isPlainObject(value)
		&& typeof value.size === 'number'
		&& Number.isInteger(value.size)
		&& value.size >= 0
		&& typeof value.modified === 'string'
		&& typeof value.sha1 === 'string'
		&& /^[0-9a-f]{40}$/.test(value.sha1);
}

/** @param {Record<string, unknown>} value */
function checkGain(value) {
	const { gain } = value;
	if ('gain' in value && !(typeof gain === 'number' && gain >= 0 && gain <= MAX_GAIN)) {
		return [`"gain" must be a number from 0 to ${MAX_GAIN}`];
	}
	return [];
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} keys fades and crossfades, each from 0 to `MAX_CROSSFADE` seconds
 */
function checkSeconds(value, keys) {
	return keys
		.filter((key) => key in value && !(typeof value[key] === 'number' && value[key] >= 0 && value[key] <= MAX_CROSSFADE))
		.map((key) => `"${key}" must be a number of seconds from 0 to ${MAX_CROSSFADE}`);
}

/** @param {unknown} value */
function isSeconds(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** @param {unknown} value */
function isVolume(value) {
	return typeof value === 'number' && value >= 0 && value <= 1;
}
