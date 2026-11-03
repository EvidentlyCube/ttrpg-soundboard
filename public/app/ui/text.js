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
 * A message from the server or from the page's logic in the page's language: the text under `errors.<code>` when the
 * language files have one, else the English message it came with (DESIGN.md §9.21).
 * @param {{ message: string, code?: string | null, params?: Params | null }} coded
 */
export function describe({ message, code, params }) {
	const key = `errors.${code}`;
	return code && translator.has(key) ? translator.t(key, params ?? {}) : message;
}

/**
 * The text of an error caught on the page, translated when it carries a code (`ServerError`).
 * @param {unknown} error
 */
export function describeError(error) {
	if (error instanceof Error) {
		const { code, params } = /** @type {{ code?: unknown, params?: unknown }} */ (error);
		return describe({
			message: error.message,
			code: typeof code === 'string' ? code : null,
			params: typeof params === 'object' ? /** @type {Params} */ (params) : null,
		});
	}
	return String(error);
}

/**
 * The text under `key` as parts to append, with elements in place of some placeholders, for a sentence that holds a
 * bold name or a link: `tParts('banner.asks', { address: h('b', {}, address) })`.
 * @template {object} N an element; generic, since the Node tests type-check this file without the DOM
 * @param {MessageKey<EnglishMessages>} key
 * @param {Record<string, N>} nodes
 * @param {Params} [params]
 * @returns {(string | N)[]}
 */
export function tParts(key, nodes, params) {
	return translator.t(key, params)
		.split(/(\{\w+\})/)
		.filter((part) => part !== '')
		.map((part) => (/^\{\w+\}$/.test(part) ? nodes[part.slice(1, -1)] : undefined) ?? part);
}

/**
 * A number written the language's way: `6,123.5` in English, `6 123,5` in Polish.
 * @param {number} value
 * @param {Intl.NumberFormatOptions} [options]
 */
export function formatNumber(value, options) {
	return translator.number(value, options);
}

/**
 * A number with exactly `digits` decimals and the language's decimal sign, without thousands separators, since it is
 * also what fields show for editing: `1.500` in English, `1,500` in Polish.
 * @param {number} value
 * @param {number} digits
 */
export function formatFixed(value, digits) {
	return translator.number(value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

/** The language's BCP 47 tag, for `Intl` and the page's `lang`. */
export function locale() {
	return translator.locale;
}
