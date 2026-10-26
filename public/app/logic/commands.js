import { InvalidCommandError } from './errors.js';
import { isTransition } from './transitions.js';

/** @typedef {import('./ports.js').Bus} Bus */
/** @typedef {import('./transitions.js').Transition} Transition */

/**
 * Everything the UI, or later a remote control, can ask the soundboard to do. Commands are plain data, so they can be
 * sent over a connection unchanged (DESIGN.md §6).
 * @typedef {{ type: 'sound.play' | 'sound.stop', soundId: string }
 * 	| { type: 'playlist.toggle' | 'playlist.pause' | 'playlist.resume', playlistId: string }
 * 	| { type: 'playlist.play' | 'playlist.stop' | 'playlist.next' | 'playlist.previous', playlistId: string, transition?: Transition }
 * 	| { type: 'playlist.jump', playlistId: string, trackIndex: number, transition?: Transition }
 * 	| { type: 'playlist.seek', playlistId: string, seconds: number }
 * 	| { type: 'volume.set', bus: Bus, value: number }
 * 	| { type: 'sound.customize', soundId: string, title?: string, gain?: number }
 * 	| { type: 'playlist.customize', playlistId: string, title?: string, gain?: number, crossfade?: number, fadeIn?: number,
 * 		fadeOut?: number }
 * 	| { type: 'track.customize', trackId: string, title?: string }} Command
 */

/**
 * `optional` fields may be left out, but at least one of them must be given.
 * @type {Record<Command['type'], { strings?: string[], numbers?: string[], transition?: boolean, optional?: Record<string, 'string' | 'number'> }>}
 */
const SHAPES = {
	'sound.play': { strings: ['soundId'] },
	'sound.stop': { strings: ['soundId'] },
	'playlist.toggle': { strings: ['playlistId'] },
	'playlist.pause': { strings: ['playlistId'] },
	'playlist.resume': { strings: ['playlistId'] },
	'playlist.play': { strings: ['playlistId'], transition: true },
	'playlist.stop': { strings: ['playlistId'], transition: true },
	'playlist.next': { strings: ['playlistId'], transition: true },
	'playlist.previous': { strings: ['playlistId'], transition: true },
	'playlist.jump': { strings: ['playlistId'], numbers: ['trackIndex'], transition: true },
	'playlist.seek': { strings: ['playlistId'], numbers: ['seconds'] },
	'volume.set': { strings: ['bus'], numbers: ['value'] },
	'sound.customize': { strings: ['soundId'], optional: { title: 'string', gain: 'number' } },
	'playlist.customize': {
		strings: ['playlistId'],
		optional: { title: 'string', gain: 'number', crossfade: 'number', fadeIn: 'number', fadeOut: 'number' },
	},
	'track.customize': { strings: ['trackId'], optional: { title: 'string' } },
};

/**
 * Checks that a value is a well-formed command. Whether the ids exist is checked when it runs.
 * @param {unknown} value
 * @returns {Command}
 */
export function validateCommand(value) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new InvalidCommandError('A command must be an object');
	}
	const command = /** @type {Record<string, unknown>} */ (value);
	const shape = Object.hasOwn(SHAPES, String(command.type)) ? SHAPES[/** @type {Command['type']} */ (command.type)] : null;
	if (!shape) {
		throw new InvalidCommandError(`Unknown command "${String(command.type)}"`);
	}
	for (const key of shape.strings ?? []) {
		if (typeof command[key] !== 'string') {
			throw new InvalidCommandError(`"${key}" must be a string in ${command.type}`);
		}
	}
	for (const key of shape.numbers ?? []) {
		if (typeof command[key] !== 'number') {
			throw new InvalidCommandError(`"${key}" must be a number in ${command.type}`);
		}
	}
	if (shape.transition && command.transition !== undefined && !isTransition(command.transition)) {
		throw new InvalidCommandError(`"transition" must be "default" or "instant" in ${command.type}`);
	}
	if (shape.optional) {
		const given = Object.entries(shape.optional).filter(([key]) => command[key] !== undefined);
		if (given.length === 0) {
			throw new InvalidCommandError(`${command.type} needs ${Object.keys(shape.optional).map((key) => `"${key}"`).join(' or ')}`);
		}
		for (const [key, type] of given) {
			if (typeof command[key] !== type) {
				throw new InvalidCommandError(`"${key}" must be a ${type} in ${command.type}`);
			}
		}
	}
	return /** @type {Command} */ (value);
}
