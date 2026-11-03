/**
 * @typedef {{ zero?: string, one?: string, two?: string, few?: string, many?: string, other: string }} PluralForms
 * the wordings of a message that depends on `count`, keyed by `Intl.PluralRules` category
 */
/** @typedef {{ readonly [key: string]: string | PluralForms | Messages }} Messages */
/** @typedef {{ locale: string, name: string, messages: Messages }} Translation */
/** @typedef {Readonly<Record<string, string | number>>} Params */

/**
 * Looks up the texts of one language file (DESIGN.md §9.21), falling back to English for a text the language lacks.
 * Placeholders are written `{name}`; a number filling one is formatted for the language.
 */
export class Translator {
	#translation;
	#fallback;
	/** @type {Map<string, Intl.PluralRules>} */
	#pluralRules = new Map();
	/** @type {Map<string, Intl.NumberFormat>} */
	#numberFormats = new Map();

	/**
	 * @param {Translation} translation
	 * @param {Translation} fallback English, which has every text
	 */
	constructor(translation, fallback) {
		this.#translation = translation;
		this.#fallback = fallback;
	}

	/** The BCP 47 tag the language formats numbers with, such as `pl-PL`. */
	get locale() {
		return this.#translation.locale;
	}

	/**
	 * @param {string} key dotted path into `messages`, such as `trash.restoreAll`
	 * @param {Params} [params] fills the placeholders; `count` also picks the plural form
	 */
	t(key, params = {}) {
		const own = lookUp(this.#translation.messages, key);
		const found = own ?? lookUp(this.#fallback.messages, key);
		if (found === null) {
			return key;
		}
		const text = typeof found === 'string'
			? found
			: this.#pluralForm(found, Number(params.count), own ? this.#translation.locale : this.#fallback.locale);
		return text.replace(/\{(\w+)\}/g, (placeholder, name) => {
			const value = params[name];
			return value === undefined ? placeholder : typeof value === 'number' ? this.number(value) : value;
		});
	}

	/**
	 * @param {number} value
	 * @param {Intl.NumberFormatOptions} [options]
	 */
	number(value, options = {}) {
		const cacheKey = JSON.stringify(options);
		let format = this.#numberFormats.get(cacheKey);
		if (!format) {
			format = new Intl.NumberFormat(this.#translation.locale, options);
			this.#numberFormats.set(cacheKey, format);
		}
		return format.format(value);
	}

	/**
	 * @param {PluralForms} forms
	 * @param {number} count
	 * @param {string} locale the plural rules are the language's that wrote the forms
	 */
	#pluralForm(forms, count, locale) {
		let rules = this.#pluralRules.get(locale);
		if (!rules) {
			rules = new Intl.PluralRules(locale);
			this.#pluralRules.set(locale, rules);
		}
		return forms[rules.select(count)] ?? forms.other;
	}
}

/**
 * The language a page shows (DESIGN.md §9.21): the one the app is set to, or else the first of the browser's languages
 * that has a file, matched by its main part (`pl-PL` → `pl`), or else English.
 * @param {string | null} setting
 * @param {readonly string[]} available the codes of the language files
 * @param {readonly string[]} preferred the browser's languages, most wanted first
 */
export function chooseLanguage(setting, available, preferred) {
	if (setting !== null && available.includes(setting)) {
		return setting;
	}
	for (const tag of preferred) {
		const exact = available.find((code) => code.toLowerCase() === tag.toLowerCase());
		const main = available.find((code) => code.toLowerCase() === tag.split('-')[0].toLowerCase());
		if (exact ?? main) {
			return /** @type {string} */ (exact ?? main);
		}
	}
	return 'en';
}

/**
 * @param {Messages} messages
 * @param {string} key
 * @returns {string | PluralForms | null}
 */
function lookUp(messages, key) {
	/** @type {string | PluralForms | Messages | undefined} */
	let node = messages;
	for (const part of key.split('.')) {
		if (typeof node !== 'object' || isPluralForms(node)) {
			return null;
		}
		node = /** @type {Messages} */ (node)[part];
	}
	if (typeof node === 'string') {
		return node;
	}
	return node !== undefined && isPluralForms(node) ? node : null;
}

/**
 * A group of messages never has a key named `other`, so that key marks a set of plural forms.
 * @param {PluralForms | Messages} node
 * @returns {node is PluralForms}
 */
export function isPluralForms(node) {
	return typeof node.other === 'string';
}
