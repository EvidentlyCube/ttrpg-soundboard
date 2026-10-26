import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError } from '../../public/app/logic/errors.js';
import { LibraryModel } from '../../public/app/logic/library-model.js';
import { exampleLibrary } from '../helpers/fake-backend-api.js';

describe('LibraryModel', () => {
	const library = new LibraryModel(exampleLibrary(), (format) => format === 'mp3');

	it('finds playlists and sounds by id', () => {
		assert.equal(library.playlist('Tavern').title, 'Tavern');
		assert.equal(library.sound('Boom.mp3').title, 'Boom');
	});

	it('rejects unknown ids', () => {
		assert.throws(() => library.playlist('Nope'), new InvalidCommandError('Unknown playlist "Nope"'));
		assert.throws(() => library.sound('Nope'), new InvalidCommandError('Unknown sound "Nope"'));
	});

	it('lists every sound and track this browser cannot play', () => {
		assert.deepEqual(library.unplayable, ['Combat/2.ogg', 'Rain.ogg']);
		assert.equal(library.isPlayable(library.sound('Boom.mp3')), true);
		assert.equal(library.isPlayable(library.sound('Rain.ogg')), false);
	});

	it('exposes the original JSON', () => {
		assert.deepEqual(library.json, exampleLibrary());
	});

	describe('updateSound', () => {
		const fresh = () => new LibraryModel(exampleLibrary(), () => true);

		it('returns the changed sound, with the title trimmed, and finds it by id afterwards', () => {
			const model = fresh();
			const sound = model.updateSound('Boom.mp3', { title: '  Big Boom ', gain: 2 });
			assert.deepEqual(sound, { ...exampleLibrary().sounds[0], title: 'Big Boom', gain: 2 });
			assert.equal(model.sound('Boom.mp3'), sound);
		});

		it('keeps the sounds in the JSON sorted by title', () => {
			const model = fresh();
			model.updateSound('Boom.mp3', { title: 'Zap' });
			assert.deepEqual(model.json.sounds.map((sound) => sound.title), ['Rain', 'Zap']);
		});

		it('leaves earlier snapshots of the JSON untouched', () => {
			const model = fresh();
			const before = model.json;
			model.updateSound('Boom.mp3', { title: 'Zap', gain: 0.5 });
			assert.deepEqual(before, exampleLibrary());
		});

		it('changes only what is given', () => {
			const model = fresh();
			assert.deepEqual(model.updateSound('Boom.mp3', { gain: 0.5 }), { ...exampleLibrary().sounds[0], gain: 0.5 });
		});

		it('rejects an empty title, a gain out of range, and unknown sounds, changing nothing', () => {
			const model = fresh();
			assert.throws(() => model.updateSound('Boom.mp3', { title: '  ' }), new InvalidCommandError('A title cannot be empty'));
			for (const gain of [-0.1, 4.1, Number.NaN, Infinity]) {
				assert.throws(() => model.updateSound('Boom.mp3', { gain }), new InvalidCommandError(`Gain must be a number from 0 to 4, got ${gain}`));
			}
			assert.throws(() => model.updateSound('Nope', { gain: 1 }), new InvalidCommandError('Unknown sound "Nope"'));
			assert.deepEqual(model.json, exampleLibrary());
		});
	});

	describe('updatePlaylist', () => {
		const fresh = () => new LibraryModel(exampleLibrary(), () => true);

		it('returns the changed playlist, with its tracks, and finds it by id afterwards', () => {
			const model = fresh();
			const playlist = model.updatePlaylist('Combat', { title: ' Fight ', gain: 0.5 });
			assert.deepEqual(playlist, { ...exampleLibrary().playlists[0], title: 'Fight', gain: 0.5 });
			assert.equal(model.playlist('Combat'), playlist);
		});

		it('keeps the playlists in the JSON sorted by title, without touching earlier snapshots', () => {
			const model = fresh();
			const before = model.json;
			model.updatePlaylist('Combat', { title: 'Zulu' });
			assert.deepEqual(model.json.playlists.map((playlist) => playlist.title), ['Tavern', 'Zulu']);
			assert.deepEqual(before, exampleLibrary());
		});

		it('sets the crossfade, from 0 to 30 seconds', () => {
			const model = fresh();
			assert.equal(model.updatePlaylist('Combat', { crossfade: 4 }).crossfade, 4);
			for (const crossfade of [-1, 31, Number.NaN]) {
				assert.throws(() => model.updatePlaylist('Combat', { crossfade }), new InvalidCommandError(`Crossfade must be a number of seconds from 0 to 30, got ${crossfade}`));
			}
		});

		it('rejects an empty title, a gain out of range, and unknown playlists', () => {
			const model = fresh();
			assert.throws(() => model.updatePlaylist('Combat', { title: '' }), new InvalidCommandError('A title cannot be empty'));
			assert.throws(() => model.updatePlaylist('Combat', { gain: 5 }), new InvalidCommandError('Gain must be a number from 0 to 4, got 5'));
			assert.throws(() => model.updatePlaylist('Nope', { gain: 1 }), new InvalidCommandError('Unknown playlist "Nope"'));
			assert.deepEqual(model.json, exampleLibrary());
		});
	});
});
