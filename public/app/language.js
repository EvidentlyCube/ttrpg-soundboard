import { chooseLanguage } from './logic/i18n.js';
import { t, useTranslation } from './ui/text.js';

/** @typedef {import('./ui/text.js').LanguageFile} LanguageFile */

/**
 * Loads the page's language (DESIGN.md §9.21) before anything is drawn, then fills the static HTML's
 * `data-i18n="key"` elements. Anything that fails leaves the page in English, which is never worse than not starting.
 * @returns {Promise<{ code: string, setting: string | null, available: string[] }>} the language shown, the one the app
 * 	is set to (null: the browser's), and the codes of the language files
 */
export async function loadLanguage() {
	let code;
	let setting = null;
	let available = ['en'];
	try {
		const response = await fetch('/api/language', { cache: 'no-store' });
		({ language: setting, available } = /** @type {{ language: string | null, available: string[] }} */ (await response.json()));
		code = chooseLanguage(setting, available, navigator.languages);
		if (code !== 'en') {
			useTranslation(await importLanguage(code));
		}
	} catch (error) {
		console.warn('Could not load the language, so the page is in English', error);
		code = 'en';
	}
	document.documentElement.lang = code;
	for (const element of document.querySelectorAll('[data-i18n]')) {
		element.textContent = t(/** @type {any} */ (element.getAttribute('data-i18n')));
	}
	return { code, setting, available };
}

/**
 * @param {string} code
 * @returns {Promise<LanguageFile>}
 */
export async function importLanguage(code) {
	return /** @type {{ translation: LanguageFile }} */ (await import(`./i18n/${code}.js`)).translation;
}
