/**
 * Types for everything the logic layer receives from outside: the library data sent by the server, and the ports
 * the composition root injects (DESIGN.md §6). This module has no runtime code.
 */

/** @typedef {'mp3' | 'ogg'} AudioFormat */
/** @typedef {'master' | 'music' | 'sfx'} Bus */
/** @typedef {Record<Bus, number>} Volumes */

/**
 * @typedef {object} AudioFileJson
 * @property {string} id
 * @property {string} title
 * @property {AudioFormat} format
 * @property {number} size bytes
 * @property {number} gain linear multiplier for its own volume; 1 plays it as recorded
 * @property {number | null} duration seconds, measured by the server; null when unknown
 * @property {number} startAt seconds into the file where a sound starts playing
 * @property {number | null} endAt seconds into the file where a sound stops; null is the end of the file
 * @property {number} fadeIn seconds a sound takes to fade in; 0 is off
 * @property {number} fadeOut seconds of fading out before a sound's end; 0 is off
 * @property {string} url
 */

/**
 * Timings are in seconds; 0 is off.
 * @typedef {{ id: string, title: string, gain: number, crossfade: number, fadeIn: number, fadeOut: number,
 * 	order: PlaybackOrder, tracks: AudioFileJson[] }} PlaylistJson
 */
/** @typedef {import('./order-strategies.js').PlaybackOrder} PlaybackOrder */
/** @typedef {{ version: number, playlists: PlaylistJson[], sounds: AudioFileJson[] }} LibraryJson */

/**
 * Timers, in milliseconds. In the browser this is `window`; in tests a fake clock that only moves when told to.
 * @typedef {object} Clock
 * @property {(callback: () => void, milliseconds: number) => number} setTimeout
 * @property {(id: number) => void} clearTimeout
 * @property {(callback: () => void, milliseconds: number) => number} setInterval
 * @property {(id: number) => void} clearInterval
 */

/** @typedef {{ message: string }} VoiceError */

/**
 * One playing sound. Events never fire after `stop()`, and `ended` fires at most once.
 * @typedef {object} Voice
 * @property {() => void} play starts or resumes; a failure arrives later as an `error` event
 * @property {() => void} pause
 * @property {() => void} stop stops immediately and releases resources; safe to call twice
 * @property {(seconds: number) => void} seek
 * @property {number} position seconds
 * @property {number} duration seconds, NaN until `loaded`
 * @property {(target: number, seconds: number) => void} rampGain fades; independent of the voice's own gain
 * @property {(gain: number) => void} setGain the voice's own volume, a linear multiplier; changes are smoothed
 * @property {(type: 'loaded' | 'ended', handler: () => void) => void} on
 * @property {(handler: (error: VoiceError) => void) => void} onError
 */

/**
 * A decoded sound held in memory.
 * @typedef {{ memoryBytes: number }} BufferHandle
 */

/**
 * @typedef {object} AudioEngine
 * @property {() => void} unlock creates or resumes the audio context; must run synchronously inside a user gesture
 * @property {(type: 'suspended' | 'resumed', handler: () => void) => void} on
 * @property {(format: AudioFormat) => boolean} canPlay
 * @property {(bus: Bus, gain: number) => void} setBusGain
 * @property {(options: VoiceOptions & { url: string }) => Voice} createStreamVoice
 * @property {(url: string) => Promise<BufferHandle>} loadBuffer
 * @property {(options: VoiceOptions & { buffer: BufferHandle }) => Voice} createBufferVoice
 */

/**
 * @typedef {object} VoiceOptions
 * @property {Bus} bus
 * @property {number} [gain] the voice's own volume; defaults to 1
 * @property {number} [startAt] seconds into the file where playback starts; defaults to 0
 * @property {number | null} [endAt] seconds into the file where the voice stops and fires `ended`; null or left out is
 * 	the end of the file
 */

/**
 * @typedef {object} BackendApi
 * @property {() => Promise<LibraryJson>} fetchLibrary
 * @property {() => Promise<{ volumes: Volumes }>} fetchSettings
 * @property {(volumes: Volumes, options: { keepalive: boolean }) => Promise<void>} saveVolumes
 * @property {(soundId: string, options: ItemOptions, request: { keepalive: boolean }) => Promise<void>} saveSoundOptions
 * @property {(playlistId: string, options: ItemOptions, request: { keepalive: boolean }) => Promise<void>} savePlaylistOptions
 * @property {(trackId: string, options: ItemOptions, request: { keepalive: boolean }) => Promise<void>} saveTrackOptions
 */

/**
 * The options a Customize dialog changes, in seconds where they are times. The crossfade is for playlists only, the
 * start and end points for sounds only.
 * @typedef {{ title?: string, gain?: number, crossfade?: number, fadeIn?: number, fadeOut?: number, startAt?: number,
 * 	endAt?: number | null, order?: PlaybackOrder }} ItemOptions
 */

/**
 * @typedef {object} Logger
 * @property {(message: string, detail?: unknown) => void} warn
 * @property {(message: string, detail?: unknown) => void} error
 */

export {};
