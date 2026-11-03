import { MAX_NAME_LENGTH } from '../logic/soundboard.js';
import { Component } from './component.js';
import { card } from './customize-parts.js';
import { h } from './dom.js';
import { filledField } from './filled-field.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The body of the Options dialog (DESIGN.md §9.20): the soundboard's name, saved as it is typed. Left empty, the folder's
 * name shows instead.
 */
export class OptionsDialog extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const { name, folderName } = this.#soundboard.nameSettings();
		const { element: field, input } = filledField({
			label: t('options.name'),
			align: 'left',
			width: 'w-full',
			attributes: { 'value': name ?? '', 'maxlength': MAX_NAME_LENGTH, 'data-options-name': true },
		});
		input.addEventListener('input', () => this.#soundboard.setName(input.value));
		const hint = h('p', { class: 'text-xs text-muted' }, t('options.nameHint', { folder: folderName }));
		return h('div', { 'class': 'w-full min-w-96 pt-3', 'data-options': true },
			card(t('options.soundboard'), 'neutral', h('div', { class: 'space-y-1.5' }, field, hint)));
	}
}
