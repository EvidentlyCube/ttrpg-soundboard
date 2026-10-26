import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * Pieces shared by the Customize dialogs (DESIGN.md §9.7). Each returns its element plus the functions that update it;
 * the dialog wires them to the soundboard.
 */

/** @param {string} text */
export function sectionLabel(text) {
	return h('span', { class: 'text-xs font-semibold uppercase tracking-widest text-muted' }, text);
}

/**
 * A title field that only reports non-empty titles. While it is empty it is marked invalid and the hint explains that
 * the last title is kept.
 * @param {object} options
 * @param {string} options.value
 * @param {string} options.hint shown below the field, such as the file name
 * @param {(title: string) => void} options.onTitle
 */
export function titleField({ value, hint, onTitle }) {
	const hintText = h('p', { class: 'text-xs text-muted' }, hint);
	const input = h('input', {
		'type': 'text',
		'value': value,
		'aria-invalid': 'false',
		'data-item-title': true,
		'class': 'w-full rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-music aria-invalid:border-danger',
		'onInput': () => {
			const empty = input.value.trim() === '';
			input.setAttribute('aria-invalid', String(empty));
			hintText.textContent = empty ? 'A title cannot be empty; the last one is kept.' : hint;
			if (!empty) {
				onTitle(input.value);
			}
		},
	});
	return { element: h('label', { class: 'block space-y-1.5' }, sectionLabel('Title'), input, hintText), input };
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
