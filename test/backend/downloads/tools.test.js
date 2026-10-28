import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeTools, findTools, missingTools } from '../../../src/downloads/tools.js';
import { fakeProcessRunner } from '../../helpers/fake-process-runner.js';

describe('findTools', () => {
	it('reads the version of each program', async () => {
		const { run, calls } = fakeProcessRunner((command) => ({
			stdout: command === 'yt-dlp' ? '2026.08.19\n' : 'ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\nbuilt with gcc\n',
		}));
		assert.deepEqual(await findTools(run), { ytDlp: '2026.08.19', ffmpeg: '7.1.1' });
		assert.deepEqual(calls.map(({ command, args }) => [command, args]), [['yt-dlp', ['--version']], ['ffmpeg', ['-version']]]);
	});

	it('reports a program that is not installed, or that fails, as missing', async () => {
		const { run } = fakeProcessRunner((command) => (command === 'yt-dlp' ? 'missing' : { code: 1 }));
		assert.deepEqual(await findTools(run), { ytDlp: null, ffmpeg: null });
	});
});

describe('describeTools', () => {
	it('names the versions found, or the programs missing', () => {
		assert.equal(describeTools({ ytDlp: '2026.08.19', ffmpeg: '7.1' }), 'Downloads: yt-dlp 2026.08.19, ffmpeg 7.1');
		assert.equal(describeTools({ ytDlp: null, ffmpeg: '7.1' }), 'Downloads are off: yt-dlp was not found.');
		assert.equal(describeTools({ ytDlp: null, ffmpeg: null }), 'Downloads are off: yt-dlp and ffmpeg were not found.');
		assert.deepEqual(missingTools({ ytDlp: '1', ffmpeg: null }), ['ffmpeg']);
	});
});
