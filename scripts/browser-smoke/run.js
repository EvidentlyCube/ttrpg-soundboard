// Runs the browser smoke scripts one after another, or only those whose name contains an argument.
// Needs Chromium (`chromium-browser` on PATH). Not part of `npm run check` (TESTING.md).
// The scripts report in their output, as `"check name": "FAIL …"` lines or a `crashed` entry, and always exit 0,
// so this counts those lines.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const NOT_SCRIPTS = new Set(['harness.js', 'run.js']);
const filter = process.argv[2] ?? '';

const scripts = readdirSync(HERE)
	.filter((name) => name.endsWith('.js') && !NOT_SCRIPTS.has(name) && name.includes(filter))
	.sort();

let failures = 0;
for (const name of scripts) {
	console.log(`\n=== ${name}`);
	const { stdout, status } = spawnSync(process.execPath, [`${HERE}${name}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	process.stdout.write(stdout);
	const failed = stdout.split('\n').filter((line) => /": "FAIL|"crashed"/.test(line));
	failures += failed.length + (status === 0 ? 0 : 1);
	console.log(`--> ${name}: ${failed.length} failed checks${status === 0 ? '' : `, exit code ${status}`}`);
}

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
