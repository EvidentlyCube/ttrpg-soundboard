import { h } from './dom.js';

/** Focus colors, written out in full so Tailwind generates them (DESIGN.md §9.6). */
const ACCENTS = {
	music: { field: 'focus:border-music', text: 'peer-focus:text-music' },
	sfx: { field: 'focus:border-sfx', text: 'peer-focus:text-sfx' },
};

/**
 * A filled text field: a background with only an underline, an optional floating label, and an optional unit inside the
 * field after the value. The label sits small at the top, or in the middle like a placeholder while the field is empty
 * and unfocused. Underline, label and unit take the accent color on focus, and turn red while the input has
 * `data-invalid="true"`. Everything is done with styles, so the value is only ever what was typed.
 * @param {object} options
 * @param {string} [options.label]
 * @param {string} [options.unit] such as `ms`
 * @param {keyof typeof ACCENTS} [options.accent]
 * @param {'left' | 'right'} [options.align] right suits numbers, left text
 * @param {string} [options.width] a Tailwind width class for the field
 * @param {Record<string, unknown>} [options.attributes] for the input, such as `value`, `inputmode`, `aria-label` or `data-*`
 * @returns {{ element: HTMLLabelElement, input: HTMLInputElement }}
 */
export function filledField({ label, unit, accent = 'music', align = 'right', width = 'w-32', attributes = {} }) {
	const colors = ACCENTS[accent];
	const input = h('input', {
		type: 'text',
		...attributes,
		// `:placeholder-shown` is how the label knows the field is empty, and it needs a placeholder to work.
		placeholder: ' ',
		class: `peer ${width} rounded-t-md border-0 border-b-2 border-line bg-surface pl-3 ${unit ? 'pr-9' : 'pr-3'} `
			+ `${label ? 'pt-5 pb-1' : 'py-1.5'} ${align === 'right' ? 'text-right tabular-nums' : 'text-left'} `
			+ `outline-none transition-colors ${colors.field} data-[invalid=true]:border-danger`,
	});
	const floatingLabel = label && h('span', {
		class: 'pointer-events-none absolute top-1 left-3 text-xs text-muted transition-all '
			+ 'peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm '
			+ `peer-focus:top-1 peer-focus:translate-y-0 peer-focus:text-xs ${colors.text} peer-data-[invalid=true]:text-danger`,
	}, label);
	const unitText = unit && h('span', {
		class: `pointer-events-none absolute right-3 bottom-1.5 text-muted transition-colors ${colors.text} peer-data-[invalid=true]:text-danger`,
	}, unit);
	return { element: h('label', { class: 'relative block shrink-0' }, input, floatingLabel, unitText), input };
}
