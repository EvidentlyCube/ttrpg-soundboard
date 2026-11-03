import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { isPluralForms } from '../../public/app/logic/i18n.js';

/** @typedef {import('../../public/app/logic/i18n.js').Messages} Messages */
/** @typedef {import('../../public/app/logic/i18n.js').PluralForms} PluralForms */
/** @typedef {import('../../public/app/logic/i18n.js').Translation} Translation */

const FOLDER = new URL('../../public/app/i18n/', import.meta.url);

/**
 * Every text of a language, by its dotted key.
 * @param {Messages} messages
 * @param {string} [prefix]
 * @returns {Map<string, string | PluralForms>}
 */
function flatten(messages, prefix = '') {
	/** @type {Map<string, string | PluralForms>} */
	const texts = new Map();
	for (const [key, value] of Object.entries(messages)) {
		if (typeof value === 'string' || isPluralForms(value)) {
			texts.set(prefix + key, value);
		} else {
			for (const [inner, text] of flatten(value, `${prefix}${key}.`)) {
				texts.set(inner, text);
			}
		}
	}
	return texts;
}

/** @param {string | PluralForms} text */
function placeholdersOf(text) {
	const forms = typeof text === 'string' ? [text] : Object.values(text);
	return [...new Set(forms.flatMap((form) => [...(form ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1])))].sort();
}

/** @returns {Promise<[string, Translation][]>} */
async function languageFiles() {
	const names = (await readdir(FOLDER)).filter((name) => name.endsWith('.js'));
	return Promise.all(names.map(async (name) => [name, (await import(new URL(name, FOLDER).href)).translation]));
}

describe('the language files', () => {
	// A translation may leave a detail out, but a placeholder English doesn't fill would show as it is.
	it('have exactly English’s texts, each with no placeholder English lacks', async () => {
		const files = await languageFiles();
		const [, englishFile] = /** @type {[string, Translation]} */ (files.find(([name]) => name === 'en.js'));
		const english = flatten(englishFile.messages);
		assert.ok(english.size > 100);
		for (const [name, translation] of files) {
			const texts = flatten(translation.messages);
			assert.deepEqual([...texts.keys()].sort(), [...english.keys()].sort(), name);
			for (const [key, text] of english) {
				const known = placeholdersOf(text);
				const extra = placeholdersOf(/** @type {string | PluralForms} */ (texts.get(key))).filter((placeholder) => !known.includes(placeholder));
				assert.deepEqual(extra, [], `${name}: ${key}`);
				assert.equal(typeof texts.get(key), typeof text, `${name}: ${key} is a plural in one file only`);
			}
		}
	});

	it('give every plural form their language uses', async () => {
		for (const [name, translation] of await languageFiles()) {
			const categories = new Intl.PluralRules(translation.locale).resolvedOptions().pluralCategories;
			for (const [key, text] of flatten(translation.messages)) {
				if (typeof text !== 'string') {
					assert.deepEqual(Object.keys(text).sort(), [...categories].sort(), `${name}: ${key}`);
				}
			}
		}
	});

	it('name each language in itself, with a locale Intl knows', async () => {
		const names = Object.fromEntries((await languageFiles()).map(([file, translation]) => [file, translation.name]));
		assert.deepEqual(names, { 'en.js': 'English', 'pl.js': 'Polski' });
		for (const [, translation] of await languageFiles()) {
			assert.equal(Intl.NumberFormat.supportedLocalesOf([translation.locale]).length, 1);
		}
	});
});
