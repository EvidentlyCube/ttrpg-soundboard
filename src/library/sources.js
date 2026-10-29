import { extname } from 'node:path';

/** @typedef {import('./validate.js').Source} Source */

/** The id `yt-dlp` puts last in its file names, in square brackets before the extension (DESIGN.md §2.3). */
const FILE_NAME_ID = /\[([A-Za-z0-9_-]{11})\]$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
/** Paths that carry the video id as their second part, such as `/shorts/<id>`. */
const ID_PATHS = new Set(['shorts', 'embed', 'live', 'v']);

/**
 * The YouTube video id `yt-dlp` named a file with, such as `Title [dQw4w9WgXcQ].mp3`: the last `[…]` right before the
 * extension, holding exactly 11 id characters. False positives are accepted.
 * @param {string} name
 * @returns {string | null}
 */
export function videoIdFromFileName(name) {
	const stem = name.slice(0, name.length - extname(name).length);
	return FILE_NAME_ID.exec(stem)?.[1] ?? null;
}

/**
 * @param {string} videoId
 */
export function watchUrl(videoId) {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Reads a video id, and a playlist id when there is one, from the known forms of YouTube links: `watch?v=` on
 * `youtube.com` and its `m.` and `music.` hosts, `youtu.be/<id>`, and `/shorts/`, `/embed/`, `/live/` and `/v/`.
 * @param {string} link
 * @returns {{ videoId: string, playlistId: string | null } | null}
 */
export function parseYoutubeLink(link) {
	let url;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	const host = url.hostname.toLowerCase();
	const parts = url.pathname.split('/').filter(Boolean);
	let videoId = null;
	if (host === 'youtu.be') {
		videoId = parts[0] ?? null;
	} else if (YOUTUBE_HOSTS.has(host)) {
		videoId = parts[0] === 'watch' ? url.searchParams.get('v') : ID_PATHS.has(parts[0]) ? parts[1] ?? null : null;
	}
	if (videoId === null || !VIDEO_ID.test(videoId)) {
		return null;
	}
	return { videoId, playlistId: url.searchParams.get('list') || null };
}

/**
 * Where a file came from, for a file whose options file has none yet (DESIGN.md §3.3): an id in its name, else a link
 * found in its tags, else unknown.
 * @param {string} name
 * @param {string | null} tagLink
 * @returns {Source}
 */
export function guessSource(name, tagLink) {
	const fromName = videoIdFromFileName(name);
	if (fromName !== null) {
		return { origin: 'fileName', url: watchUrl(fromName), extractor: 'Youtube', videoId: fromName };
	}
	if (tagLink !== null) {
		const youtube = parseYoutubeLink(tagLink);
		return {
			origin: 'tags',
			url: tagLink,
			...(youtube && { extractor: 'Youtube', videoId: youtube.videoId }),
			...(youtube?.playlistId && { playlistId: youtube.playlistId }),
		};
	}
	return { origin: 'unknown' };
}

/**
 * A title without the id a file name carried (DESIGN.md §2.4). A title that is still the file name also loses its
 * extension, as downloads name their files; one the user changed only loses ` [<id>]`.
 * @param {string | undefined} title undefined while the options file has none, which shows the file name
 * @param {string} name
 * @param {string} videoId
 */
export function titleWithoutId(title, name, videoId) {
	if (title === undefined || title === name) {
		const stem = name.slice(0, name.length - extname(name).length);
		return stem.replaceAll(` [${videoId}]`, '').replaceAll(`[${videoId}]`, '').trim() || stem;
	}
	return title.replaceAll(` [${videoId}]`, '').replaceAll(`[${videoId}]`, '').trim() || title;
}
