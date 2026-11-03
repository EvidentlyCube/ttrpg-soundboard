import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * @param {string} root the repository
 * @param {readonly string[]} paths
 * @returns {Promise<string[]>} the files git tracks under `paths`, sorted
 */
export async function trackedFiles(root, paths) {
	const { stdout } = await git(root, ['ls-files', '-z', '--', ...paths]);
	return stdout.split('\0').filter(Boolean).sort();
}

/**
 * @param {string} root
 * @param {readonly string[]} paths
 * @returns {Promise<string[]>} `git status` lines for uncommitted and untracked changes under `paths`
 */
export async function uncommittedChanges(root, paths) {
	const { stdout } = await git(root, ['status', '--porcelain', '--', ...paths]);
	return stdout.split('\n').filter(Boolean);
}

/**
 * @param {string} root
 * @returns {Promise<Date>} when the checked-out commit was made
 */
export async function commitDate(root) {
	const { stdout } = await git(root, ['log', '-1', '--format=%cI']);
	return new Date(stdout.trim());
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
	return run('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
}
