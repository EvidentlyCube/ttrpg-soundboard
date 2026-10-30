import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

const ASSIGNMENT_OPERATORS = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '??=', '||=', '&&='];

export default [
	{
		ignores: ['node_modules/', 'test_fixtures/', 'public/vendor/'],
	},
	js.configs.recommended,
	stylistic.configs.customize({
		indent: 'tab',
		quotes: 'single',
		semi: true,
		commaDangle: 'always-multiline',
		braceStyle: '1tbs',
		arrowParens: true,
		jsx: false,
	}),
	{
		rules: {
			'@stylistic/operator-linebreak': [
				'error',
				'before',
				{ overrides: Object.fromEntries(ASSIGNMENT_OPERATORS.map((operator) => [operator, 'after'])) },
			],
			// Single quotes, but never a backslash to get one in: double quotes if the text has a single quote, backticks if
			// it has both.
			'@stylistic/quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: 'avoidEscape' }],
			'no-restricted-syntax': [
				'error',
				{
					// An odd number of backslashes before the quote; an even number is escaped backslashes (`"'\\''"`).
					selector: `Literal[raw=/(^|[^\\\\])(\\\\\\\\)*\\\\['"]/]`,
					message: 'Avoid escaping a quote: use double quotes for text with a single quote, and backticks for text with both.',
				},
			],
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['*.js', 'src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
		languageOptions: { globals: globals.node },
	},
	{
		// Specs and the audio driver pass functions to the page, where this global exists (support/globals.d.ts).
		files: ['test/browser/**/*.js'],
		languageOptions: { globals: { soundboardTest: 'readonly' } },
	},
	{
		files: ['public/app/**/*.js'],
		ignores: ['public/app/logic/**'],
		languageOptions: { globals: globals.browser },
	},
	{
		// Runs in the page under test, not in Node (test/browser/support/test-main.js).
		files: ['test/browser/support/test-main.js'],
		languageOptions: { globals: globals.browser },
	},
	{
		// Logic must stay runnable in Node tests and future remote clients, so it gets no environment globals at all.
		files: ['public/app/logic/**/*.js'],
		rules: {
			'no-restricted-globals': [
				'error',
				...['window', 'document', 'navigator', 'Audio', 'AudioContext', 'fetch', 'setTimeout', 'setInterval', 'process', 'Buffer']
					.map((name) => ({ name, message: 'Logic must not use environment globals; inject a port instead.' })),
			],
		},
	},
];
