import { encodeQr } from '../logic/qr-code.js';
import { Component } from './component.js';
import { h } from './dom.js';
import { t } from './text.js';

/** @typedef {import('../logic/soundboard.js').Soundboard} Soundboard */

/** The white border a scanner needs around a code, in modules. */
const QUIET_ZONE = 4;

/**
 * The body of the dialog that shows a QR code with the address that opens the remote on a phone (DESIGN.md §9.16). The
 * phone then asks to be paired, and the request is answered on this page.
 */
export class ConnectPhoneDialog extends Component {
	#soundboard;

	/** @param {Soundboard} soundboard */
	constructor(soundboard) {
		super();
		this.#soundboard = soundboard;
	}

	/** @override */
	render() {
		const body = h('div', { 'class': 'space-y-3 text-center text-sm', 'data-connect-phone': true }, h('p', { class: 'text-muted' }, 'Loading…'));
		this.#soundboard.fetchConnectLinks().then(
			(links) => body.replaceChildren(...this.#content(links)),
			() => body.replaceChildren(h('p', { class: 'text-danger' }, 'Could not get the link from the server.')),
		);
		return body;
	}

	/**
	 * @param {string[]} links
	 * @returns {HTMLElement[]}
	 */
	#content(links) {
		if (links.length === 0) {
			return [h('p', {}, t('connectPhone.noLan'))];
		}
		return [
			h('p', { class: 'text-muted' }, t('connectPhone.scan')),
			qrCanvas(links[0]),
			...links.map((link) => h('p', { 'class': 'text-xs break-all text-muted select-all', 'data-connect-link': true }, link)),
		];
	}
}

/**
 * @param {string} text
 * @returns {HTMLCanvasElement}
 */
function qrCanvas(text) {
	const modules = encodeQr(text);
	const size = modules.length + QUIET_ZONE * 2;
	const canvas = h('canvas', {
		'class': 'mx-auto w-64 max-w-full rounded-md [image-rendering:pixelated]',
		'width': size,
		'height': size,
		'role': 'img',
		'aria-label': t('connectPhone.qrLabel'),
		'data-qr-code': true,
	});
	const context = canvas.getContext('2d');
	if (context) {
		context.fillStyle = '#fff';
		context.fillRect(0, 0, size, size);
		context.fillStyle = '#000';
		modules.forEach((row, y) => row.forEach((dark, x) => {
			if (dark) {
				context.fillRect(x + QUIET_ZONE, y + QUIET_ZONE, 1, 1);
			}
		}));
	}
	return canvas;
}
