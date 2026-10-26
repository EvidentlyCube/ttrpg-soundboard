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
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['*.js', 'src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
		languageOptions: { globals: globals.node },
	},
	{
		files: ['public/app/**/*.js'],
		ignores: ['public/app/logic/**'],
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
