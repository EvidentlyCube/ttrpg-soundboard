/**
 * Shape checks for the JSON files the app reads. Each validator returns every problem it finds, or an empty list.
 * Unknown keys are always allowed, so files written by future versions still load.
 */

/** @typedef {{ size: number, modified: string, sha1: string }} MeasuredFrom what a stored duration was measured from */
/** @typedef {{ title?: string, gain?: number, duration?: number | null, measuredFrom?: MeasuredFrom }} AudioOptions */
/** @typedef {{ title?: string, gain?: number, includedSubdirectories?: string[] }} PlaylistOptions */
/** @typedef {{ master: number, music: number, sfx: number }} Volumes */
/** @typedef {{ version: number, volumes?: Partial<Volumes> }} SettingsFile */

export const SETTINGS_VERSION = 1;

/** @type {readonly (keyof Volumes)[]} */
export const VOLUME_BUSES = ['master', 'music', 'sfx'];

/** The loudest boost a sound, track or playlist may have: just over +12 dB. */
export const MAX_GAIN = 4;

const NOT_AN_OBJECT = 'must be a JSON object';

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateAudioOptions(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	return [...checkTitle(value), ...checkGain(value), ...checkDuration(value)];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validatePlaylistOptions(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	const problems = [...checkTitle(value), ...checkGain(value)];
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

/** @param {unknown} value */
function isVolume(value) {
	return typeof value === 'number' && value >= 0 && value <= 1;
}
