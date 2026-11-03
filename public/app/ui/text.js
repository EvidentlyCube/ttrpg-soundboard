import { translation as english } from '../i18n/en.js';
import { Translator } from '../logic/i18n.js';

/** @typedef {import('../logic/i18n.js').Params} Params */
/** @typedef {import('../logic/i18n.js').PluralForms} PluralForms */
/** @typedef {typeof english.messages} EnglishMessages */

/**
 * The dotted keys of a group of messages: `trash.restoreAll` for `{ trash: { restoreAll: '…' } }`.
 * @template T
 * @typedef {{ [K in keyof T & string]: T[K] extends string | PluralForms ? K : `${K}.${MessageKey<T[K]>}` }[keyof T & string]} MessageKey
 */

/**
 * English's messages with every text widened to any string and every set of plural forms to any language's forms, so
 * another language file must have exactly English's keys.
 * @template T
 * @typedef {T extends string ? string : T extends PluralForms ? PluralForms : { readonly [K in keyof T]: Shaped<T[K]> }} Shaped
 */

/** @typedef {{ locale: string, name: string, messages: Shaped<EnglishMessages> }} LanguageFile what `i18n/<code>.js` exports as `translation` */

let translator = new Translator(english, english);

/**
 * Makes every later text come from this language. Called once, before the page draws anything (DESIGN.md §9.21).
 * @param {LanguageFile} translation
 */
export function useTranslation(translation) {
	translator = new Translator(translation, english);
}

/**
 * The text under `key` in the page's language.
 * @param {MessageKey<EnglishMessages>} key
 * @param {Params} [params]
 */
export function t(key, params) {
	return translator.t(key, params);
}

/**
 * A number written the language's way: `6,123.5` in English, `6 123,5` in Polish.
 * @param {number} value
 * @param {Intl.NumberFormatOptions} [options]
 */
export function formatNumber(value, options) {
	return translator.number(value, options);
}

/** The language's BCP 47 tag, for `Intl` and the page's `lang`. */
export function locale() {
	return translator.locale;
}
