import { HttpStartupApi } from './api/startup-api.js';
import { browserClock } from './browser-clock.js';
import { StartupFlow } from './logic/startup-flow.js';
import { h } from './ui/dom.js';
import { connectionNotice, errorNotice, showError, toolsHeader } from './ui/startup-parts.js';

/** @typedef {import('./logic/startup-flow.js').StartupView} StartupView */
/** @typedef {import('./logic/startup-flow.js').FolderListing} FolderListing */

const BUTTON = 'cursor-pointer rounded-md bg-raised px-3 py-1.5 text-sm font-medium hover:bg-raised-hover disabled:cursor-default disabled:opacity-50';
const PRIMARY = 'cursor-pointer rounded-md bg-music px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-surface hover:brightness-110 disabled:cursor-default disabled:opacity-50';

const root = document.getElementById('selector');
if (!root) {
	throw new Error('selector.html is missing the #selector element');
}

const flow = new StartupFlow({
	api: new HttpStartupApi(),
	clock: browserClock,
	phase: 'selecting',
	onChange: render,
	onLeave: () => window.location.assign('/'),
});

const offline = connectionNotice();
const error = errorNotice();
const givenList = h('div', { class: 'grid gap-2 sm:grid-cols-2' });
const given = h('section', { class: 'space-y-2', hidden: true }, sectionTitle('Soundboards'), givenList);
const recentList = h('div', { class: 'grid gap-2 sm:grid-cols-2' });
const recent = h('section', { class: 'space-y-2', hidden: true }, sectionTitle('Recent'), recentList);
const browseButton = browseCard(() => showBrowser(true));
// Kept when only the given folders may be opened, so the way to other folders is still where it always is.
const browseRefused = h('div', { title: 'Only the folders given when the app was started can be opened.' }, browseCard(null));

const places = h('div', { class: 'flex flex-wrap gap-2' });
const pathInput = h('input', {
	'type': 'text',
	'class': 'min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-sm outline-none focus:border-music',
	'placeholder': 'Paste a folder path',
	'aria-label': 'Folder path',
	'spellcheck': 'false',
	'data-path-input': true,
});
const pathForm = h('form', { class: 'flex gap-2' }, pathInput, h('button', { type: 'submit', class: BUTTON }, 'Go'));
pathForm.addEventListener('submit', (event) => {
	event.preventDefault();
	const path = pathInput.value.trim();
	if (path !== '') {
		flow.browse(path);
	}
});
const current = h('div', { class: 'flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2' });
const folderList = h('ul', { 'class': 'max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line bg-panel', 'data-folder-list': true });
const backButton = h('button', {
	'type': 'button',
	'class': BUTTON,
	'data-browse-back': true,
	'onClick': () => showBrowser(false),
}, '← Recent');
const browse = h('section', { class: 'space-y-3', hidden: true },
	h('div', { class: 'flex items-center gap-3' }, backButton, sectionTitle('Browse')),
	places,
	pathForm,
	current,
	folderList);

const header = toolsHeader('Soundboard Selection');
root.replaceChildren(
	header.element,
	h('main', { class: 'mx-auto w-full max-w-3xl flex-1 space-y-6 px-5 py-8' },
		offline.element,
		error,
		given,
		recent,
		browse),
);

/** Each part is drawn again only when what it shows changed, so polling never resets a hover or a typed path. */
const drawn = { given: '', recent: '', places: '', listing: '', browseFailures: 0 };
/** The folder browser loads its first folder once the server said no folders were given on the command line. */
let browsing = false;
/** Recent and Browse take turns; null until the first state, which opens Browse when there is nothing recent. */
let showingBrowser = /** @type {boolean | null} */ (null);
/** @type {StartupView | null} */
let lastView = null;

/** @param {boolean} visible */
function showBrowser(visible) {
	showingBrowser = visible;
	if (lastView) {
		render(lastView);
	}
}

/** @param {StartupView} view */
function render(view) {
	lastView = view;
	offline.show(!view.connected);
	showError(error, view.error);
	const state = view.state;
	if (!state) {
		return;
	}
	header.show(state.tools);
	if (state.paths === null && !browsing) {
		browsing = true;
		flow.browseStart();
	}
	showingBrowser ??= state.recent.length === 0;
	const busy = view.busy;
	given.hidden = state.paths === null;
	recent.hidden = state.paths !== null || showingBrowser;
	browse.hidden = state.paths !== null || !showingBrowser;
	backButton.hidden = state.recent.length === 0;

	const givenKey = JSON.stringify([state.paths, busy]);
	if (state.paths && givenKey !== drawn.given) {
		drawn.given = givenKey;
		givenList.replaceChildren(...state.paths.map((folder) => folderCard({
			name: folder.name,
			path: folder.path,
			reason: folder.reason,
			busy,
			onOpen: () => flow.select(folder.path),
		})), browseRefused);
	}
	const recentKey = JSON.stringify([state.recent, busy]);
	if (state.paths === null && recentKey !== drawn.recent) {
		drawn.recent = recentKey;
		recentList.replaceChildren(...state.recent.map((folder) => folderCard({
			name: folder.name,
			path: folder.path,
			reason: folder.exists ? null : 'This folder doesn’t exist any more.',
			busy,
			onOpen: () => flow.select(folder.path),
			onForget: () => flow.forgetRecent(folder.path),
		})), browseButton);
	}
	const placesKey = JSON.stringify([view.places, view.listing?.path]);
	if (placesKey !== drawn.places) {
		drawn.places = placesKey;
		places.replaceChildren(...view.places.map((place) => h('button', {
			'type': 'button',
			'class': `${BUTTON} data-[current=true]:bg-music/25 data-[current=true]:text-text`,
			'title': place.path,
			'data-place': place.path,
			'data-current': String(place.path === view.listing?.path),
			'onClick': () => flow.browse(place.path),
		}, place.name)));
	}
	const listingKey = JSON.stringify([view.listing, busy]);
	if (view.listing && listingKey !== drawn.listing) {
		const pathChanged = JSON.parse(drawn.listing || 'null')?.[0]?.path !== view.listing.path;
		drawn.listing = listingKey;
		if (pathChanged) {
			pathInput.value = view.listing.path;
		}
		drawListing(view.listing, busy);
	}
	// A refused folder leaves the browser where it was, so the typed path goes back to the one shown.
	if (view.browseFailures !== drawn.browseFailures) {
		drawn.browseFailures = view.browseFailures;
		pathInput.value = view.listing?.path ?? '';
		showToast(view.browseError ?? '');
	}
}

const toast = h('div', {
	'class': 'pointer-events-none fixed right-4 bottom-4 max-w-sm rounded-md border border-danger/50 bg-panel px-4 py-2 text-sm text-danger opacity-0 shadow-lg transition-opacity duration-300 data-[visible=true]:opacity-100',
	'role': 'status',
	'data-toast': true,
	'data-visible': 'false',
});
document.body.append(toast);
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/**
 * A short note in the corner that fades after a second, for a folder that can't be shown.
 * @param {string} message
 */
function showToast(message) {
	toast.textContent = message;
	toast.dataset.visible = 'true';
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		toast.dataset.visible = 'false';
	}, 1000);
}

/**
 * @param {FolderListing} listing
 * @param {boolean} busy
 */
function drawListing(listing, busy) {
	const summary = listing.soundboard
		? 'Soundboard folder'
		: listing.allowed
			? `No soundboard here yet: ${count(listing.folders.length, 'folder')}, ${count(listing.audioFiles, 'audio file')}`
			: listing.reason;
	current.replaceChildren(
		h('button', {
			'type': 'button',
			'class': BUTTON,
			'disabled': listing.parent === null,
			'title': listing.parent ?? '',
			'data-folder-up': true,
			'onClick': () => listing.parent && flow.browse(listing.parent),
		}, '↑ Up'),
		h('span', {
			'class': `min-w-0 flex-1 text-sm ${listing.allowed ? 'text-muted' : 'text-notice'}`,
			'data-folder-summary': true,
		}, summary),
		h('span', { title: listing.reason ?? '' }, h('button', {
			'type': 'button',
			'class': PRIMARY,
			'disabled': !listing.allowed || busy,
			'data-folder-open': true,
			'onClick': () => flow.select(listing.path),
		}, listing.soundboard ? 'Open' : 'Create soundboard here')),
	);
	if (listing.folders.length === 0) {
		folderList.replaceChildren(h('li', { class: 'px-3 py-2 text-sm text-muted' }, 'No folders inside.'));
		return;
	}
	folderList.replaceChildren(...listing.folders.map((folder) => h('li', {
		'class': 'flex items-center gap-2 pr-2 data-[refused=true]:text-muted',
		'title': folder.refused ?? '',
		'data-folder': folder.path,
		'data-refused': String(folder.refused !== null),
	},
	h('button', {
		type: 'button',
		class: 'min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-sm hover:bg-raised-hover',
		onClick: () => flow.browse(folder.path),
	}, folder.name),
	folder.soundboard ? h('span', { class: 'rounded bg-music/20 px-1.5 py-0.5 text-xs text-music' }, 'Soundboard') : null,
	folder.soundboard && folder.refused === null
		? h('button', {
				'type': 'button',
				'class': `${BUTTON} py-1`,
				'disabled': busy,
				'data-folder-quick-open': true,
				'onClick': () => flow.select(folder.path),
			}, 'Open')
		: null)));
}

/**
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.path
 * @param {string | null} options.reason why it can't be opened, shown under it and as the tooltip
 * @param {boolean} options.busy
 * @param {() => void} options.onOpen
 * @param {() => void} [options.onForget]
 */
function folderCard({ name, path, reason, busy, onOpen, onForget }) {
	return h('div', {
		'class': 'flex items-stretch overflow-hidden rounded-lg border border-line bg-panel data-[refused=false]:hover:border-music',
		'title': reason ?? path,
		'data-folder-card': path,
		'data-refused': String(reason !== null),
	},
	h('button', {
		type: 'button',
		class: 'flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 px-4 py-3 text-left disabled:cursor-default disabled:opacity-60',
		disabled: reason !== null || busy,
		onClick: onOpen,
	},
	h('span', { class: 'max-w-full truncate font-semibold' }, name),
	h('span', { class: 'max-w-full truncate text-xs text-muted' }, path),
	reason === null ? null : h('span', { class: 'text-xs text-notice' }, reason)),
	onForget
		? h('button', {
				'type': 'button',
				'class': 'cursor-pointer px-3 text-lg text-muted hover:bg-raised-hover hover:text-text',
				'title': 'Forget this folder',
				'aria-label': `Forget ${name}`,
				'data-forget': path,
				'onClick': onForget,
			}, '×')
		: null);
}

/**
 * The card after the folder cards that opens the folder browser.
 * @param {(() => void) | null} onClick null when browsing isn't allowed
 */
function browseCard(onClick) {
	return h('button', {
		'type': 'button',
		'class': 'flex h-full min-h-16 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-music/60 px-4 py-3 font-semibold text-music hover:bg-music/10 disabled:cursor-default disabled:border-line disabled:text-muted disabled:hover:bg-transparent',
		'disabled': onClick === null,
		'data-browse': true,
		'onClick': onClick ?? undefined,
	}, 'Browse folders…');
}

/** @param {string} text */
function sectionTitle(text) {
	return h('h2', { class: 'text-xs font-semibold tracking-widest text-muted uppercase' }, text);
}

/**
 * @param {number} amount
 * @param {string} noun
 */
function count(amount, noun) {
	return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

flow.start();
