import { chooseLanguage } from './logic/i18n.js';
import { t, useTranslation } from './ui/text.js';

/** @typedef {import('./ui/text.js').LanguageFile} LanguageFile */

/**
 * Loads the page's language (DESIGN.md §9.21) before anything is drawn, then fills the static HTML's
 * `data-i18n="key"` elements. Anything that fails leaves the page in English, which is never worse than not starting.
 * @returns {Promise<string>} the language's code
 */
export async function loadLanguage() {
	let code;
	try {
		const response = await fetch('/api/language', { cache: 'no-store' });
		const { language, available } = /** @type {{ language: string | null, available: string[] }} */ (await response.json());
		code = chooseLanguage(language, available, navigator.languages);
		if (code !== 'en') {
			const { translation } = /** @type {{ translation: LanguageFile }} */ (await import(`./i18n/${code}.js`));
			useTranslation(translation);
		}
	} catch (error) {
		console.warn('Could not load the language, so the page is in English', error);
		code = 'en';
	}
	document.documentElement.lang = code;
	for (const element of document.querySelectorAll('[data-i18n]')) {
		element.textContent = t(/** @type {any} */ (element.getAttribute('data-i18n')));
	}
	return code;
}
