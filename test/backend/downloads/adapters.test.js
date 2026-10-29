import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { UnusableLinkError } from '../../../src/downloads/errors.js';
import { Ffmpeg } from '../../../src/downloads/ffmpeg.js';
import { parseLink } from '../../../src/downloads/probe.js';
import { runProcess } from '../../../src/downloads/process-runner.js';
import { findTools } from '../../../src/downloads/tools.js';
import { commandLine, YtDlp } from '../../../src/downloads/yt-dlp.js';
import { readDuration } from '../../../src/metadata/index.js';
import { fakeProcessRunner, untilKilled } from '../../helpers/fake-process-runner.js';
import { copyFixture } from '../../helpers/tmp-tree.js';

const LINK = parseLink('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1');
const noOutput = { onLine: () => {}, onCommand: () => {} };

describe('YtDlp', () => {
	it('looks a link up with the link after "--", as a video unless asked for the playlist', async () => {
		const { run, calls } = fakeProcessRunner(() => ({ stdout: JSON.stringify({ _type: 'video', id: 'v', title: 'T' }) }));
		const ytDlp = new YtDlp(run);
		const probe = await ytDlp.probe(LINK, { playlist: false });
		assert.equal(probe.kind, 'video');
		await ytDlp.probe(LINK, { playlist: true });
		assert.deepEqual(calls.map((call) => call.args.slice(-3)), [['--no-playlist', '--', LINK.href], ['--yes-playlist', '--', LINK.href]]);
		assert.ok(calls.every((call) => call.command === 'yt-dlp' && call.options.captureStdout));
	});

	it('turns a failed lookup into the error yt-dlp gave', async () => {
		const { run } = fakeProcessRunner((_command, _args, process) => {
			process.line('ERROR: [youtube] v: Video unavailable');
			return { code: 1 };
		});
		await assert.rejects(new YtDlp(run).probe(LINK, { playlist: false }), (error) => error instanceof UnusableLinkError && error.message === '[youtube] v: Video unavailable');
	});

	it('downloads into the given directory with its default name, passing the output on', async () => {
		/** @type {string[]} */
		const lines = [];
		/** @type {string[]} */
		const commands = [];
		const { run, calls } = fakeProcessRunner((_command, _args, process) => {
			process.line('[download]  50.0% of 1.00MiB', true);
			return { code: 0 };
		});
		await new YtDlp(run).download('https://x/watch?v=1', '/tmp/job/0', {
			signal: new AbortController().signal,
			onLine: (text) => lines.push(text),
			onCommand: (line) => commands.push(line),
		});
		assert.deepEqual(calls[0].args, ['-f', 'bestaudio/best', '--no-playlist', '--newline', '--no-mtime', '-P', '/tmp/job/0', '-o', '%(title)s [%(id)s].%(ext)s', '--', 'https://x/watch?v=1']);
		assert.deepEqual(lines, ['[download]  50.0% of 1.00MiB']);
		assert.match(commands[0], /^\$ yt-dlp -f bestaudio\/best/);
	});

	it('kills the download when cancelled', async () => {
		const { run, calls } = fakeProcessRunner((_command, _args, process) => untilKilled(process.killed));
		const controller = new AbortController();
		const download = new YtDlp(run).download('https://x/1', '/tmp/d', { signal: controller.signal, ...noOutput });
		controller.abort();
		await assert.rejects(download);
		assert.equal(calls[0].killed, true);
	});
});

describe('Ffmpeg', () => {
	it('encodes the first audio stream to Ogg Vorbis, cutting a chapter when asked', async () => {
		const { run, calls } = fakeProcessRunner(() => ({ code: 0 }));
		const ffmpeg = new Ffmpeg(run);
		await ffmpeg.convert('in.webm', 'out.ogg', { clip: null, signal: new AbortController().signal, ...noOutput });
		await ffmpeg.convert('in.webm', 'cut.ogg', { clip: { start: 5, end: 17.25 }, signal: new AbortController().signal, ...noOutput });
		assert.deepEqual(calls[0].args, ['-hide_banner', '-nostdin', '-y', '-i', 'in.webm', '-map', '0:a:0', '-c:a', 'libvorbis', '-q:a', '5', 'out.ogg']);
		assert.deepEqual(calls[1].args, ['-hide_banner', '-nostdin', '-y', '-ss', '5.000', '-i', 'in.webm', '-t', '12.250', '-map', '0:a:0', '-c:a', 'libvorbis', '-q:a', '5', 'cut.ogg']);
	});

	it('copies the first audio stream without encoding it', async () => {
		const { run, calls } = fakeProcessRunner(() => ({ code: 0 }));
		await new Ffmpeg(run).remux('in.webm', 'out.opus', { signal: new AbortController().signal, ...noOutput });
		assert.deepEqual(calls[0].args, ['-hide_banner', '-nostdin', '-y', '-i', 'in.webm', '-map', '0:a:0', '-c:a', 'copy', 'out.opus']);
	});

	it('fails with ffmpeg\'s last line', async () => {
		const { run } = fakeProcessRunner((_command, _args, process) => {
			process.line('in.webm: No such file or directory');
			return { code: 1 };
		});
		await assert.rejects(new Ffmpeg(run).convert('in.webm', 'out.ogg', { clip: null, signal: new AbortController().signal, ...noOutput }), /No such file/);
	});

	it('really cuts and encodes a file with the installed ffmpeg', async (context) => {
		if ((await findTools(runProcess)).ffmpeg === null) {
			context.skip('ffmpeg is not installed');
			return;
		}
		const tree = await copyFixture('example_soundboard');
		try {
			const output = join(tree.root, 'cut.ogg');
			await new Ffmpeg(runProcess).convert(join(tree.root, 'Sound MP3 no title tag.mp3'), output, {
				clip: { start: 1, end: 3 },
				signal: new AbortController().signal,
				...noOutput,
			});
			assert.ok((await stat(output)).size > 0);
			const duration = await readDuration(output);
			assert.ok(duration !== null && Math.abs(duration - 2) < 0.1, `duration ${duration}`);
		} finally {
			await tree.remove();
		}
	});
});

describe('commandLine', () => {
	it('quotes arguments the way a shell would need them', () => {
		assert.equal(commandLine('yt-dlp', ['-o', '%(title)s [%(id)s].%(ext)s', '--', 'https://x/?a=1&b=it\'s']), '$ yt-dlp -o \'%(title)s [%(id)s].%(ext)s\' -- \'https://x/?a=1&b=it\'\\\'\'s\'');
	});
});
