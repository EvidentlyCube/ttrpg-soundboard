import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeUpdate, readUpdateOutput, updateProblem, updateYtDlp } from '../../../src/downloads/yt-dlp-update.js';
import { fakeProcessRunner, untilKilled } from '../../helpers/fake-process-runner.js';

const OUTDATED = [
	'Current version: stable@2026.10.21 from yt-dlp/yt-dlp',
	'Latest version: stable@2026.10.26 from yt-dlp/yt-dlp',
	'Current Build Hash: b7af77f686e95f7845ce8d09d21957718febb8b48b30555adb9dd2292ad7bf14',
	'Updating to stable@2026.10.26 from yt-dlp/yt-dlp ...',
	'ERROR: Insufficient permissions to write to /usr/bin',
];

describe('updateYtDlp', () => {
	it('runs yt-dlp -U and reads every line it prints, progress left out', async () => {
		const { run, calls } = fakeProcessRunner((command, args, process) => {
			process.line('[download]  50%', true);
			for (const line of OUTDATED) {
				process.line(line);
			}
			return { code: 1 };
		});
		assert.deepEqual(await updateYtDlp(run), {
			state: 'outdated',
			current: '2026.10.21',
			latest: '2026.10.26',
			error: 'Insufficient permissions to write to /usr/bin',
		});
		assert.deepEqual(calls.map(({ command, args }) => [command, args]), [['yt-dlp', ['-U']]]);
	});

	it('kills yt-dlp and fails when it takes too long', async () => {
		/** @type {(() => void)[]} */
		const pending = [];
		const timers = {
			setTimeout: /** @type {typeof setTimeout} */ (/** @type {unknown} */ ((/** @type {() => void} */ callback) => pending.push(callback))),
			clearTimeout: () => {},
		};
		const { run, calls } = fakeProcessRunner((command, args, process) => {
			queueMicrotask(() => pending.forEach((callback) => callback()));
			return untilKilled(process.killed);
		});
		const update = await updateYtDlp(run, { timeoutMs: 60_000, timers });
		assert.equal(calls[0].killed, true);
		assert.deepEqual(update, { state: 'failed', current: null, latest: null, error: 'yt-dlp did not finish within 60 s.' });
	});

	it('fails, without rejecting, when yt-dlp is missing', async () => {
		const { run } = fakeProcessRunner(() => 'missing');
		assert.equal((await updateYtDlp(run)).state, 'failed');
	});
});

describe('readUpdateOutput', () => {
	it('reads an up-to-date yt-dlp', () => {
		assert.deepEqual(readUpdateOutput([
			'Latest version: stable@2026.10.26 from yt-dlp/yt-dlp',
			'yt-dlp is up to date (stable@2026.10.26 from yt-dlp/yt-dlp)',
		]), { state: 'current', current: '2026.10.26', latest: '2026.10.26', error: null });
	});

	it('reads a successful update', () => {
		assert.deepEqual(readUpdateOutput([
			...OUTDATED.slice(0, 4),
			'Updated yt-dlp to stable@2026.10.26 from yt-dlp/yt-dlp',
		]), { state: 'updated', current: '2026.10.21', latest: '2026.10.26', error: null });
	});

	it('keeps the version of a nightly build, without its channel', () => {
		const update = readUpdateOutput([
			'Current version: nightly@2026.10.21.232853 from yt-dlp/yt-dlp-nightly-builds',
			'Latest version: nightly@2026.10.30.010203 from yt-dlp/yt-dlp-nightly-builds',
			'ERROR: You installed yt-dlp with pip or using the wheel from PyPi; Use that to update',
		]);
		assert.equal(update.current, '2026.10.21.232853');
		assert.equal(update.latest, '2026.10.30.010203');
		assert.equal(update.state, 'outdated');
	});

	it('fails with the last error when the versions are unknown, as when offline', () => {
		assert.deepEqual(readUpdateOutput([
			'ERROR: Unable to obtain version info (<urlopen error [Errno -3] Temporary failure in name resolution>); Please try again later',
		]), {
			state: 'failed',
			current: null,
			latest: null,
			error: 'Unable to obtain version info (<urlopen error [Errno -3] Temporary failure in name resolution>); Please try again later',
		});
		assert.equal(readUpdateOutput([]).error, 'yt-dlp printed nothing.');
	});
});

describe('describeUpdate and updateProblem', () => {
	const outdated = readUpdateOutput(OUTDATED);

	it('describes each outcome, warning about failures', () => {
		assert.deepEqual(describeUpdate(readUpdateOutput(['yt-dlp is up to date (stable@2026.10.26 from yt-dlp/yt-dlp)'])), {
			text: 'yt-dlp is up to date.',
			warning: false,
		});
		assert.deepEqual(describeUpdate({ state: 'updated', current: '1', latest: '2', error: null }), { text: 'yt-dlp updated to 2.', warning: false });
		assert.deepEqual(describeUpdate(outdated), {
			text: 'yt-dlp 2026.10.26 is available (installed: 2026.10.21), but the update failed: Insufficient permissions to write to /usr/bin',
			warning: true,
		});
		assert.deepEqual(describeUpdate({ state: 'failed', current: null, latest: null, error: 'offline' }), {
			text: 'Could not check for a yt-dlp update: offline',
			warning: true,
		});
	});

	it('makes a warning of a failed update only', () => {
		assert.deepEqual(updateProblem(outdated), {
			id: 'ytdlp-outdated:yt-dlp',
			kind: 'ytdlp-outdated',
			severity: 'warning',
			path: 'yt-dlp',
			message: 'yt-dlp 2026.10.26 is available (installed: 2026.10.21), but the update failed: Insufficient permissions to write to /usr/bin',
			code: 'problem.ytdlp-outdated',
			params: { latest: '2026.10.26', current: '2026.10.21', error: 'Insufficient permissions to write to /usr/bin' },
		});
		assert.equal(updateProblem({ state: 'failed', current: null, latest: null, error: 'offline' }), null);
		assert.equal(updateProblem({ state: 'current', current: '1', latest: '1', error: null }), null);
	});
});
