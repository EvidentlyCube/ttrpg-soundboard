import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './specs',
	testMatch: '*.spec.js',
	fullyParallel: true,
	// Traces and screenshots of failures never go into the repository.
	outputDir: join(tmpdir(), 'soundboard-playwright'),
	reporter: 'list',
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
	],
});
