import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translation as english } from '../../../public/app/i18n/en.js';
import { translation as polish } from '../../../public/app/i18n/pl.js';
import { ServerError } from '../../../public/app/logic/errors.js';
import { describe as describeMessage, describeError, formatFixed, locale, t, tParts, useTranslation } from '../../../public/app/ui/text.js';
import { formatDb, parseDb } from '../../../public/app/ui/gain-scale.js';
import { formatSeconds, parseSeconds } from '../../../public/app/ui/seconds-scale.js';
import * as folderRules from '../../../src/startup/folder-rules.js';

afterEach(() => useTranslation(english));

describe('the page’s texts', () => {
	it('are English until a language is used', () => {
		assert.equal(locale(), 'en-US');
		assert.equal(t('problems.count', { count: 2 }), '2 problems');
		useTranslation(polish);
		assert.equal(locale(), 'pl-PL');
		assert.equal(t('problems.count', { count: 2 }), '2 problemy');
	});

	it('put elements in place of placeholders', () => {
		const address = { element: 'address' };
		assert.deepEqual(tParts('access.asks', { address }), ['A device asks to connect: ', address]);
	});

	it('write numbers with the language’s decimal sign, which the fields read back', () => {
		assert.equal(formatFixed(1.5, 3), '1.500');
		useTranslation(polish);
		assert.equal(formatFixed(1.5, 3), '1,500');
		assert.equal(formatDb(0.5), '−6,0 dB');
		assert.ok(Math.abs(/** @type {number} */ (parseDb('−6,0')) - 0.5) < 0.01);
		assert.equal(formatSeconds(2.5), '2,500 s');
		assert.equal(formatSeconds(0), 'Wył.');
		assert.equal(parseSeconds('wył.'), 0);
		assert.equal(parseSeconds('off'), 0);
	});
});

describe('describe', () => {
	it('translates a message by its code, and shows any other as it came', () => {
		useTranslation(polish);
		assert.equal(describeMessage({ message: 'No audio files found here.', code: 'folder.noAudio' }), polish.messages.errors.folder.noAudio);
		assert.equal(describeMessage({ message: 'disk full', code: null }), 'disk full');
		assert.equal(describeMessage({ message: 'odd', code: 'not.a.code' }), 'odd');
		assert.equal(
			describeError(new ServerError('Unknown sound "a"', 'item.unknownSound', { id: 'a' })),
			polish.messages.errors.item.unknownSound.replace('{id}', 'a'),
		);
		assert.equal(describeError(new Error('plain')), 'plain');
		assert.equal(describeError('text'), 'text');
	});

	it('knows a text for every folder reason the server gives', () => {
		const reasons = Object.entries(folderRules).filter(([name]) => name.endsWith('_REASON')).map(([, reason]) => /** @type {string} */ (reason));
		assert.ok(reasons.length >= 10);
		for (const reason of reasons) {
			const code = folderRules.reasonCodeOf(reason);
			assert.ok(code, reason);
			assert.equal(describeMessage({ message: 'untranslated', code }), reason);
		}
	});

	it('knows a text for every kind of problem', () => {
		for (const kind of Object.keys(english.messages.problems.kind)) {
			assert.notEqual(t(`problems.kind.${/** @type {'symlink'} */ (kind)}`), `problems.kind.${kind}`);
		}
		for (const kind of ['unsupported-audio', 'orphan-options', 'symlink', 'empty-playlist', 'unknown-duration', 'ytdlp-outdated']) {
			assert.notEqual(describeMessage({ message: 'untranslated', code: `problem.${kind}` }), 'untranslated', kind);
		}
	});
});
