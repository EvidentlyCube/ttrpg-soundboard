import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError } from '../../public/app/logic/errors.js';
import { dbToGain, gainToDb, sliderToGain, VolumeControl } from '../../public/app/logic/volume.js';

describe('gainToDb and dbToGain', () => {
	it('treat gain 1 as 0 dB', () => {
		assert.equal(gainToDb(1), 0);
		assert.equal(dbToGain(0), 1);
	});

	it('convert amplitude gain, where 2× is about +6 dB', () => {
		assert.ok(Math.abs(gainToDb(2) - 6.0206) < 1e-4);
		assert.ok(Math.abs(gainToDb(0.5) + 6.0206) < 1e-4);
		assert.ok(Math.abs(dbToGain(12) - 3.9811) < 1e-4);
		assert.ok(Math.abs(dbToGain(-20) - 0.1) < 1e-12);
	});

	it('treat silence as minus infinity', () => {
		assert.equal(gainToDb(0), -Infinity);
		assert.equal(dbToGain(-Infinity), 0);
	});

	it('round-trip', () => {
		for (const gain of [0.001, 0.25, 1, 3.5]) {
			assert.ok(Math.abs(dbToGain(gainToDb(gain)) - gain) < 1e-12, String(gain));
		}
	});
});

describe('sliderToGain', () => {
	it('squares the slider position', () => {
		assert.equal(sliderToGain(0), 0);
		assert.equal(sliderToGain(0.5), 0.25);
		assert.equal(sliderToGain(1), 1);
	});
});

describe('VolumeControl', () => {
	function create() {
		/** @type {[string, number][]} */
		const gains = [];
		/** @type {unknown[]} */
		const events = [];
		const control = new VolumeControl({
			setBusGain: (bus, gain) => gains.push([bus, gain]),
			emit: (event) => events.push(event),
		});
		return { control, gains, events };
	}

	it('starts at full volume', () => {
		assert.deepEqual(create().control.volumes, { master: 1, music: 1, sfx: 1 });
	});

	it('applies the gain and announces the change', () => {
		const { control, gains, events } = create();
		control.setVolume('music', 0.5);
		assert.deepEqual(gains, [['music', 0.25]]);
		assert.deepEqual(events, [{ type: 'volume.changed', bus: 'music', value: 0.5 }]);
		assert.equal(control.volumes.music, 0.5);
	});

	it('clamps values into range', () => {
		const { control } = create();
		control.setVolume('sfx', 1.7);
		control.setVolume('master', -1);
		assert.deepEqual(control.volumes, { master: 0, music: 1, sfx: 1 });
	});

	it('rejects unknown buses and non-numbers', () => {
		const { control } = create();
		assert.throws(() => control.setVolume(/** @type {any} */ ('voice'), 0.5), InvalidCommandError);
		assert.throws(() => control.setVolume('music', Number.NaN), InvalidCommandError);
		assert.throws(() => control.setVolume('music', /** @type {any} */ ('1')), InvalidCommandError);
	});

	it('applies a full set of volumes at once', () => {
		const { control, gains } = create();
		control.applyAll({ master: 0.5, music: 1, sfx: 0 });
		assert.deepEqual(gains, [['master', 0.25], ['music', 1], ['sfx', 0]]);
		assert.deepEqual(control.volumes, { master: 0.5, music: 1, sfx: 0 });
	});
});
