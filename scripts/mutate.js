// Checks that tests can fail (TESTING.md, "Checking the tests themselves"): breaks one piece of code on purpose, runs
// the given tests, and always puts the file back.
//
//   node scripts/mutate.js <file> <find> <replace> <test file or quoted glob>...
//
// <find> must occur exactly once in <file>. Exits 0 when the tests catch the change, 1 when they still pass, 2 on misuse.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const USAGE = 'Usage: node scripts/mutate.js <file> <find> <replace> <test file or quoted glob>...';

const [file, find, replace, ...tests] = process.argv.slice(2);
if (!file || find === undefined || replace === undefined || tests.length === 0) {
	fail(USAGE);
}
const path = resolve(file);
if (relative(ROOT, path).startsWith('..')) {
	fail(`Refusing to change a file outside the project: ${path}`);
}

const original = await readFile(path, 'utf8');
const occurrences = original.split(find).length - 1;
if (occurrences !== 1) {
	fail(`"${find}" occurs ${occurrences} times in ${file}; it must occur exactly once.`);
}

const restore = () => writeFile(path, original);
process.once('SIGINT', () => restore().finally(() => process.exit(130)));

let result;
try {
	await writeFile(path, original.replace(find, () => replace));
	result = spawnSync(process.execPath, ['--test', ...tests], { cwd: ROOT, encoding: 'utf8' });
} finally {
	await restore();
}

const output = `${result.stdout}${result.stderr}`;
const failing = [...output.matchAll(/^✖ (?!failing tests:)(.+?)(?: \([\d.]+ms\))?$/gmu)].map((match) => match[1]);
if (result.status === 0) {
	console.log(`SURVIVED: the tests still pass with this change to ${file}.`);
	process.exit(1);
}
console.log(`CAUGHT: ${[...new Set(failing)].join('; ') || output.trim().split('\n').slice(-5).join('\n')}`);

/** @param {string} message */
function fail(message) {
	console.error(message);
	process.exit(2);
}
