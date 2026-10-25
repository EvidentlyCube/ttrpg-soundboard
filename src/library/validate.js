/**
 * Shape checks for the JSON files the app reads. Each validator returns every problem it finds, or an empty list.
 * Unknown keys are always allowed, so files written by future versions still load.
 */

/** @typedef {{ title?: string }} AudioOptions */
/** @typedef {{ title?: string, includedSubdirectories?: string[] }} PlaylistOptions */
/** @typedef {{ master: number, music: number, sfx: number }} Volumes */
/** @typedef {{ version: number, volumes?: Partial<Volumes> }} SettingsFile */

export const SETTINGS_VERSION = 1;

/** @type {readonly (keyof Volumes)[]} */
export const VOLUME_BUSES = ['master', 'music', 'sfx'];

const NOT_AN_OBJECT = 'must be a JSON object';

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validateAudioOptions(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	return checkTitle(value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function validatePlaylistOptions(value) {
	if (!isPlainObject(value)) {
		return [NOT_AN_OBJECT];
	}
	const problems = checkTitle(value);
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

/** @param {unknown} value */
function isVolume(value) {
	return typeof value === 'number' && value >= 0 && value <= 1;
}
