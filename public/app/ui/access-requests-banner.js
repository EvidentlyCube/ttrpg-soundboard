import { Component } from './component.js';
import { h, on } from './dom.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */
/** @typedef {import('../logic/ports.js').AccessRequest} AccessRequest */

/**
 * Under the header: one card for every device on the network that asks to be paired (DESIGN.md §9.16). It sits in the
 * page instead of over it, so the sounds stay usable while a request waits.
 */
export class AccessRequestsBanner extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const soundboard = this.#soundboard;
		const list = h('div', {
			'class': 'flex shrink-0 flex-col gap-2 border-b border-line bg-panel px-5 py-2',
			'data-access-requests': true,
		});
		const update = (/** @type {AccessRequest[]} */ requests) => {
			list.hidden = requests.length === 0;
			list.replaceChildren(...requests.map((request) => this.#card(request)));
		};
		update(soundboard.accessRequests());
		this.own(soundboard.on('access.requestsChanged', ({ requests }) => update(requests)));
		return list;
	}

	/** @param {AccessRequest} request */
	#card({ address, code }) {
		const soundboard = this.#soundboard;
		const button = (/** @type {string} */ label, /** @type {string} */ colors, /** @type {'allow' | 'deny'} */ decision) => {
			const element = h('button', {
				'type': 'button',
				'class': `cursor-pointer rounded-md px-3 py-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-notice ${colors}`,
				'data-access-decision': decision,
			}, label);
			on(element, 'click', () => soundboard.answerAccessRequest(address, decision));
			return element;
		};
		return h('div', { 'class': 'flex flex-wrap items-center gap-x-4 gap-y-2', 'data-access-request': address },
			h('span', { class: 'text-sm' }, 'A device asks to connect: ', h('span', { class: 'font-semibold' }, address)),
			h('span', { 'class': 'rounded bg-surface px-2 py-0.5 text-lg font-bold tracking-widest tabular-nums', 'data-access-code': true }, code),
			h('span', { class: 'flex gap-2' },
				button('Allow', 'bg-host text-surface hover:brightness-110', 'allow'),
				button('Deny', 'bg-raised hover:bg-raised-hover', 'deny'),
			),
		);
	}
}
