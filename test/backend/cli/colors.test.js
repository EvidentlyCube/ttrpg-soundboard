import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createColors, shouldUseColor } from '../../../src/cli/colors.js';

describe('shouldUseColor', () => {
	it('uses color only on a terminal', () => {
		assert.equal(shouldUseColor({ isTTY: true }, {}), true);
		assert.equal(shouldUseColor({ isTTY: false }, {}), false);
		assert.equal(shouldUseColor({}, {}), false);
	});

	it('respects a non-empty NO_COLOR', () => {
		assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: '1' }), false);
		assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: '' }), true);
	});
});

describe('createColors', () => {
	it('wraps text in ANSI codes when enabled', () => {
		const colors = createColors(true);
		assert.equal(colors.red('x'), '\x1b[31mx\x1b[39m');
		assert.equal(colors.yellow('x'), '\x1b[33mx\x1b[39m');
		assert.equal(colors.bold('x'), '\x1b[1mx\x1b[22m');
	});

	it('returns text unchanged when disabled', () => {
		const colors = createColors(false);
		assert.equal(colors.red('x'), 'x');
		assert.equal(colors.yellow('x'), 'x');
		assert.equal(colors.bold('x'), 'x');
	});
});
