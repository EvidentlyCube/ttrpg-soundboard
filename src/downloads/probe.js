import { isPlainObject } from '../library/validate.js';
import { UnusableLinkError } from './errors.js';

/** A channel can hold thousands of videos; the dialog lists this many at most. */
export const MAX_ENTRIES = 500;

/** @typedef {{ title: string, start: number, end: number }} Chapter */
/** @typedef {{ id: string, title: string, duration: number | null, url: string, extractor: string | null }} Entry */
/**
 * @typedef {{ kind: 'file', url: string, name: string, size: number | null, contentType: string }} FileProbe a direct
 * 	link to an audio or video file
 */
/**
 * @typedef {object} VideoProbe
 * @property {'video'} kind
 * @property {string} url the video's page
 * @property {string} id
 * @property {string} title
 * @property {number | null} duration seconds
 * @property {number | null} size bytes of the audio that would be downloaded, when yt-dlp knows it
 * @property {string | null} extractor yt-dlp's name for the site, such as "Youtube"
 * @property {Chapter[]} chapters
 * @property {boolean} playlistAvailable the link also names a playlist, which can be looked up instead
 */
/**
 * @typedef {object} PlaylistProbe
 * @property {'playlist'} kind
 * @property {string} url
 * @property {string} id
 * @property {string} title
 * @property {Entry[]} entries
 * @property {boolean} truncated more entries exist than were listed
 */
/** @typedef {FileProbe | VideoProbe | PlaylistProbe} Probe */

/**
 * @param {string} text what the user pasted
 * @returns {URL}
 */
export function parseLink(text) {
	let url;
	try {
		url = new URL(text.trim());
	} catch {
		throw new UnusableLinkError('That is not a link.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new UnusableLinkError('Only http and https links can be downloaded.');
	}
	return url;
}

/**
 * Whether a link names a playlist as well as a video, like YouTube's `watch?v=…&list=…`.
 * @param {URL} url
 */
export function namesPlaylist(url) {
	return url.searchParams.has('v') && url.searchParams.has('list');
}

/**
 * Reduces what `yt-dlp -J --flat-playlist` printed to what the dialog shows.
 * @param {unknown} info the parsed JSON
 * @param {URL} link what was looked up
 * @returns {VideoProbe | PlaylistProbe}
 */
export function toProbe(info, link) {
	if (!isPlainObject(info)) {
		throw new UnusableLinkError('yt-dlp gave an answer that could not be read.');
	}
	const id = text(info.id) ?? '';
	const title = text(info.title) ?? id;
	const url = text(info.webpage_url) ?? link.href;
	if (info._type === 'playlist') {
		const entries = (Array.isArray(info.entries) ? info.entries : []).flatMap((entry) => toEntry(entry));
		if (entries.length === 0) {
			throw new UnusableLinkError('This playlist has nothing that can be downloaded.');
		}
		const total = typeof info.playlist_count === 'number' ? info.playlist_count : null;
		return {
			kind: 'playlist',
			url,
			id,
			title,
			entries: entries.slice(0, MAX_ENTRIES),
			truncated: total === null ? entries.length >= MAX_ENTRIES : total > Math.min(entries.length, MAX_ENTRIES),
		};
	}
	if (info.is_live === true || info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
		throw new UnusableLinkError("Live streams can't be downloaded.");
	}
	const duration = seconds(info.duration);
	return {
		kind: 'video',
		url,
		id,
		title,
		duration,
		size: bytes(info.filesize) ?? bytes(info.filesize_approx),
		extractor: text(info.extractor_key),
		chapters: toChapters(info.chapters, duration),
		playlistAvailable: namesPlaylist(link),
	};
}

/**
 * The message for a failed `yt-dlp` run: its last error line, without the "ERROR:" prefix.
 * @param {string[]} lines what it printed to stderr
 */
export function failureMessage(lines) {
	const error = lines.findLast((line) => line.startsWith('ERROR:'));
	if (error === undefined) {
		return lines.findLast((line) => line.trim() !== '')?.trim() ?? 'yt-dlp failed without saying why.';
	}
	return error.slice('ERROR:'.length).trim();
}

/**
 * @param {unknown} entry
 * @returns {Entry[]} the entry, or nothing for one that isn't a single video
 */
function toEntry(entry) {
	if (!isPlainObject(entry)) {
		return [];
	}
	const id = text(entry.id);
	const url = text(entry.url) ?? text(entry.webpage_url);
	const extractor = text(entry.ie_key);
	// A channel's front page lists its tabs ("Videos", "Shorts"), which are lists themselves.
	if (id === null || url === null || entry._type === 'playlist' || extractor?.endsWith('Tab')) {
		return [];
	}
	return [{ id, title: text(entry.title) ?? id, duration: seconds(entry.duration), url, extractor }];
}

/**
 * @param {unknown} value
 * @param {number | null} duration where the last chapter ends when it doesn't say
 * @returns {Chapter[]}
 */
function toChapters(value, duration) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((chapter, index) => {
		if (!isPlainObject(chapter)) {
			return [];
		}
		const start = seconds(chapter.start_time);
		const end = seconds(chapter.end_time) ?? duration;
		if (start === null || end === null || end <= start) {
			return [];
		}
		return [{ title: text(chapter.title) ?? `Chapter ${index + 1}`, start, end }];
	});
}

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** @param {unknown} value */
function seconds(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** @param {unknown} value */
function bytes(value) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
