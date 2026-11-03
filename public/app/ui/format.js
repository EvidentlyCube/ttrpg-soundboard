import { formatFixed } from './text.js';

/**
 * A file size in decimal units, as operating systems show them: `840 KB`, `1.4 GB`.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit++;
	}
	return unit === 0 ? `${value} B` : `${formatFixed(value, value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * A large size in decimal megabytes, or gigabytes from 1 GB on: `340 MB`, `4.2 MB`, `1.4 GB`. Never below `0.1 MB`,
 * so something in the trash never reads as nothing.
 * @param {number} bytes
 */
export function formatMegabytes(bytes) {
	const isGigabytes = bytes >= 1e9;
	const value = Math.max(bytes / (isGigabytes ? 1e9 : 1e6), 0.1);
	return `${formatFixed(value, value < 10 ? 1 : 0)} ${isGigabytes ? 'GB' : 'MB'}`;
}

/**
 * `m:ss`, or `h:mm:ss` from an hour on; `--:--` while the time is unknown.
 * @param {number | null} seconds
 */
export function formatTime(seconds) {
	if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
		return '--:--';
	}
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const paddedSeconds = String(total % 60).padStart(2, '0');
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
		: `${minutes}:${paddedSeconds}`;
}
