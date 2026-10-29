/** @typedef {import('./playlist-player.js').PlaylistSnapshot} PlaylistSnapshot */
/** @typedef {import('./playlist-player.js').PlaylistState} PlaylistState */

/**
 * What the host tells the remotes (DESIGN.md §5, §6): the titles and ids of everything on the board, which of it
 * plays, and what Panic Stop would do. It holds no audio details and never the progress, so it changes only when someone
 * does something.
 * @typedef {object} RemoteState
 * @property {'fade' | 'now'} panic
 * @property {{ id: string, title: string, playable: boolean }[]} playlists in the board's order
 * @property {{ id: string, title: string, playable: boolean }[]} sounds in the board's order
 * @property {{ id: string, title: string, state: PlaylistState, trackTitle: string | null }[]} players the playlists that are
 * 	loading, playing or paused, in the order they started
 * @property {string[]} activeSounds the sounds with a live instance
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
		playlists: library.playlists.map(({ id, title, tracks }) => ({ id, title, playable: tracks.some(isPlayable) })),
		sounds: library.sounds.map((sound) => ({ id: sound.id, title: sound.title, playable: isPlayable(sound) })),
		players: active.flatMap(({ playlistId, state, track }) => {
			const playlist = library.playlists.find((entry) => entry.id === playlistId);
			return playlist ? [{ id: playlistId, title: playlist.title, state, trackTitle: track?.title ?? null }] : [];
		}),
		activeSounds,
	};
}
