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
 * 	order: PlaybackOrder, trackLooping: boolean, stopMode: StopMode, tracks: AudioFileJson[] }} PlaylistJson
 */
/** @typedef {import('./order-strategies.js').PlaybackOrder} PlaybackOrder */
/** @typedef {import('./playback-rules.js').StopMode} StopMode */
/** @typedef {{ version: number, playlists: PlaylistJson[], sounds: AudioFileJson[] }} LibraryJson */

/**
 * Timers, in milliseconds. In the browser this is `window`; in tests a fake clock that only moves when told to.
 * @typedef {object} Clock
 * @property {() => number} now milliseconds from some fixed starting point; only differences mean anything
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
 * @property {(looping: boolean) => void} setLooping while on, the voice starts over at its start point without a gap
 * 	instead of ending, and never fires `ended`
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
 * @property {string} [label] what the voice plays, as a person would name it; only the debug view reads it
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
 * @property {() => Promise<string[]>} fetchMissingWaveforms ids of the sounds and tracks that have no waveform yet
 * @property {(id: string) => Promise<Int8Array | null>} fetchWaveform null when there is none yet
 * @property {(id: string, peaks: Int8Array) => Promise<void>} saveWaveform
 * @property {() => Promise<boolean>} checkExternalChanges asks the server to compare the files' sizes and dates now;
 * 	resolves with whether files changed outside the app
 * @property {() => Promise<RefreshResult>} refresh asks the server to rebuild its library from the files
 * @property {() => Promise<{ tools: DownloadTools, job: (DownloadJob & { log: string[] }) | null }>} fetchDownload
 * @property {(url: string, options: { playlist: boolean }) => Promise<LinkProbe>} probeLink rejects with the server's
 * 	message when the link can't be used
 * @property {(request: DownloadRequest) => Promise<DownloadJob>} startDownload
 * @property {() => Promise<void>} dismissDownload cancels the running download, or forgets a finished one
 * @property {(item: { kind: ItemKind, id: string }) => Promise<LibraryChangeMessage[]>} deleteItem moves the item into
 * 	the server's trash; resolves with what changed and rejects with the server's message
 * @property {(id: string, to: string | null) => Promise<LibraryChangeMessage[]>} moveItem moves a sound or track into a
 * 	playlist, or a track out to the sounds (`to: null`); resolves with what changed and rejects with the server's message
 */

/** @typedef {'sound' | 'playlist' | 'track'} ItemKind */

/**
 * @typedef {{ type: 'library.added', sound: AudioFileJson }
 * 	| { type: 'library.added', playlist: PlaylistJson }
 * 	| { type: 'library.removed', soundId: string }
 * 	| { type: 'library.removed', trackId: string, playlistId: string }
 * 	| { type: 'library.removed', playlistId: string }} LibraryChangeMessage
 */

/**
 * @typedef {{ status: 'refreshed' }
 * 	| { status: 'invalid', errors: { path: string, message: string }[] }
 * 	| { status: 'restartNeeded', message: string }} RefreshResult
 */

/**
 * Messages the server pushes to the page.
 * @typedef {object} ServerEvents
 * @property {(onMessage: (message: ServerMessage) => void) => () => void} connect returns a disconnect
 * 	function; the connection is restored by itself after the server was unreachable
 */

/**
 * @typedef {{ type: 'externalChanges', pending: boolean }
 * 	| { type: 'download', job: DownloadJob | null, log?: string[] }
 * 	| { type: 'download.log', lines: string[], replaceLast: boolean }
 * 	| LibraryChangeMessage} ServerMessage
 * 	`log` comes with the first `download` message of every connection and replaces the log; `replaceLast`: the first
 * 	line replaces the last one already received
 */

/** @typedef {{ kind: 'sound' } | { kind: 'newPlaylist', title: string } | { kind: 'playlist', playlistId: string }} DownloadTarget */
/** @typedef {'waiting' | 'downloading' | 'converting' | 'done' | 'failed' | 'cancelled'} DownloadItemState */

/**
 * A download the server runs (DESIGN.md §5.4); only one at a time.
 * @typedef {object} DownloadJob
 * @property {string} id
 * @property {string} title what was looked up
 * @property {DownloadTarget} target
 * @property {string} targetTitle "Sound effects", or the playlist's title
 * @property {'running' | 'done' | 'failed' | 'cancelled'} state `failed` when any item failed
 * @property {{ title: string, state: DownloadItemState, error: string | null }[]} items one per file it adds
 * @property {number | null} current the index of the item being worked on
 * @property {number} added
 * @property {number} failed
 */

/** @typedef {{ ytDlp: string | null, ffmpeg: string | null }} DownloadTools the version of each program, or null when missing */

/**
 * @typedef {{ probeId: string, kind: 'file', url: string, name: string, size: number | null, contentType: string }
 * 	| { probeId: string, kind: 'video', url: string, id: string, title: string, duration: number | null, size: number | null,
 * 		extractor: string | null, chapters: { title: string, start: number, end: number }[], playlistAvailable: boolean }
 * 	| { probeId: string, kind: 'playlist', url: string, id: string, title: string, truncated: boolean,
 * 		entries: { id: string, title: string, duration: number | null, url: string, extractor: string | null }[] }} LinkProbe
 */

/**
 * @typedef {object} DownloadRequest
 * @property {string} probeId
 * @property {DownloadTarget} target
 * @property {number[] | null} [chapters] chapter indices to cut a video into; null keeps it whole
 * @property {string[]} [entries] ids of the playlist entries to download
 */

/**
 * Turns an audio file into its waveform: 1024 min/max byte pairs (DESIGN.md §6.3). Only the peaks leave the adapter;
 * the decoded audio is dropped before it returns.
 * @typedef {object} WaveformDecoder
 * @property {(url: string) => Promise<Int8Array>} decode
 */

/**
 * The options a Customize dialog changes, in seconds where they are times. The crossfade is for playlists only, the
 * start and end points for sounds only.
 * @typedef {{ title?: string, gain?: number, crossfade?: number, fadeIn?: number, fadeOut?: number, startAt?: number,
 * 	endAt?: number | null, order?: PlaybackOrder, trackLooping?: boolean, stopMode?: StopMode }} ItemOptions
 */

/**
 * @typedef {object} Logger
 * @property {(message: string, detail?: unknown) => void} warn
 * @property {(message: string, detail?: unknown) => void} error
 */

export {};
