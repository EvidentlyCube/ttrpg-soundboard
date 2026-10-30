import { browserClock } from './browser-clock.js';
import { AccessRequester } from './logic/access-requester.js';
import { h, on } from './ui/dom.js';

/** @typedef {import('./logic/access-requester.js').ConnectApi} ConnectApi */
/** @typedef {import('./logic/access-requester.js').RequesterState} RequesterState */

/**
 * @param {string} method
 * @param {string} path
 * @returns {Promise<import('./logic/access-requester.js').PairingAnswer>}
 */
async function call(method, path) {
	const response = await fetch(path, { method, cache: 'no-store' });
	if (response.status === 403) {
		const { error } = await response.json().catch(() => ({ error: '' }));
		if (error === 'This address is blocked') {
			return { status: 'banned' };
		}
		// Any other refusal means this device was allowed in another tab while this page was open: the page itself is now
		// a different one.
		// Once per page, so a refusal that reloading cannot fix never turns into a loop.
		if (window.sessionStorage.getItem('connect-reloaded') === null) {
			window.sessionStorage.setItem('connect-reloaded', 'true');
			window.location.reload();
			return new Promise(() => {});
		}
		throw new Error(`${path} answered 403`);
	}
	if (!response.ok) {
		throw new Error(`${path} answered ${response.status}`);
	}
	return response.json();
}

/** @type {ConnectApi} */
const api = {
	request: () => call('POST', '/api/access/requests'),
	poll: () => call('GET', '/api/access/requests/mine'),
};

const root = document.getElementById('connect');
if (!root) {
	throw new Error('connect.html is missing the #connect element');
}

const MESSAGES = {
	starting: ['Connecting…', ''],
	pending: ['Waiting for approval…', 'Allow this device on the server, next to the soundboard. The code there is the same as below.'],
	allowed: ['Allowed', 'Opening the remote…'],
	denied: ['Denied', 'The server did not allow this device.'],
	expired: ['The request expired', 'Nobody answered in time.'],
	banned: ['Blocked', 'This device asked too many times. It stays blocked until the server restarts.'],
};

/** @param {RequesterState} state */
function render(state) {
	const [title, detail] = MESSAGES[state.phase];
	const retry = state.phase === 'denied' || state.phase === 'expired'
		? h('button', {
				type: 'button',
				class: 'cursor-pointer rounded-md bg-raised px-4 py-2 text-sm font-semibold hover:bg-raised-hover',
			}, 'Try again')
		: null;
	if (retry) {
		on(retry, 'click', () => requester.start());
	}
	root?.replaceChildren(
		h('h1', { class: 'text-xl font-semibold' }, 'Soundboard'),
		state.code === null
			? ''
			: h('p', {
					'class': 'rounded-lg border border-line bg-panel px-6 py-3 text-5xl font-bold tracking-widest tabular-nums',
					'data-pairing-code': true,
				}, state.code),
		h('p', {
			'class': 'text-lg font-semibold',
			'data-pairing-status': state.phase,
		}, title),
		h('p', { class: 'text-sm text-muted' }, detail),
		...(retry ? [retry] : []),
	);
	if (state.phase === 'allowed') {
		window.location.reload();
	}
}

const requester = new AccessRequester({ api, clock: browserClock, onChange: render });
requester.start();
