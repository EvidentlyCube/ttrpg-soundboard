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
