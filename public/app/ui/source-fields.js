import { t } from './text.js';

/** @typedef {import('../logic/ports.js').SourceJson} SourceJson */

/**
 * @typedef {object} SourceRow one line of the metadata dialog (DESIGN.md §9.13)
 * @property {string} key the source's key, for the editor to come
 * @property {string} label
 * @property {string | null} value null when there is none, shown as "n/a"
 * @property {string | null} href where the value links to
 * @property {{ label: string, href: string } | null} extra a second link after the value
 */

const ORIGINS = ['download', 'fileName', 'tags', 'unknown', 'edited'];

/** @param {string} origin */
const originLabel = (origin) => (ORIGINS.includes(origin) ? t(`metadata.origin.${/** @type {SourceJson['origin']} */ (origin)}`) : origin);

/**
 * The rows the metadata dialog shows for a file's source, in order, each with its link when one can be built. YouTube
 * links are rebuilt from the ids, so they work whatever link the source recorded.
 * @param {SourceJson | null | undefined} source
 * @returns {SourceRow[]}
 */
export function sourceRows(source) {
	const youtube = /^youtube/i.test(source?.extractor ?? '');
	const videoId = source?.videoId ?? null;
	const playlistId = source?.playlistId ?? null;
	const chapter = source?.chapter ?? null;
	const chapterStart = source?.chapterStart ?? null;
	const url = source?.url ?? null;
	/**
	 * @param {'origin' | 'url' | 'extractor' | 'videoId' | 'playlistId' | 'chapter'} key
	 * @param {string | null} value
	 * @param {string | null} [href]
	 * @param {SourceRow['extra']} [extra]
	 * @returns {SourceRow}
	 */
	const row = (key, value, href = null, extra = null) => ({ key, label: t(`metadata.field.${key}`), value, href: value === null ? null : href, extra });
	return [
		row('origin', source ? originLabel(source.origin) : null),
		row('url', url, url !== null && /^https?:\/\//i.test(url) ? url : null),
		row('extractor', source?.extractor ?? null),
		row('videoId', videoId, youtube && videoId !== null ? youtubeWatchUrl(videoId) : null),
		row(
			'playlistId',
			playlistId,
			youtube && playlistId !== null ? youtubePlaylistUrl(playlistId) : null,
			youtube && playlistId !== null && videoId !== null ? { label: t('metadata.inPlaylist'), href: youtubeWatchUrl(videoId, { playlistId }) } : null,
		),
		row(
			'chapter',
			chapter === null ? null : String(chapter),
			youtube && videoId !== null && chapterStart !== null ? youtubeWatchUrl(videoId, { start: chapterStart }) : null,
		),
	];
}

/**
 * @param {string} videoId
 * @param {{ playlistId?: string, start?: number }} [options] `start` in seconds; YouTube takes whole ones
 */
export function youtubeWatchUrl(videoId, { playlistId, start } = {}) {
	const params = new URLSearchParams({ v: videoId });
	if (playlistId !== undefined) {
		params.set('list', playlistId);
	}
	if (start !== undefined) {
		params.set('t', `${Math.floor(start)}s`);
	}
	return `https://www.youtube.com/watch?${params}`;
}

/** @param {string} playlistId */
export function youtubePlaylistUrl(playlistId) {
	return `https://www.youtube.com/playlist?${new URLSearchParams({ list: playlistId })}`;
}
