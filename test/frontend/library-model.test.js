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
});
