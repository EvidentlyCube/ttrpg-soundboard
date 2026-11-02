import { ToolMissingError } from './errors.js';

/** @typedef {import('./process-runner.js').ProcessRunner} ProcessRunner */

/**
 * What `yt-dlp -U` did at startup (DESIGN.md §5.4).
 * @typedef {object} YtDlpUpdate
 * @property {'current' | 'updated' | 'outdated' | 'failed'} state `outdated` means a newer version exists but the
 * 	update failed, usually because yt-dlp sits where only root may write
 * @property {string | null} current the version before the update, when yt-dlp said it
 * @property {string | null} latest
 * @property {string | null} error why the update or the check failed
 */

export const UPDATE_TIMEOUT_MS = 60_000;

/**
 * Runs `yt-dlp -U`, which updates yt-dlp when it can, and reports what happened. Never rejects.
 * @param {ProcessRunner} run
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [options.timers]
 * @returns {Promise<YtDlpUpdate>}
 */
export async function updateYtDlp(run, { timeoutMs = UPDATE_TIMEOUT_MS, timers = { setTimeout, clearTimeout } } = {}) {
	/** @type {string[]} */
	const lines = [];
	const running = run('yt-dlp', ['-U'], {
		onLine: (text, transient) => {
			if (!transient) {
				lines.push(text);
			}
		},
	});
	let timedOut = false;
	const timer = timers.setTimeout(() => {
		timedOut = true;
		running.kill();
	}, timeoutMs);
	try {
		await running.done;
	} catch (error) {
		if (!(error instanceof ToolMissingError)) {
			throw error;
		}
		return failed('yt-dlp is not installed.');
	} finally {
		timers.clearTimeout(timer);
	}
	if (timedOut) {
		return failed(`yt-dlp did not finish within ${timeoutMs / 1000} s.`);
	}
	return readUpdateOutput(lines);
}

/**
 * Reads what `yt-dlp -U` printed, such as:
 * ```
 * Current version: stable@2026.10.21 from yt-dlp/yt-dlp
 * Latest version: stable@2026.10.26 from yt-dlp/yt-dlp
 * …
 * ERROR: Insufficient permissions to write to /usr/bin
 * ```
 * @param {string[]} lines stdout and stderr together
 * @returns {YtDlpUpdate}
 */
export function readUpdateOutput(lines) {
	const current = versionAfter(lines, 'Current version:');
	const latest = versionAfter(lines, 'Latest version:');
	const error = lastError(lines);
	if (lines.some((line) => line.includes('is up to date'))) {
		return { state: 'current', current: current ?? latest, latest, error: null };
	}
	if (lines.some((line) => line.startsWith('Updated yt-dlp to'))) {
		return { state: 'updated', current, latest: latest ?? versionAfter(lines, 'Updated yt-dlp to'), error: null };
	}
	if (current !== null && latest !== null) {
		return { state: 'outdated', current, latest, error: error ?? 'yt-dlp did not say why.' };
	}
	return failed(error ?? lines.findLast((line) => line.trim() !== '')?.trim() ?? 'yt-dlp printed nothing.');
}

/**
 * The version in a line such as `Latest version: stable@2026.10.26 from yt-dlp/yt-dlp`, without its channel.
 * @param {string[]} lines
 * @param {string} prefix
 * @returns {string | null}
 */
function versionAfter(lines, prefix) {
	const line = lines.find((candidate) => candidate.startsWith(prefix));
	const label = line?.slice(prefix.length).trim().split(/\s+/)[0];
	return label ? label.slice(label.indexOf('@') + 1) : null;
}

/**
 * @param {string[]} lines
 * @returns {string | null} the last `ERROR:` line without its prefix
 */
function lastError(lines) {
	return lines.findLast((line) => line.startsWith('ERROR:'))?.slice('ERROR:'.length).trim() ?? null;
}

/**
 * @param {string} error
 * @returns {YtDlpUpdate}
 */
function failed(error) {
	return { state: 'failed', current: null, latest: null, error };
}
