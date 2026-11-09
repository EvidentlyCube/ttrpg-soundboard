import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidCommandError } from '../../public/app/logic/errors.js';
import { LibraryModel } from '../../public/app/logic/library-model.js';
import { exampleLibrary, NO_BACKGROUND } from '../helpers/fake-backend-api.js';

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

	describe('updateTrack', () => {
		const fresh = () => new LibraryModel(exampleLibrary(), () => true);

		it('returns the playlist holding the renamed track, in the same track order', () => {
			const model = fresh();
			const { playlist, track } = model.updateTrack('Combat/2.ogg', { title: ' Final Boss ' });
			assert.equal(track.title, 'Final Boss');
			assert.deepEqual(playlist.tracks.map((entry) => entry.title), ['Battle', 'Final Boss']);
			assert.equal(model.playlist('Combat'), playlist);
			assert.equal(model.json.playlists.find((entry) => entry.id === 'Combat'), playlist);
		});

		it('changes the gain, and rejects one out of range', () => {
			const model = fresh();
			assert.equal(model.updateTrack('Combat/1.mp3', { gain: 0.5 }).track.gain, 0.5);
			const before = model.json;
			assert.throws(() => model.updateTrack('Combat/1.mp3', { gain: 4.1 }), InvalidCommandError);
			assert.throws(() => model.updateTrack('Combat/1.mp3', { gain: -0.1 }), InvalidCommandError);
			assert.equal(model.json, before);
		});

		it('changes the points rounded to milliseconds, and an end of null', () => {
			const model = fresh();
			const { track } = model.updateTrack('Combat/1.mp3', { startAt: 1.00049, endAt: 5 });
			assert.equal(track.startAt, 1);
			assert.equal(track.endAt, 5);
			assert.equal(track.title, 'Battle');
			assert.equal(model.updateTrack('Combat/1.mp3', { endAt: null }).track.endAt, null);
		});

		it('checks a changed point against the stored one, changing nothing when it does not fit', () => {
			const model = fresh();
			model.updateTrack('Combat/1.mp3', { startAt: 2, endAt: 4 });
			const before = model.json;
			assert.throws(() => model.updateTrack('Combat/1.mp3', { startAt: 4 }), InvalidCommandError);
			assert.throws(() => model.updateTrack('Combat/1.mp3', { endAt: 1 }), InvalidCommandError);
			assert.throws(() => model.updateTrack('Combat/1.mp3', { startAt: -1 }), InvalidCommandError);
			assert.equal(model.json, before);
		});

		it('leaves earlier snapshots untouched and rejects empty titles and unknown tracks', () => {
			const model = fresh();
			const before = model.json;
			model.updateTrack('Combat/1.mp3', { title: 'X' });
			assert.deepEqual(before, exampleLibrary());
			assert.throws(() => model.updateTrack('Combat/1.mp3', { title: '' }), new InvalidCommandError('A title cannot be empty'));
			assert.throws(() => model.updateTrack('Boom.mp3', { title: 'X' }), new InvalidCommandError('Unknown track "Boom.mp3"'));
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

		it('sets the fades, from 0 to 30 seconds', () => {
			const model = fresh();
			const playlist = model.updatePlaylist('Combat', { fadeIn: 1, fadeOut: 2 });
			assert.deepEqual([playlist.fadeIn, playlist.fadeOut], [1, 2]);
			assert.throws(() => model.updatePlaylist('Combat', { fadeOut: 31 }), new InvalidCommandError('Fade-out must be a number of seconds from 0 to 30, got 31'));
			assert.throws(() => model.updatePlaylist('Combat', { fadeIn: -1 }), new InvalidCommandError('Fade-in must be a number of seconds from 0 to 30, got -1'));
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

	describe('updateAllPlaylists and updateAllSounds', () => {
		const fresh = () => new LibraryModel(exampleLibrary(), () => true);

		it('gives every playlist the change and returns them, findable by id afterwards', () => {
			const model = fresh();
			const changed = model.updateAllPlaylists({ gain: 0.5, crossfade: 3, order: 'shuffle', trackLooping: true });
			assert.deepEqual(changed.map((playlist) => playlist.id), ['Combat', 'Tavern']);
			for (const playlist of changed) {
				assert.deepEqual([playlist.gain, playlist.crossfade, playlist.order, playlist.trackLooping], [0.5, 3, 'shuffle', true]);
				assert.equal(model.playlist(playlist.id), playlist);
			}
			assert.deepEqual(model.json.playlists, changed);
		});

		it('returns only the items that get a new value', () => {
			const model = fresh();
			model.updatePlaylist('Combat', { fadeIn: 2 });
			assert.deepEqual(model.updateAllPlaylists({ fadeIn: 2 }).map((playlist) => playlist.id), ['Tavern']);
			model.updateSound('Rain.ogg', { gain: 0.5 });
			assert.deepEqual(model.updateAllSounds({ gain: 0.5 }).map((sound) => sound.id), ['Boom.mp3']);
			assert.deepEqual(model.updateAllSounds({ gain: 0.5 }), []);
		});

		it('gives every sound the gain and fades', () => {
			const model = fresh();
			const changed = model.updateAllSounds({ gain: 2, fadeIn: 0.5, fadeOut: 1 });
			assert.deepEqual(changed.map((sound) => [sound.id, sound.gain, sound.fadeIn, sound.fadeOut]), [['Boom.mp3', 2, 0.5, 1], ['Rain.ogg', 2, 0.5, 1]]);
			assert.equal(model.sound('Rain.ogg'), changed[1]);
		});

		it('rejects an invalid change, changing nothing', () => {
			const model = fresh();
			assert.throws(() => model.updateAllPlaylists({ fadeIn: 31 }), new InvalidCommandError('Fade-in must be a number of seconds from 0 to 30, got 31'));
			assert.throws(() => model.updateAllPlaylists({ gain: 1, order: /** @type {any} */ ('backwards') }), /The order must be one of/);
			assert.throws(() => model.updateAllSounds({ gain: 5 }), new InvalidCommandError('Gain must be a number from 0 to 4, got 5'));
			assert.deepEqual(model.json, exampleLibrary());
		});
	});

	describe('additions from downloads', () => {
		const track = (/** @type {string} */ id, format = /** @type {'mp3' | 'ogg' | 'opus'} */ ('mp3')) => ({
			id, title: id, format, size: 1, gain: 1, duration: 1, startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0, url: `/media/${id}`, ...NO_BACKGROUND,
		});

		it('adds a sound in title order and checks whether it can play', () => {
			const model = new LibraryModel(exampleLibrary(), (format) => format === 'mp3');
			model.addSound({ ...track('Cave.ogg', 'ogg'), title: 'Cave' });
			assert.deepEqual(model.json.sounds.map((sound) => sound.title), ['Boom', 'Cave', 'Rain']);
			assert.equal(model.hasSound('Cave.ogg'), true);
			assert.equal(model.isPlayable(model.sound('Cave.ogg')), false);
		});

		it('adds a playlist in title order', () => {
			const model = new LibraryModel(exampleLibrary(), () => true);
			model.addPlaylist({ ...exampleLibrary().playlists[0], id: 'Dungeon', title: 'Dungeon', tracks: [track('Dungeon/1.mp3')] });
			assert.deepEqual(model.json.playlists.map((playlist) => playlist.id), ['Combat', 'Dungeon', 'Tavern']);
			assert.equal(model.hasPlaylist('Dungeon'), true);
		});

		it('takes only the new tracks from the server, in path order, keeping what is known here', () => {
			const model = new LibraryModel(exampleLibrary(), () => true);
			model.updatePlaylist('Combat', { title: 'Renamed here' });
			const fromServer = { ...exampleLibrary().playlists[0], tracks: [track('Combat/0.ogg'), ...exampleLibrary().playlists[0].tracks] };
			const playlist = model.addTracks(fromServer);
			assert.equal(playlist.title, 'Renamed here');
			assert.deepEqual(playlist.tracks.map((entry) => entry.id), ['Combat/0.ogg', 'Combat/1.mp3', 'Combat/2.ogg']);
			assert.equal(model.playlist('Combat'), playlist);
		});
	});
});
