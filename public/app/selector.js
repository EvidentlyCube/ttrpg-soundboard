import { HttpStartupApi } from './api/startup-api.js';
import { browserClock } from './browser-clock.js';
import { loadLanguage } from './language.js';
import { StartupFlow } from './logic/startup-flow.js';
import { card } from './ui/customize-parts.js';
import { h } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { connectionNotice, errorNotice, showError, toolsHeader } from './ui/startup-parts.js';
import { t } from './ui/text.js';
import { showToast } from './ui/toast.js';

/** @typedef {import('./logic/startup-flow.js').StartupView} StartupView */
/** @typedef {import('./logic/startup-flow.js').FolderListing} FolderListing */

const BUTTON = 'cursor-pointer rounded-md bg-raised px-3 py-1.5 text-sm font-medium hover:bg-raised-hover disabled:cursor-default disabled:opacity-50';
/** A button inside the address bar, which draws the border and the corners around all of them. */
const BAR_BUTTON = 'flex cursor-pointer items-center border-line px-3 text-sm font-medium text-muted hover:bg-raised-hover hover:text-text disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted';
const PRIMARY = 'cursor-pointer rounded-md bg-music px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-surface hover:brightness-110 disabled:cursor-default disabled:opacity-50';

await loadLanguage();

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
const given = h('section', { class: 'space-y-2', hidden: true }, sectionTitle(t('selector.soundboards')), givenList);
const recentList = h('div', { class: 'grid gap-2 sm:grid-cols-2' });
const recent = card(t('selector.recent'), 'music', recentList);
recent.hidden = true;
const browseButton = browseCard(() => showBrowser(true));
// Kept when only the given folders may be opened, so the way to other folders is still where it always is.
const browseRefused = h('div', { title: t('selector.onlyGiven') }, browseCard(null));

const places = h('div', {
	'class': 'absolute top-full left-0 z-20 mt-1 min-w-48 rounded-md border border-line bg-panel py-1 shadow-lg shadow-black/40',
	'role': 'menu',
	'hidden': true,
	'data-places-menu': true,
});
const placesButton = h('button', {
	'type': 'button',
	'class': `${BAR_BUTTON} gap-1 rounded-l-md border-r`,
	'title': t('selector.places'),
	'aria-haspopup': 'menu',
	'data-places-button': true,
	'onClick': () => showPlaces(places.hidden !== false),
}, t('selector.places'), icon('chevronDown', 'size-4'));
const upButton = h('button', {
	'type': 'button',
	'class': `${BAR_BUTTON} border-r`,
	'aria-label': t('selector.up'),
	'disabled': true,
	'data-folder-up': true,
	'onClick': () => upTarget && flow.browse(upTarget),
}, '↑');
/** The folder Up goes to, or null at the top of a disk. */
let upTarget = /** @type {string | null} */ (null);
const pathInput = h('input', {
	'type': 'text',
	'class': 'min-w-0 flex-1 bg-transparent px-3 py-1.5 font-mono text-sm outline-none',
	'placeholder': t('selector.pathPlaceholder'),
	'aria-label': t('selector.path'),
	'spellcheck': 'false',
	'data-path-input': true,
});
// One bordered bar, as in a file manager's address bar: the places, Up, the path and Go.
const pathForm = h('form', { class: 'flex items-stretch rounded-md border border-line bg-raised focus-within:border-music' },
	h('div', { class: 'relative flex' }, placesButton, places),
	upButton,
	pathInput,
	h('button', { type: 'submit', class: `${BAR_BUTTON} rounded-r-md border-l` }, t('selector.go')));
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
}, t('selector.backToRecent'));
const browse = h('div', { class: 'space-y-6', hidden: true },
	backButton,
	card(t('selector.browse'), 'music', h('div', { class: 'space-y-3' }, pathForm, current, folderList)));

/** @param {boolean} visible */
function showPlaces(visible) {
	places.hidden = !visible;
	placesButton.setAttribute('aria-expanded', String(visible));
}
document.addEventListener('pointerdown', (event) => {
	if (!places.hidden && event.target instanceof Node && !placesButton.parentElement?.contains(event.target)) {
		showPlaces(false);
	}
});
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && !places.hidden) {
		showPlaces(false);
		placesButton.focus();
	}
});

const header = toolsHeader(t('selector.title'));
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
			reason: folder.exists ? null : t('selector.gone'),
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
			'class': 'block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-raised-hover data-[current=true]:text-music',
			'role': 'menuitem',
			'title': place.path,
			'data-place': place.path,
			'data-current': String(place.path === view.listing?.path),
			'onClick': () => {
				showPlaces(false);
				flow.browse(place.path);
			},
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
		// A note in the corner that fades after a second, for a folder that can't be shown.
		showToast(view.browseError ?? '', { tone: 'danger' });
	}
}

/**
 * @param {FolderListing} listing
 * @param {boolean} busy
 */
function drawListing(listing, busy) {
	const summary = listing.soundboard
		? t('selector.soundboardFolder')
		: listing.allowed
			? t('selector.noSoundboardYet', {
					folders: t('selector.folderCount', { count: listing.folders.length }),
					files: t('selector.audioFileCount', { count: listing.audioFiles }),
				})
			: listing.reason;
	upTarget = listing.parent;
	upButton.disabled = listing.parent === null;
	upButton.title = listing.parent === null ? t('selector.up') : t('selector.upTo', { path: listing.parent });
	current.replaceChildren(
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
		}, listing.soundboard ? t('selector.open') : t('selector.create'))),
	);
	if (listing.folders.length === 0 && listing.files.length === 0) {
		folderList.replaceChildren(h('li', { class: 'px-3 py-2 text-sm text-muted' }, t('selector.emptyFolder')));
		return;
	}
	// The audio files are only there to show what the folder holds, so they can't be clicked.
	const files = listing.files.map((file) => h('li', {
		'class': 'truncate px-3 py-2 text-sm text-muted',
		'title': file,
		'data-audio-file': file,
	}, folderIcon('🎵'), file));
	folderList.replaceChildren(...listing.folders.map((folder) => h('li', {
		'class': 'flex items-center gap-2 pr-2 hover:bg-raised-hover data-[refused=true]:text-muted',
		'title': folder.refused ?? '',
		'data-folder': folder.path,
		'data-refused': String(folder.refused !== null),
	},
	// A soundboard is opened, never browsed into: its folders are its playlists.
	folder.soundboard
		? h('span', { class: 'min-w-0 flex-1 truncate px-3 py-2 text-sm' },
				folderIcon('🗂️'),
				folder.name,
				folder.title && folder.title !== folder.name
					? h('span', { 'class': 'ml-2 text-xs text-muted', 'data-folder-title': true }, `(${folder.title})`)
					: null)
		: h('button', {
				type: 'button',
				class: 'min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-sm',
				onClick: () => flow.browse(folder.path),
			}, folderIcon('📁'), folder.name),
	folder.holdsSoundboard
		? h('span', {
				'class': 'shrink-0 text-sm',
				'title': t('selector.holdsSoundboard'),
				'aria-label': t('selector.holdsSoundboard'),
				'data-holds-soundboard': true,
			}, '🎵')
		: null,
	folder.soundboard ? h('span', { class: 'rounded bg-music/20 px-1.5 py-0.5 text-xs text-music' }, t('selector.soundboardBadge')) : null,
	folder.soundboard && folder.refused === null
		? h('button', {
				'type': 'button',
				'class': `${PRIMARY} px-3 py-1`,
				'disabled': busy,
				'data-folder-quick-open': true,
				'onClick': () => flow.select(folder.path),
			}, t('selector.open'))
		: null)), ...files);
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
		'class': 'flex items-stretch overflow-hidden rounded-lg border border-line bg-panel data-[refused=false]:border-music/40 data-[refused=false]:bg-music/10 data-[refused=false]:hover:border-music data-[refused=false]:hover:bg-music/20',
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
				'title': t('selector.forget'),
				'aria-label': t('selector.forgetNamed', { name }),
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
		'class': 'flex h-full min-h-16 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-host/60 bg-host/5 px-4 py-3 font-semibold text-host hover:border-host hover:bg-host/15 disabled:cursor-default disabled:border-line disabled:bg-transparent disabled:text-muted disabled:hover:border-line disabled:hover:bg-transparent',
		'disabled': onClick === null,
		'data-browse': true,
		'onClick': onClick ?? undefined,
	}, t('selector.browseFolders'));
}

/** @param {string} emoji */
function folderIcon(emoji) {
	return h('span', { 'class': 'mr-2', 'aria-hidden': 'true' }, emoji);
}

/** @param {string} text */
function sectionTitle(text) {
	return h('h2', { class: 'text-xs font-semibold tracking-widest text-muted uppercase' }, text);
}

flow.start();
