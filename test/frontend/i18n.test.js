import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chooseLanguage, Translator } from '../../public/app/logic/i18n.js';

/** @typedef {import('../../public/app/logic/i18n.js').Translation} Translation */

/** @type {Translation} */
const english = {
	locale: 'en-US',
	name: 'English',
	messages: {
		greeting: 'Hello, {name}',
		tracks: { one: '{count} track', other: '{count} tracks' },
		only: { english: 'Only here' },
		size: '{size} in total',
	},
};

/** @type {Translation} */
const polish = {
	locale: 'pl-PL',
	name: 'Polski',
	messages: {
		greeting: 'Cześć, {name}',
		tracks: { one: '{count} utwór', few: '{count} utwory', many: '{count} utworów', other: '{count} utworu' },
		only: {},
		size: 'Razem {size}',
	},
};

describe('Translator', () => {
	it('fills placeholders and leaves unknown ones as they are', () => {
		const translator = new Translator(english, english);
		assert.equal(translator.t('greeting', { name: 'Ana' }), 'Hello, Ana');
		assert.equal(translator.t('greeting'), 'Hello, {name}');
	});

	it('picks the plural form by the language’s rules', () => {
		const translator = new Translator(polish, english);
		assert.deepEqual([1, 3, 5, 22, 25].map((count) => translator.t('tracks', { count })), ['1 utwór', '3 utwory', '5 utworów', '22 utwory', '25 utworów']);
		assert.equal(new Translator(english, english).t('tracks', { count: 1 }), '1 track');
		assert.equal(new Translator(english, english).t('tracks', { count: 2 }), '2 tracks');
	});

	it('falls back to English for a text the language lacks, with English plural rules', () => {
		const translator = new Translator(polish, english);
		assert.equal(translator.t('only.english'), 'Only here');
		assert.equal(translator.t('missing.key'), 'missing.key');
	});

	it('writes numbers the language’s way, in placeholders too', () => {
		const translator = new Translator(polish, english);
		assert.equal(translator.number(1.5, { minimumFractionDigits: 1 }), '1,5');
		assert.equal(translator.t('size', { size: 61234 }), 'Razem 61 234');
		assert.equal(new Translator(english, english).t('size', { size: 61234 }), '61,234 in total');
	});

	it('knows which keys name a text, in the language or in English', () => {
		const translator = new Translator(polish, english);
		assert.equal(translator.has('greeting'), true);
		assert.equal(translator.has('only.english'), true);
		assert.equal(translator.has('only'), false);
		assert.equal(translator.has('nothing'), false);
	});
});

describe('chooseLanguage', () => {
	it('takes the app’s setting when its file exists', () => {
		assert.equal(chooseLanguage('pl', ['en', 'pl'], ['en-US']), 'pl');
		assert.equal(chooseLanguage('de', ['en', 'pl'], ['en-US']), 'en');
	});

	it('otherwise takes the first of the browser’s languages that has a file, by its main part', () => {
		assert.equal(chooseLanguage(null, ['en', 'pl'], ['de-DE', 'pl-PL', 'en']), 'pl');
		assert.equal(chooseLanguage(null, ['en', 'pt-BR'], ['pt-BR']), 'pt-BR');
		assert.equal(chooseLanguage(null, ['en', 'pl'], ['fr']), 'en');
	});
});
