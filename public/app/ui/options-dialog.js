import { MAX_NAME_LENGTH } from '../logic/soundboard.js';
import { BatchOptions } from './batch-options.js';
import { Component } from './component.js';
import { card, tabs } from './customize-parts.js';
import { h } from './dom.js';
import { filledField } from './filled-field.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/**
 * The body of the Options dialog (DESIGN.md §9.20). The General tab holds the soundboard's name, saved as it is typed;
 * left empty, the folder's name shows instead. The Batch tab changes every playlist or sound at once.
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
		const general = h('div', { class: 'pt-7' },
			card(t('options.soundboard'), 'neutral', h('div', { class: 'space-y-1.5' }, field, hint)));

		const batch = new BatchOptions(this.#soundboard);
		const batchPanel = h('div', { class: 'pt-4' });
		batch.mount(batchPanel);
		this.own(() => batch.destroy());

		const { bar, panels } = tabs([
			{ id: 'options-general', label: t('options.generalTab'), panel: general },
			{ id: 'options-batch', label: t('options.batchTab'), panel: batchPanel },
		]);
		return h('div', { 'class': 'w-full min-w-96', 'data-options': true }, bar, ...panels);
	}
}
