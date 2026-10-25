import { main } from './src/cli/main.js';

process.exitCode = await main(process.argv.slice(2), {
	input: process.stdin,
	output: process.stdout,
	errorOutput: process.stderr,
	env: process.env,
});
