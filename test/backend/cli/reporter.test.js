import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createColors } from '../../../src/cli/colors.js';
import { ConsoleReporter } from '../../../src/cli/reporter.js';
import { ValidationError } from '../../../src/library/errors.js';

function createReporter() {
	let text = '';
	const reporter = new ConsoleReporter({ write: (chunk) => (text += chunk, true) }, createColors(false), '/music');
	return { reporter, output: () => text };
}

describe('ConsoleReporter', () => {
	it('lists validation errors relative to the root, one problem per line', () => {
		const { reporter, output } = createReporter();
		reporter.validationErrors([
			new ValidationError('/music/Combat.json', ['"title" must be a non-empty string', '"includedSubdirectories" must be an array of strings']),
			new ValidationError('/music/a.mp3.json', ['invalid JSON: Unexpected end of JSON input']),
		]);
		assert.equal(output(), [
			'Found 2 invalid files. Fix or delete them, then start again:',
			'  Combat.json: "title" must be a non-empty string',
			'  Combat.json: "includedSubdirectories" must be an array of strings',
			'  a.mp3.json: invalid JSON: Unexpected end of JSON input',
			'',
		].join('\n'));
	});

	it('describes each kind of warning', () => {
		const { reporter, output } = createReporter();
		reporter.warnings([
			{ kind: 'unsupported-audio', path: 'Song.wav' },
			{ kind: 'orphan-options', path: 'notes.json' },
			{ kind: 'symlink', path: 'Link.mp3' },
			{ kind: 'empty-playlist', path: 'Artwork' },
		]);
		assert.equal(output(), [
			'Warnings:',
			'  Unsupported audio format, skipped: Song.wav',
			'  Options file that belongs to nothing, ignored: notes.json',
			'  Symlink, ignored: Link.mp3',
			'  Playlist without playable tracks, hidden: Artwork',
			'',
		].join('\n'));
	});

	it('shows at most 10 nested directories', () => {
		const { reporter, output } = createReporter();
		reporter.nestedDirectories(Array.from({ length: 12 }, (_, i) => `Combat/Dir ${i + 1}`));
		const lines = output().split('\n');
		assert.equal(lines[0], 'Found 12 nested directories inside playlists:');
		assert.deepEqual(lines.slice(1, 11), Array.from({ length: 10 }, (_, i) => `  Combat/Dir ${i + 1}`));
		assert.equal(lines[11], '  …and 2 more');
	});

	it('uses the singular for one item', () => {
		const { reporter, output } = createReporter();
		reporter.nestedDirectories(['Combat/Boss']);
		reporter.optionsGenerated(1);
		assert.equal(output(), 'Found 1 nested directory inside playlists:\n  Combat/Boss\nCreated or updated 1 options file.\n');
	});

	it('says how many durations are about to be measured', () => {
		const { reporter, output } = createReporter();
		reporter.measuringDurations(1);
		reporter.measuringDurations(12);
		assert.equal(output(), 'Measuring the duration of 1 audio file…\nMeasuring the duration of 12 audio files…\n');
	});

	it('lists found metadata titles', () => {
		const { reporter, output } = createReporter();
		reporter.metadataTitles([{ path: 'Combat/1.mp3', title: 'Battle' }]);
		assert.equal(output(), 'Found titles in 1 file:\n  Combat/1.mp3 → "Battle"\n');
	});

	it('summarizes the loaded library', () => {
		const { reporter, output } = createReporter();
		reporter.libraryLoaded({ root: '/music', playlists: [], sounds: [], files: new Map() });
		assert.equal(output(), 'Loaded 0 playlists and 0 sounds.\n');
	});
});
