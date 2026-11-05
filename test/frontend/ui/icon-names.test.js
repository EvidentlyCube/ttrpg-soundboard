import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES } from '../../../public/app/ui/icon-names.js';

const SOLID = fileURLToPath(new URL('../../../public/vendor/fontawesome/svgs-full/solid/', import.meta.url));

describe('ICON_NAMES', () => {
	it('names only icons that have a solid file in the vendored Font Awesome', async () => {
		/** @type {string[]} */
		const missing = [];
		for (const name of ICON_NAMES) {
			await access(`${SOLID}${name}.svg`).catch(() => missing.push(name));
		}
		assert.deepEqual(missing, []);
	});
});
