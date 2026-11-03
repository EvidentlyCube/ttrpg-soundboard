import { Component } from './component.js';
import { h, on } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The header's yellow button that appears when files changed outside the app (DESIGN.md §9.1).
 * Clicking it has the server rebuild its library; the page then reloads, which App takes care of.
 */
export class ExternalChangesButton extends Component {
	#soundboard;
	#onFailed;

	/**
	 * @param {Soundboard} soundboard
	 * @param {(problems: { path: string, message: string }[]) => void} onFailed shows why a refresh failed
	 */
	constructor(soundboard, onFailed) {
		super();
		this.#soundboard = soundboard;
		this.#onFailed = onFailed;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const button = h('button', {
			'type': 'button',
			'class': 'cursor-pointer rounded-md bg-notice px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-surface hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-notice disabled:cursor-wait disabled:opacity-70',
			'title': t('refresh.tooltip'),
			'data-external-changes': true,
		}, t('refresh.button'));
		button.hidden = !soundboard.hasExternalChanges();

		const idle = () => {
			button.disabled = false;
			button.textContent = t('refresh.button');
		};
		this.own(soundboard.on('library.externalChanges', ({ pending }) => {
			button.hidden = !pending;
		}));
		this.own(soundboard.on('library.refreshing', () => {
			button.disabled = true;
			button.textContent = t('refresh.refreshing');
		}));
		this.own(soundboard.on('library.refreshFailed', ({ message, errors, restartNeeded }) => {
			idle();
			// A missing settings file blocks the whole page instead (App).
			if (!restartNeeded) {
				this.#onFailed(errors.length > 0 ? errors : [{ path: '', message }]);
			}
		}));
		this.own(on(button, 'click', () => soundboard.refreshLibrary()));
		return button;
	}
}
