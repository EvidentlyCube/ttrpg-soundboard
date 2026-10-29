/** @typedef {import('../logic/ports.js').SourceJson} SourceJson */

/**
 * @typedef {object} SourceRow one line of the metadata dialog (DESIGN.md §9.13)
 * @property {string} key the source's key, for the editor to come
 * @property {string} label
 * @property {string | null} value null when there is none, shown as "n/a"
 * @property {string | null} href where the value links to
 * @property {{ label: string, href: string } | null} extra a second link after the value
 */

/** @type {Record<SourceJson['origin'], string>} */
const ORIGIN_LABELS = {
	download: 'Downloaded',
	fileName: 'Found in the file name',
	tags: 'Found in the file\'s tags',
	unknown: 'Unknown',
	edited: 'Entered by hand',
};

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
	 * @param {string} key
	 * @param {string} label
	 * @param {string | null} value
	 * @param {string | null} [href]
	 * @param {SourceRow['extra']} [extra]
	 * @returns {SourceRow}
	 */
	const row = (key, label, value, href = null, extra = null) => ({ key, label, value, href: value === null ? null : href, extra });
	return [
		row('origin', 'Origin', source ? ORIGIN_LABELS[source.origin] ?? source.origin : null),
		row('url', 'Link', url, url !== null && /^https?:\/\//i.test(url) ? url : null),
		row('extractor', 'Site', source?.extractor ?? null),
		row('videoId', 'Video', videoId, youtube && videoId !== null ? youtubeWatchUrl(videoId) : null),
		row(
			'playlistId',
			'Playlist',
			playlistId,
			youtube && playlistId !== null ? youtubePlaylistUrl(playlistId) : null,
			youtube && playlistId !== null && videoId !== null ? { label: 'in playlist', href: youtubeWatchUrl(videoId, { playlistId }) } : null,
		),
		row(
			'chapter',
			'Chapter',
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
