import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	SETTINGS_VERSION,
	validateAudioOptions,
	validatePlaylistOptions,
	validateSettingsFile,
	validateVolumes,
} from '../../../src/library/validate.js';

describe('validateAudioOptions', () => {
	it('accepts a title and unknown keys', () => {
		assert.deepEqual(validateAudioOptions({ title: 'Boom', volume: 0.5 }), []);
	});

	it('accepts a missing title', () => {
		assert.deepEqual(validateAudioOptions({}), []);
	});

	it('rejects values that are not objects', () => {
		for (const value of [null, [], 'text', 3]) {
			assert.deepEqual(validateAudioOptions(value), ['must be a JSON object']);
		}
	});

	it('accepts a gain from 0 to 4', () => {
		for (const gain of [0, 0.0316, 1, 3.98, 4]) {
			assert.deepEqual(validateAudioOptions({ gain }), [], `gain ${gain}`);
		}
	});

	it('rejects a gain out of range or not a number', () => {
		for (const gain of [-0.01, 4.0001, '1', null, true]) {
			assert.deepEqual(validateAudioOptions({ gain }), ['"gain" must be a number from 0 to 4'], `gain ${gain}`);
		}
	});

	it('accepts a measured duration, or null for one that could not be read', () => {
		const measuredFrom = { size: 1000, modified: '2026-10-24T16:41:00.000Z', sha1: 'a'.repeat(40) };
		assert.deepEqual(validateAudioOptions({ duration: 213.47, measuredFrom }), []);
		assert.deepEqual(validateAudioOptions({ duration: null, measuredFrom }), []);
		assert.deepEqual(validateAudioOptions({ duration: 0, measuredFrom }), []);
	});

	it('rejects a malformed duration or measuredFrom', () => {
		const measuredFrom = { size: 1000, modified: '2026-10-24T16:41:00.000Z', sha1: 'a'.repeat(40) };
		assert.deepEqual(validateAudioOptions({ duration: -1, measuredFrom }), ['"duration" must be a non-negative number or null']);
		assert.deepEqual(validateAudioOptions({ duration: '3', measuredFrom }), ['"duration" must be a non-negative number or null']);
		for (const bad of [null, [], { ...measuredFrom, size: -1 }, { ...measuredFrom, size: 1.5 }, { ...measuredFrom, modified: 5 }, { ...measuredFrom, sha1: 'xyz' }]) {
			assert.deepEqual(validateAudioOptions({ duration: 1, measuredFrom: bad }), [
				'"measuredFrom" must be an object with "size", "modified" and a 40-character hex "sha1"',
			], JSON.stringify(bad));
		}
	});

	it('requires duration and measuredFrom together', () => {
		const measuredFrom = { size: 1000, modified: '2026-10-24T16:41:00.000Z', sha1: 'a'.repeat(40) };
		assert.deepEqual(validateAudioOptions({ duration: 1 }), ['"duration" and "measuredFrom" must be present together']);
		assert.deepEqual(validateAudioOptions({ measuredFrom }), ['"duration" and "measuredFrom" must be present together']);
	});

	it('reports a bad title and a bad gain together', () => {
		assert.deepEqual(validateAudioOptions({ title: '', gain: 9 }), [
			'"title" must be a non-empty string',
			'"gain" must be a number from 0 to 4',
		]);
	});

	it('rejects an empty or non-string title', () => {
		assert.deepEqual(validateAudioOptions({ title: '' }), ['"title" must be a non-empty string']);
		assert.deepEqual(validateAudioOptions({ title: '   ' }), ['"title" must be a non-empty string']);
		assert.deepEqual(validateAudioOptions({ title: 5 }), ['"title" must be a non-empty string']);
	});

	it('accepts start and end points, with a null end meaning the end of the file', () => {
		assert.deepEqual(validateAudioOptions({ startAt: 0, endAt: null }), []);
		assert.deepEqual(validateAudioOptions({ startAt: 1.25, endAt: 3.5 }), []);
		assert.deepEqual(validateAudioOptions({ startAt: 120 }), []);
		assert.deepEqual(validateAudioOptions({ endAt: 0.01 }), []);
	});

	it('rejects malformed start and end points', () => {
		for (const startAt of [-0.001, '1', null, Number.POSITIVE_INFINITY]) {
			assert.deepEqual(validateAudioOptions({ startAt }), ['"startAt" must be a non-negative number of seconds'], String(startAt));
		}
		for (const endAt of [-1, '2', false, Number.NaN]) {
			assert.deepEqual(validateAudioOptions({ endAt }), ['"endAt" must be a non-negative number of seconds or null'], String(endAt));
		}
	});

	it('requires the end point at least 10 ms after the start point', () => {
		const tooClose = ['"endAt" must be at least 0.01 seconds after "startAt"'];
		assert.deepEqual(validateAudioOptions({ startAt: 2, endAt: 1 }), tooClose);
		assert.deepEqual(validateAudioOptions({ startAt: 2, endAt: 2.009 }), tooClose);
		assert.deepEqual(validateAudioOptions({ endAt: 0.005 }), tooClose);
		// 1001 − 991 comes out a hair under 10 when computed from these in floating point, but it is 10 ms.
		assert.deepEqual(validateAudioOptions({ startAt: 0.991, endAt: 1.001 }), []);
	});

	it('accepts a fade-in and fade-out from 0 to 30 seconds and rejects others', () => {
		assert.deepEqual(validateAudioOptions({ fadeIn: 0.5, fadeOut: 30 }), []);
		assert.deepEqual(validateAudioOptions({ fadeIn: 31, fadeOut: null }), [
			'"fadeIn" must be a number of seconds from 0 to 30',
			'"fadeOut" must be a number of seconds from 0 to 30',
		]);
	});
});

describe('validatePlaylistOptions', () => {
	it('accepts a title and subdirectory list', () => {
		assert.deepEqual(validatePlaylistOptions({ title: 'Combat', includedSubdirectories: ['Boss', 'Boss/Phase 2'] }), []);
	});

	it('reports every problem at once', () => {
		assert.deepEqual(validatePlaylistOptions({ title: 1, includedSubdirectories: ['ok', 2] }), [
			'"title" must be a non-empty string',
			'"includedSubdirectories" must be an array of strings',
		]);
	});

	it('accepts a gain from 0 to 4 and rejects others', () => {
		assert.deepEqual(validatePlaylistOptions({ gain: 0 }), []);
		assert.deepEqual(validatePlaylistOptions({ gain: 4 }), []);
		assert.deepEqual(validatePlaylistOptions({ gain: 4.5 }), ['"gain" must be a number from 0 to 4']);
		assert.deepEqual(validatePlaylistOptions({ gain: '1' }), ['"gain" must be a number from 0 to 4']);
	});

	it('accepts a fade-in and fade-out from 0 to 30 seconds and rejects others', () => {
		assert.deepEqual(validatePlaylistOptions({ fadeIn: 0, fadeOut: 30 }), []);
		assert.deepEqual(validatePlaylistOptions({ fadeIn: -1, fadeOut: '2' }), [
			'"fadeIn" must be a number of seconds from 0 to 30',
			'"fadeOut" must be a number of seconds from 0 to 30',
		]);
	});

	it('accepts the three playback orders and rejects anything else', () => {
		for (const order of ['ordered', 'random', 'shuffle']) {
			assert.deepEqual(validatePlaylistOptions({ order }), [], order);
		}
		for (const order of ['sequential', 'Random', '', 1, null]) {
			assert.deepEqual(validatePlaylistOptions({ order }), ['"order" must be "ordered", "random" or "shuffle"'], String(order));
		}
	});

	it('accepts track looping as true or false and rejects anything else', () => {
		assert.deepEqual(validatePlaylistOptions({ trackLooping: true }), []);
		assert.deepEqual(validatePlaylistOptions({ trackLooping: false }), []);
		for (const trackLooping of ['true', 1, null]) {
			assert.deepEqual(validatePlaylistOptions({ trackLooping }), ['"trackLooping" must be true or false'], String(trackLooping));
		}
	});

	it('accepts a crossfade from 0 to 30 seconds and rejects others', () => {
		for (const crossfade of [0, 2.5, 30]) {
			assert.deepEqual(validatePlaylistOptions({ crossfade }), [], String(crossfade));
		}
		for (const crossfade of [-1, 30.5, '2', null]) {
			assert.deepEqual(validatePlaylistOptions({ crossfade }), ['"crossfade" must be a number of seconds from 0 to 30'], String(crossfade));
		}
	});

	it('rejects a subdirectory list that is not an array', () => {
		assert.deepEqual(validatePlaylistOptions({ includedSubdirectories: 'Boss' }), ['"includedSubdirectories" must be an array of strings']);
	});
});

describe('validateVolumes', () => {
	it('accepts any subset of buses in range', () => {
		assert.deepEqual(validateVolumes({}), []);
		assert.deepEqual(validateVolumes({ master: 0, music: 0.5, sfx: 1 }), []);
	});

	it('rejects values out of range or not numbers', () => {
		assert.deepEqual(validateVolumes({ master: 1.5, music: -0.1, sfx: '1' }), [
			'"master" must be a number from 0 to 1',
			'"music" must be a number from 0 to 1',
			'"sfx" must be a number from 0 to 1',
		]);
		assert.deepEqual(validateVolumes({ master: Number.NaN }), ['"master" must be a number from 0 to 1']);
	});

	it('rejects values that are not objects', () => {
		assert.deepEqual(validateVolumes([]), ['must be a JSON object']);
	});
});

describe('validateSettingsFile', () => {
	it('accepts the current version with or without volumes', () => {
		assert.deepEqual(validateSettingsFile({ version: SETTINGS_VERSION }), []);
		assert.deepEqual(validateSettingsFile({ version: SETTINGS_VERSION, volumes: { music: 0.3 }, other: true }), []);
	});

	it('requires a positive integer version', () => {
		assert.deepEqual(validateSettingsFile({}), ['"version" must be a positive integer']);
		assert.deepEqual(validateSettingsFile({ version: '1' }), ['"version" must be a positive integer']);
		assert.deepEqual(validateSettingsFile({ version: 0 }), ['"version" must be a positive integer']);
	});

	it('rejects a version newer than this app supports', () => {
		assert.deepEqual(validateSettingsFile({ version: SETTINGS_VERSION + 1 }), [
			`was created by a newer version of the app (version ${SETTINGS_VERSION + 1}, this app supports up to ${SETTINGS_VERSION})`,
		]);
	});

	it('prefixes volume problems with their key', () => {
		assert.deepEqual(validateSettingsFile({ version: 1, volumes: { sfx: 2 } }), ['"volumes.sfx" must be a number from 0 to 1']);
		assert.deepEqual(validateSettingsFile({ version: 1, volumes: 'loud' }), ['"volumes" must be a JSON object']);
	});
});
