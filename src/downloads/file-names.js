import { extname } from 'node:path';

/** Leaves room for ` (2)` and the extension within the 255 bytes most file systems allow. */
const MAX_STEM_LENGTH = 120;
// Characters that some file system refuses, and control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * A name that is safe on every file system and doesn't hide the file: a leading dot would make the scanner ignore
 * it (DESIGN.md §2.1).
 * @param {string} name with or without an extension
 * @param {string} fallback used when nothing is left
 */
export function safeFileName(name, fallback = 'download') {
	const cleaned = name.replace(UNSAFE_CHARACTERS, '').replace(/^[\s.]+/, '').trim();
	const extension = extname(cleaned);
	const stem = cleaned.slice(0, cleaned.length - extension.length).slice(0, MAX_STEM_LENGTH).trim();
	return stem === '' ? fallback : `${stem}${extension}`;
}

/**
 * @param {string} name
 * @param {string} extension such as `.ogg`
 */
export function withExtension(name, extension) {
	return `${stemOf(name)}${extension}`;
}

/**
 * The name `yt-dlp --split-chapters` would give a chapter: `Title - 003 Chapter [id].ogg`.
 * @param {string} downloadName what yt-dlp named the whole video, `Title [id].webm`
 * @param {number} chapterNumber counting from 1
 * @param {string} chapterTitle
 * @param {string} videoId
 */
export function chapterFileName(downloadName, chapterNumber, chapterTitle, videoId) {
	const tag = ` [${videoId}]`;
	const stem = stemOf(downloadName);
	const base = stem.endsWith(tag) ? stem.slice(0, -tag.length) : stem;
	const chapter = `${String(chapterNumber).padStart(3, '0')} ${chapterTitle.replace(UNSAFE_CHARACTERS, '').trim()}`;
	return safeFileName(`${base} - ${chapter}${stem.endsWith(tag) ? tag : ''}.ogg`);
}

/**
 * The title for a downloaded file (DESIGN.md §2.4): its name without the extension and without the id tag yt-dlp added.
 * Other brackets belong to the title and stay.
 * @param {string} name
 * @param {string | null} videoId
 */
export function titleFromFileName(name, videoId) {
	const stem = stemOf(name);
	const title = videoId === null ? stem : stem.replaceAll(` [${videoId}]`, '').replaceAll(`[${videoId}]`, '');
	return title.trim() || stem;
}

/**
 * The first of `name`, `name (2)`, `name (3)`… that isn't taken.
 * @param {string} name
 * @param {(candidate: string) => Promise<boolean>} isTaken
 */
export async function uniqueName(name, isTaken) {
	const extension = extname(name);
	const stem = name.slice(0, name.length - extension.length);
	let candidate = name;
	for (let number = 2; await isTaken(candidate); number++) {
		candidate = `${stem} (${number})${extension}`;
	}
	return candidate;
}

/** @param {string} name */
function stemOf(name) {
	const extension = extname(name);
	return extension === '' ? name : name.slice(0, -extension.length);
}
