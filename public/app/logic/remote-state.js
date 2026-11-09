import { backgroundStyleOf } from './background-style.js';

/** @typedef {import('./playlist-player.js').PlaylistSnapshot} PlaylistSnapshot */
/** @typedef {import('./playlist-player.js').PlaylistState} PlaylistState */

/**
 * What the host tells the remotes (DESIGN.md §5, §6): the titles and ids of everything on the board, which of it
 * plays, and what Panic Stop would do. It holds no audio details and never the progress, so it changes only when someone
 * does something.
 * @typedef {object} RemoteState
 * @property {'fade' | 'now'} panic
 * @property {RemotePlaylist[]} playlists in the board's order
 * @property {RemoteSound[]} sounds in the board's order
 * @property {{ id: string, title: string, state: PlaylistState, trackTitle: string | null }[]} players the playlists that are
 * 	loading, playing or paused, in the order they started
 * @property {string[]} activeSounds the sounds with a live instance
 */

/**
 * A playlist's button on the remote, with its image when it has one: the remote fetches it by the playlist's id and
 * this version (DESIGN.md §9.15).
 * @typedef {{ id: string, title: string, playable: boolean, background: { version: string } | null }
 * 	& import('./background-style.js').BackgroundStyle} RemotePlaylist
 */
/**
 * A sound's button on the remote, with its image as a playlist's has.
 * @typedef {{ id: string, title: string, playable: boolean, background: { version: string } | null }
 * 	& import('./background-style.js').BackgroundStyle} RemoteSound
 */

/**
 * @param {object} source
 * @param {'fade' | 'now'} source.panic
 * @param {import('./ports.js').LibraryJson} source.library
 * @param {(file: import('./ports.js').AudioFileJson) => boolean} source.isPlayable
 * @param {PlaylistSnapshot[]} source.active in the order the playlists started
 * @param {string[]} source.activeSounds
 * @returns {RemoteState}
 */
export function buildRemoteState({ panic, library, isPlayable, active, activeSounds }) {
	return {
		panic,
		playlists: library.playlists.map((playlist) => ({
			id: playlist.id,
			title: playlist.title,
			playable: playlist.tracks.some(isPlayable),
			background: playlist.background && { version: playlist.background.version },
			...backgroundStyleOf(playlist),
		})),
		sounds: library.sounds.map((sound) => ({
			id: sound.id,
			title: sound.title,
			playable: isPlayable(sound),
			background: sound.background && { version: sound.background.version },
			...backgroundStyleOf(sound),
		})),
		players: active.flatMap(({ playlistId, state, track }) => {
			const playlist = library.playlists.find((entry) => entry.id === playlistId);
			return playlist ? [{ id: playlistId, title: playlist.title, state, trackTitle: track?.title ?? null }] : [];
		}),
		activeSounds,
	};
}
