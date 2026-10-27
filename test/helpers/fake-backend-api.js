/** @typedef {import('../../public/app/logic/ports.js').BackendApi} BackendApi */
/** @typedef {import('../../public/app/logic/ports.js').LibraryJson} LibraryJson */
/** @typedef {import('../../public/app/logic/ports.js').Volumes} Volumes */
/** @typedef {import('../../public/app/logic/ports.js').ItemOptions} ItemOptions */

/** What every sound and track has without start and end points or fades. */
const NO_CLIP = { startAt: 0, endAt: null, fadeIn: 0, fadeOut: 0 };

/** @returns {LibraryJson} */
export function exampleLibrary() {
	return {
		version: 1,
		playlists: [
			{
				id: 'Combat',
				title: 'Combat',
				gain: 1,
				crossfade: 0,
				fadeIn: 0,
				fadeOut: 0,
				order: 'ordered',
				tracks: [
					{ id: 'Combat/1.mp3', title: 'Battle', format: 'mp3', size: 3_000_000, gain: 1, duration: 180, ...NO_CLIP, url: '/media/Combat/1.mp3' },
					{ id: 'Combat/2.ogg', title: 'Boss', format: 'ogg', size: 3_000_000, gain: 1, duration: 200, ...NO_CLIP, url: '/media/Combat/2.ogg' },
				],
			},
			{
				id: 'Tavern',
				title: 'Tavern',
				gain: 1,
				crossfade: 0,
				fadeIn: 0,
				fadeOut: 0,
				order: 'ordered',
				tracks: [{ id: 'Tavern/1.mp3', title: 'Song', format: 'mp3', size: 3_000_000, gain: 1, duration: 150, ...NO_CLIP, url: '/media/Tavern/1.mp3' }],
			},
		],
		sounds: [
			{ id: 'Boom.mp3', title: 'Boom', format: 'mp3', size: 1000, gain: 1, duration: 1.5, ...NO_CLIP, url: '/media/Boom.mp3' },
			{ id: 'Rain.ogg', title: 'Rain', format: 'ogg', size: 2_000_000, gain: 1, duration: 60, ...NO_CLIP, url: '/media/Rain.ogg' },
		],
	};
}

/**
 * A backend whose answers and failures tests set directly.
 * @implements {BackendApi}
 */
export class FakeBackendApi {
	library = exampleLibrary();
	/** @type {{ volumes: Volumes }} */
	settings = { volumes: { master: 1, music: 1, sfx: 1 } };
	/** @type {Error | null} */
	libraryError = null;
	/** @type {Error | null} */
	saveError = null;
	libraryRequests = 0;
	/** @type {{ volumes: Volumes, keepalive: boolean }[]} */
	saves = [];
	/** @type {{ soundId: string, options: ItemOptions, keepalive: boolean }[]} */
	soundSaves = [];
	/** @type {{ playlistId: string, options: ItemOptions, keepalive: boolean }[]} */
	playlistSaves = [];
	/** @type {{ trackId: string, options: ItemOptions, keepalive: boolean }[]} */
	trackSaves = [];

	async fetchLibrary() {
		this.libraryRequests++;
		if (this.libraryError) {
			throw this.libraryError;
		}
		return JSON.parse(JSON.stringify(this.library));
	}

	async fetchSettings() {
		return JSON.parse(JSON.stringify(this.settings));
	}

	/**
	 * @param {Volumes} volumes
	 * @param {{ keepalive: boolean }} options
	 */
	async saveVolumes(volumes, { keepalive }) {
		this.saves.push({ volumes, keepalive });
		if (this.saveError) {
			throw this.saveError;
		}
	}

	/**
	 * @param {string} soundId
	 * @param {ItemOptions} options
	 * @param {{ keepalive: boolean }} keepalive
	 */
	async saveSoundOptions(soundId, options, { keepalive }) {
		this.soundSaves.push({ soundId, options, keepalive });
		if (this.saveError) {
			throw this.saveError;
		}
	}

	/**
	 * @param {string} playlistId
	 * @param {ItemOptions} options
	 * @param {{ keepalive: boolean }} keepalive
	 */
	async savePlaylistOptions(playlistId, options, { keepalive }) {
		this.playlistSaves.push({ playlistId, options, keepalive });
		if (this.saveError) {
			throw this.saveError;
		}
	}

	/**
	 * @param {string} trackId
	 * @param {ItemOptions} options
	 * @param {{ keepalive: boolean }} keepalive
	 */
	async saveTrackOptions(trackId, options, { keepalive }) {
		this.trackSaves.push({ trackId, options, keepalive });
		if (this.saveError) {
			throw this.saveError;
		}
	}
}
