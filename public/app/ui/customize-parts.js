import { h } from './dom.js';
import { filledField } from './filled-field.js';
import { holdButton } from './hold-button.js';
import { icon } from './icons.js';
import { t } from './text.js';

/** @typedef {import('./dom.js').Child} Child */

/**
 * Pieces shared by the Customize dialogs (DESIGN.md §9.7). Each returns its element plus the functions that update it;
 * the dialog wires them to the soundboard.
 */

/** Card colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const CARD_ACCENTS = {
	music: 'group-hover:bg-music group-focus-within:bg-music',
	sfx: 'group-hover:bg-sfx group-focus-within:bg-sfx',
	neutral: 'group-hover:bg-muted group-focus-within:bg-muted',
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
	// The pill stays on one line within the card, so a long title, such as a track's, ends in "…" with a tooltip.
	h('h3', {
		class: 'absolute -top-3 left-4 max-w-[calc(100%-2rem)] truncate rounded-full bg-line-dim px-3 py-0.5 text-xs font-semibold uppercase tracking-widest text-muted transition-colors '
			+ `group-hover:text-surface group-focus-within:text-surface ${CARD_ACCENTS[accent]}`,
		title,
	}, title),
	...children);
}

/** Radio button and checkbox colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const CHOICE_ACCENTS = { music: 'accent-music', sfx: 'accent-sfx' };

/**
 * A choice's name with a short description below it, next to its radio button or checkbox.
 * @param {HTMLInputElement} input
 * @param {string} label
 * @param {string} description
 */
function choiceRow(input, label, description) {
	return h('label', { class: 'flex cursor-pointer items-start gap-3' },
		input,
		h('span', { class: 'space-y-0.5' },
			h('span', { class: 'block text-sm font-medium' }, label),
			h('span', { class: 'block text-xs text-muted' }, description)));
}

/**
 * A checkbox for one on/off setting, with its name and a short description. Changing it reports it at once.
 * @param {object} options
 * @param {string} options.name identifies the checkbox in the page
 * @param {string} options.label
 * @param {string} options.description
 * @param {boolean} options.checked
 * @param {keyof typeof CHOICE_ACCENTS} options.accent
 * @param {(checked: boolean) => void} options.onChange
 * @returns {{ element: HTMLElement, update: (checked: boolean) => void }}
 */
export function checkbox({ name, label, description, checked, accent, onChange }) {
	const input = h('input', {
		'type': 'checkbox',
		'checked': checked,
		'data-checkbox': name,
		'class': `mt-1 size-4 shrink-0 cursor-pointer ${CHOICE_ACCENTS[accent]}`,
		'onChange': () => onChange(input.checked),
	});
	return {
		element: choiceRow(input, label, description),
		update: (newChecked) => {
			input.checked = newChecked;
		},
	};
}

/**
 * Radio buttons for one setting, each with its name and a short description below it. Choosing one reports it at once.
 * @template {string} V
 * @param {object} options
 * @param {string} options.name groups the buttons; unique within the dialog
 * @param {{ value: V, label: string, description: string }[]} options.choices
 * @param {V} options.value
 * @param {keyof typeof CHOICE_ACCENTS} options.accent
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
		'class': `mt-1 size-4 shrink-0 cursor-pointer ${CHOICE_ACCENTS[accent]}`,
		'onChange': () => onChange(choice.value),
	}));
	const element = h('div', { 'class': 'space-y-3', 'role': 'radiogroup', 'data-radio-group': name },
		choices.map((choice, index) => choiceRow(inputs[index], choice.label, choice.description)));
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
	// File names can be long, so the hint stays on one line and shows in full as a tooltip.
	const hintText = h('p', { class: 'truncate text-xs text-muted', title: hint }, hint);
	const { element: field, input } = filledField({
		label: t('customize.title'),
		accent,
		align: 'left',
		width: 'w-full',
		attributes: { 'value': value, 'aria-invalid': 'false', 'data-invalid': 'false', 'data-item-title': true },
	});
	input.addEventListener('input', () => {
		const empty = input.value.trim() === '';
		input.setAttribute('aria-invalid', String(empty));
		input.dataset.invalid = String(empty);
		hintText.textContent = empty ? t('customize.emptyTitle') : hint;
		hintText.title = hintText.textContent;
		if (!empty) {
			onTitle(input.value);
		}
	});
	return { element: h('div', { class: 'space-y-1.5' }, field, hintText), input };
}

/** Play button colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const PLAY_ACCENTS = {
	sfx: 'bg-sfx text-surface focus-visible:outline-sfx',
	music: 'bg-music text-surface focus-visible:outline-music',
};

/**
 * The footer the dialog keeps below its scrolling body: Play in the middle, the save status on the right.
 * @param {HTMLElement} play
 * @param {HTMLElement} status
 */
export function playFooter(play, status) {
	return h('div', { class: 'grid grid-cols-[1fr_auto_1fr] items-center gap-4' },
		h('span'), play, h('span', { class: 'justify-self-end' }, status));
}

/**
 * A Play / Stop button in the dialog's accent that shows whether the item is playing.
 * @param {() => void} onClick
 * @param {keyof typeof PLAY_ACCENTS} accent
 */
export function playToggle(onClick, accent) {
	const iconSlot = h('span');
	const label = h('span');
	const element = h('button', {
		'type': 'button',
		'class': `flex min-w-28 cursor-pointer items-center justify-center gap-2 rounded-md px-4 py-1.5 text-sm font-semibold shadow-md shadow-black/30 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 ${PLAY_ACCENTS[accent]}`,
		'data-item-preview': true,
		'onClick': onClick,
	}, iconSlot, label);
	/** @param {boolean} active */
	const show = (active) => {
		iconSlot.replaceChildren(icon(active ? 'stop' : 'play', 'size-4'));
		label.textContent = active ? t('customize.stop') : t('customize.play');
	};
	return { element, show };
}

/**
 * Tabs over panels, the first one selected. The tab bar stays at the top while the dialog scrolls. Left and right
 * arrows move between tabs, and only the selected panel is shown.
 * @param {{ id: string, label: string, panel: HTMLElement }[]} tabs
 * @param {string} [initial] the id of the tab selected at first; the first one without it
 * @returns {{ bar: HTMLElement, panels: HTMLElement[] }}
 */
export function tabs(tabs, initial) {
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
	select(Math.max(0, tabs.findIndex((tab) => tab.id === initial)));
	const bar = h('div', { class: 'sticky -top-4 z-10 -mx-5 -mt-4 flex gap-5 border-b border-line bg-panel px-5 pt-3', role: 'tablist' }, buttons);
	return { bar, panels };
}

/**
 * The last card of a Customize dialog: Move… and the hold-to-delete button. Once deleted or moved, the item leaves the
 * library and the board closes or updates the dialog, so only failures are shown here.
 * @param {object} options
 * @param {string} options.title
 * @param {keyof typeof CARD_ACCENTS} options.accent
 * @param {() => void} [options.onMove] opens the move dialog; without it there is no Move button
 * @param {() => Promise<void>} options.onDelete rejects with a message for the user
 * @param {string} [options.note] shown below the buttons
 * @returns {{ element: HTMLElement, showNote: (note: string | null) => void, destroy: () => void }}
 */
export function moveOrDeleteCard({ title, accent, onMove, onDelete, note }) {
	const error = h('p', { 'class': 'text-sm text-danger', 'hidden': true, 'data-delete-error': true });
	const noteText = h('p', { class: 'text-xs text-muted' });
	const remove = holdButton({
		label: t('customize.holdToDelete'),
		busyLabel: t('customize.deleting'),
		onHold: () => {
			error.hidden = true;
			remove.setBusy(true);
			onDelete().catch((/** @type {unknown} */ reason) => {
				remove.setBusy(false);
				error.textContent = t('customize.deleteFailed', { reason: reason instanceof Error ? reason.message : String(reason) });
				error.hidden = false;
			});
		},
	});
	const move = onMove && h('button', {
		'type': 'button',
		'class': 'cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm hover:bg-raised-hover',
		'data-move-item': true,
		'onClick': onMove,
	}, t('customize.move'));
	/** @param {string | null} text */
	const showNote = (text) => {
		noteText.textContent = text ?? '';
		noteText.hidden = text === null;
	};
	showNote(note ?? null);
	return {
		element: card(title, accent, h('div', { class: 'space-y-3' },
			h('div', { class: 'flex items-center justify-between gap-3' }, move ?? h('span'), remove.element),
			noteText,
			error)),
		showNote,
		destroy: remove.destroy,
	};
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
			element.replaceChildren(t('customize.saveFailed', { reason: message }));
			element.removeAttribute('aria-label');
			return;
		}
		element.replaceChildren(state === 'saving'
			? icon('spinner', 'size-5 animate-spin text-muted')
			: icon('check', 'size-5 text-emerald-400'));
		element.setAttribute('aria-label', state === 'saving' ? t('customize.saving') : t('customize.saved'));
	};
	return { element, show };
}
