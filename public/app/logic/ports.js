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
 * @property {string} url
 */

/** @typedef {{ id: string, title: string, tracks: AudioFileJson[] }} PlaylistJson */
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
 * @property {(target: number, seconds: number) => void} rampGain
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
 * @property {(options: { url: string, bus: Bus }) => Voice} createStreamVoice
 * @property {(url: string) => Promise<BufferHandle>} loadBuffer
 * @property {(options: { buffer: BufferHandle, bus: Bus }) => Voice} createBufferVoice
 */

/**
 * @typedef {object} BackendApi
 * @property {() => Promise<LibraryJson>} fetchLibrary
 * @property {() => Promise<{ volumes: Volumes }>} fetchSettings
 * @property {(volumes: Volumes, options: { keepalive: boolean }) => Promise<void>} saveVolumes
 */

/**
 * @typedef {object} Logger
 * @property {(message: string, detail?: unknown) => void} warn
 * @property {(message: string, detail?: unknown) => void} error
 */

export {};
