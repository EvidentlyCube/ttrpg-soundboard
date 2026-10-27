import { h } from './dom.js';
import { filledField } from './filled-field.js';
import { icon } from './icons.js';

/** @typedef {import('./dom.js').Child} Child */

/**
 * Pieces shared by the Customize dialogs (DESIGN.md §9.7). Each returns its element plus the functions that update it;
 * the dialog wires them to the soundboard.
 */

/** Card colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const CARD_ACCENTS = {
	music: 'group-hover:bg-music group-focus-within:bg-music',
	sfx: 'group-hover:bg-sfx group-focus-within:bg-sfx',
};

/**
 * A raised section with its title as a pill on the top border. It is dimmed, and the pill drawn in the border's color,
 * until the section is pointed at or something in it has focus; then it lights up and the pill takes the accent color,
 * so it is clear which part of the dialog is being worked with.
 * @param {string} title
 * @param {keyof typeof CARD_ACCENTS} accent
 * @param {...Child} children
 */
export function card(title, accent, ...children) {
	return h('section', {
		class: 'group relative rounded-xl border border-line-dim bg-raised-dim px-4 pt-6 pb-4 shadow-md shadow-black/30 transition-colors '
			+ 'hover:border-line hover:bg-raised focus-within:border-line focus-within:bg-raised',
	},
	h('h3', {
		class: 'absolute -top-3 left-4 rounded-full bg-line-dim px-3 py-0.5 text-xs font-semibold uppercase tracking-widest text-muted transition-colors '
			+ `group-hover:text-surface group-focus-within:text-surface ${CARD_ACCENTS[accent]}`,
	}, title),
	...children);
}

/** Radio colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const RADIO_ACCENTS = { music: 'accent-music', sfx: 'accent-sfx' };

/**
 * Radio buttons for one setting, each with its name and a short description below it. Choosing one reports it at once.
 * @template {string} V
 * @param {object} options
 * @param {string} options.name groups the buttons; unique within the dialog
 * @param {{ value: V, label: string, description: string }[]} options.choices
 * @param {V} options.value
 * @param {keyof typeof RADIO_ACCENTS} options.accent
 * @param {(value: V) => void} options.onChange
 * @returns {{ element: HTMLElement, update: (value: V) => void }}
 */
export function radioGroup({ name, choices, value, accent, onChange }) {
	const inputs = choices.map((choice) => h('input', {
		'type': 'radio',
		'name': name,
		'value': choice.value,
		'checked': choice.value === value,
		'data-radio-value': choice.value,
		'class': `mt-1 size-4 shrink-0 cursor-pointer ${RADIO_ACCENTS[accent]}`,
		'onChange': () => onChange(choice.value),
	}));
	const element = h('div', { 'class': 'space-y-3', 'role': 'radiogroup', 'data-radio-group': name },
		choices.map((choice, index) => h('label', { class: 'flex cursor-pointer items-start gap-3' },
			inputs[index],
			h('span', { class: 'space-y-0.5' },
				h('span', { class: 'block text-sm font-medium' }, choice.label),
				h('span', { class: 'block text-xs text-muted' }, choice.description)))));
	/** @param {V} newValue */
	const update = (newValue) => {
		inputs.forEach((input, index) => {
			input.checked = choices[index].value === newValue;
		});
	};
	return { element, update };
}

/**
 * One of several settings in a card: a label on the left, the control on the right.
 * @param {string} label
 * @param {Child} control
 */
export function labeledRow(label, control) {
	return h('div', { class: 'flex items-center gap-3' }, h('span', { class: 'w-20 shrink-0 text-sm text-muted' }, label), control);
}

/**
 * A title field that only reports non-empty titles. While it is empty it is marked invalid and the hint explains that
 * the last title is kept.
 * @param {object} options
 * @param {string} options.value
 * @param {string} options.hint shown below the field, such as the file name
 * @param {'music' | 'sfx'} [options.accent]
 * @param {(title: string) => void} options.onTitle
 */
export function titleField({ value, hint, accent = 'music', onTitle }) {
	const hintText = h('p', { class: 'text-xs text-muted wrap-anywhere' }, hint);
	const { element: field, input } = filledField({
		label: 'Title',
		accent,
		align: 'left',
		width: 'w-full',
		attributes: { 'value': value, 'aria-invalid': 'false', 'data-invalid': 'false', 'data-item-title': true },
	});
	input.addEventListener('input', () => {
		const empty = input.value.trim() === '';
		input.setAttribute('aria-invalid', String(empty));
		input.dataset.invalid = String(empty);
		hintText.textContent = empty ? 'A title cannot be empty; the last one is kept.' : hint;
		if (!empty) {
			onTitle(input.value);
		}
	});
	return { element: h('div', { class: 'space-y-1.5' }, field, hintText), input };
}

/**
 * A Play / Stop button that shows whether the item is playing.
 * @param {() => void} onClick
 */
export function playToggle(onClick) {
	const iconSlot = h('span');
	const label = h('span');
	const element = h('button', {
		'type': 'button',
		'class': 'flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-raised-hover',
		'data-item-preview': true,
		'onClick': onClick,
	}, iconSlot, label);
	/** @param {boolean} active */
	const show = (active) => {
		iconSlot.replaceChildren(icon(active ? 'stop' : 'play', 'size-4'));
		label.textContent = active ? 'Stop' : 'Play';
	};
	return { element, show };
}

/**
 * Tabs over panels, the first one selected. The tab bar stays at the top while the dialog scrolls. Left and right
 * arrows move between tabs, and only the selected panel is shown.
 * @param {{ id: string, label: string, panel: HTMLElement }[]} tabs
 * @returns {{ bar: HTMLElement, panels: HTMLElement[] }}
 */
export function tabs(tabs) {
	const buttons = tabs.map(({ id, label }) => h('button', {
		'type': 'button',
		'role': 'tab',
		'id': `tab-${id}`,
		'aria-controls': `panel-${id}`,
		'data-tab': id,
		'class': 'cursor-pointer border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-muted hover:text-text aria-selected:border-music aria-selected:text-text',
	}, label));
	const panels = tabs.map(({ id, panel }) => {
		panel.id = `panel-${id}`;
		panel.setAttribute('role', 'tabpanel');
		panel.setAttribute('aria-labelledby', `tab-${id}`);
		return panel;
	});
	const select = (/** @type {number} */ index) => {
		buttons.forEach((button, i) => {
			button.setAttribute('aria-selected', String(i === index));
			button.tabIndex = i === index ? 0 : -1;
			panels[i].hidden = i !== index;
		});
	};
	buttons.forEach((button, index) => {
		button.addEventListener('click', () => select(index));
		button.addEventListener('keydown', (event) => {
			const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
			if (step) {
				event.preventDefault();
				const next = (index + step + buttons.length) % buttons.length;
				select(next);
				buttons[next].focus();
			}
		});
	});
	select(0);
	const bar = h('div', { class: 'sticky -top-4 z-10 -mx-5 -mt-4 flex gap-5 border-b border-line bg-panel px-5 pt-3', role: 'tablist' }, buttons);
	return { bar, panels };
}

/** The save indicator: a spinner while saving, a checkmark once saved, a red message when saving failed. */
export function saveStatus() {
	const element = h('div', { 'class': 'flex h-5 items-center gap-2 text-sm text-danger', 'role': 'status', 'data-save-status': true });
	/**
	 * @param {'saving' | 'saved' | 'failed'} state
	 * @param {string} [message] why saving failed
	 */
	const show = (state, message = '') => {
		element.dataset.state = state;
		if (state === 'failed') {
			element.replaceChildren(`Could not save: ${message}`);
			element.removeAttribute('aria-label');
			return;
		}
		element.replaceChildren(state === 'saving'
			? icon('spinner', 'size-5 animate-spin text-muted')
			: icon('check', 'size-5 text-emerald-400'));
		element.setAttribute('aria-label', state === 'saving' ? 'Saving' : 'Saved');
	};
	return { element, show };
}
