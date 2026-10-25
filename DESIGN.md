# Soundboard — Design

This is the specification the app is built from. It is a living document: it changes as the project evolves, and **every change to it is reviewed by hand by the project owner** before work builds on it.
Anything marked **[FUTURE]** is out of scope for now, but the design must leave room for it (see §12).

---

## 1. Overview

A local soundboard. A Node.js server scans a directory of audio files and serves a vanilla-JS web app. The browser does all audio playback.

```
node index.js <path-to-audio-directory> [--port <number>] [--verbose]
```

- The server listens on `127.0.0.1` only. The default port is `3000`.
- Output is quiet by default: the startup summary, warnings and errors. `--verbose` also logs every HTTP request (§5.2).
- After startup it prints `Soundboard running at http://127.0.0.1:3000`. The user opens that URL themselves.
- It is always started by hand from a terminal. There is no unattended mode and no `--yes` option.

### 1.1 Constraints

| Area | Decision |
|---|---|
| Runtime | Node **24.14.0** (`"engines": { "node": ">=24.14.0" }`) |
| Runtime dependencies | **None.** The app runs with nothing but Node and a browser. |
| Dev dependencies | Tooling only, never imported by app code: `typescript` and `@types/node` (type-checking JSDoc), `eslint`, `@eslint/js`, `@stylistic/eslint-plugin` and `globals` (linting and formatting) |
| Language | Plain `.js` with JSDoc types. No build or compile step. The browser loads the source files directly as ES modules. |
| Type-checking | `tsc --noEmit` with `checkJs` and `strict`, across three projects with different globals (§10.1) |
| Formatting | ESLint with `@stylistic`, auto-fixed with `--fix`. **Not Prettier**: it always puts `&&`, `\|\|` and `?:` at the end of a line, and has no option to change that. Multi-line expressions put the operator at the **start** of the line (`@stylistic/operator-linebreak: before`). |
| Module system | ES modules everywhere (`"type": "module"`) |
| Tests | `node --test` (built-in test runner and `node:assert/strict`) |
| Browsers | Current desktop Chrome, Firefox and **Safari** |
| Touch | No special handling. Touch users may not be able to open the context menus. |
| Code style | Tabs for indentation. Domain-driven separation. TDD for logic. |
| Memory/CPU | Stream files over HTTP Range requests. The server never holds audio in memory. The browser holds decoded audio only for small sound effects, within a fixed memory budget. |
| Target machine | MacBook Neo, 8 GB RAM, macOS, Safari as the likely browser, used at the table during RPG sessions (see §14) |

---

## 2. Audio directory layout

```
<root>/
├── .soundboard                 ← marker and app settings (version, volumes)
├── Explosion.mp3               ← sound effect
├── Explosion.mp3.json          ← its options
├── Door creak.ogg
├── Door creak.ogg.json
├── Combat.json                 ← options for the playlist "Combat/"
├── Combat/                     ← playlist
│   ├── 01 Battle.mp3
│   ├── 01 Battle.mp3.json
│   └── Boss/                   ← nested subdirectory; merged into "Combat" once accepted
│       ├── Phase 1.ogg
│       └── Phase 1.ogg.json
└── Tavern.json / Tavern/ …
```

### 2.1 Classification rules

The scanner applies these rules in order:

1. Names starting with `.` (files or directories, at any depth) are **ignored**. This includes `.soundboard`.
2. **Symlinks are ignored**, with a warning, to avoid loops and files outside the root.
3. In the root:
   - Each directory is a **playlist**. Its ID is the directory name.
   - A file with a supported audio extension is a **sound effect**.
   - `<name>.<ext>.json`, where `<name>.<ext>` is an audio file in the root, is that **sound's options file**.
   - `<dir>.json`, where `<dir>/` is a directory in the root, is that **playlist's options file**.
   - Any other `.json` file is an **orphan options file**: warning, then ignored.
4. Inside a playlist directory, at any depth:
   - A supported audio file is a **track**. Its ID is its path relative to the root, using `/`.
   - `<file>.json` next to a track is that **track's options file**. Other `.json` files are orphans.
   - A subdirectory is a **nested subdirectory** (§3.3). Its tracks belong to the top-level playlist.
5. Supported extensions, matched case-insensitively: `.mp3` and `.ogg`.
6. Known but unsupported audio extensions (`.wav .flac .m4a .aac .opus .wma .aif .aiff .webm .mp4`) are **reported as warnings** and skipped. All other files are ignored silently.
7. A playlist with no tracks gets a warning and is **hidden** from the UI.

### 2.2 Sorting

All sorting uses `new Intl.Collator('en', { numeric: true, sensitivity: 'base' })`, so `2` sorts before `10`.

- Playlists and sounds are sorted by **title**.
- Tracks are sorted by **relative path** inside the playlist. A subdirectory's tracks therefore follow the parent folder's files in path order.

### 2.3 File formats

`.soundboard`
```json
{
	"version": 1,
	"volumes": { "master": 1, "music": 1, "sfx": 1 }
}
```
- If the version is newer than the app supports, the app stops with a fatal error.
- `volumes` is optional. A missing bus defaults to `1`. Each value must be a number from `0` to `1` (the slider position, not the gain).
- The server rewrites this file whenever the browser saves volumes (§5.2), keeping unknown keys.

Sound or track options (`Explosion.mp3.json`)
```json
{ "title": "Big Explosion" }
```

Playlist options (`Combat.json`)
```json
{
	"title": "Combat",
	"includedSubdirectories": ["Boss", "Boss/Phase 2"]
}
```
- `includedSubdirectories` lists paths relative to the playlist directory, using `/`. Every depth is listed explicitly.
- Listed directories that no longer exist are ignored. They are not removed.

**Validation (fatal).** Any options file or `.soundboard` that fails `JSON.parse`, is not an object, or has the wrong type for a known key (`title` must be a non-empty string, `includedSubdirectories` must be an array of strings, `volumes.*` must be numbers in `0..1`) is an error. The scanner gathers **all** such errors, prints them in red with their file paths, and exits with code `1` **before asking any questions or writing anything**. The user must fix or delete those files.

**Unknown keys are preserved.** When the app rewrites a playlist options file (§3.3), it reads, merges and writes back the whole object, so keys from future versions survive.

**Writes.** Files are written as JSON with tab indentation and a trailing newline. Each write goes to `<file>.tmp` and is then `rename`d into place, so a crash cannot leave a half-written file.

### 2.4 Default titles

- A sound or track uses its metadata title if one was found and accepted (§3). Otherwise it uses the **filename exactly as it is, extension included** (`01_battle-theme.mp3`).
- A playlist uses the directory name.

---

## 3. Bootstrap (CLI)

Bootstrap runs before the HTTP server starts. The decision logic is a pure domain service, `BootstrapService`. Terminal input and output go through injected ports (`Prompter.confirm(message) → Promise<boolean>` and `Reporter`), so the whole flow can be tested with fakes.

Prompts use `node:readline/promises` and accept `y/N`, with **No** as the default. Colors use ANSI codes: red for nested directories and errors, yellow for warnings. Colors are turned off when `NO_COLOR` is set or stdout is not a TTY.

### 3.1 Steps common to both modes

1. Parse arguments. If the path is missing or not a directory, print usage and exit `1`.
2. **Scan** the tree (§2.1). Scanning reads directory entries only, never file contents.
3. **Validate** every existing options file and `.soundboard` (§2.3). Any error is fatal.
4. **Report warnings**: unsupported audio files, orphan options files, symlinks, empty playlists. These are printed for information and never stop the app.

### 3.2 First run (no `.soundboard`)

5. **Nested subdirectories.** If any exist, print the first 10 in red as `Combat/Boss`, followed by `…and N more` when there are more. Then ask:
   `Nested directories will be merged into their playlists. Continue? [y/N]`
   - **No:** exit `0` without writing anything.
   - **Yes:** each one is recorded in its playlist's `includedSubdirectories` (written in step 7).
6. **Metadata titles.** For every audio file **without** an options file, try to read a title (§4). List the files where one was found, as `path → "Title"`, then ask:
   `Use these titles in the generated options files? [y/N]`
   - No means filenames are used for all of them.
7. **Write**:
   - An options file for every sound and track that lacks one. The title comes from step 6, or the filename.
   - An options file for every playlist that lacks one. The title is the directory name, plus the accepted subdirectories.
   - Playlist options files that already exist get the accepted subdirectories merged in.
   - **`.soundboard` last**, as `{ "version": 1, "volumes": { "master": 1, "music": 1, "sfx": 1 } }`. If anything fails before this point, the next run is still treated as a first run.

### 3.3 Later runs (`.soundboard` exists)

5. **New nested subdirectories.** These are subdirectories not listed in the playlist's `includedSubdirectories`. A brand-new playlist has none listed, so all of its subdirectories count as new. If there are any, print and ask exactly as in step 5 above. No exits `0`; Yes appends them to the list and writes the file.
6. **Missing options files.** For every audio file without one, generate it **without asking**: the metadata title if found, otherwise the filename. Do the same for missing playlist options files, as in §3.2 step 7.

### 3.4 Result

Bootstrap returns an in-memory `Library` (§5.1) and the parsed `Settings` from `.soundboard`. The server keeps only these, never file contents. **[FUTURE]** Rescanning while running, whether by a button or by watching the directory.

---

## 4. Metadata extraction (no dependencies)

`metadata/readTitle(filePath) → Promise<string | null>`. It never throws for malformed data; it returns `null` instead. It reads through a file handle with bounded reads and never loads the whole file.

### 4.1 MP3: ID3v2, falling back to ID3v1

- **ID3v2.2, 2.3 and 2.4.** Read the 10-byte header (`"ID3"`, version, flags, syncsafe size). Skip the extended header if present. Walk frame headers one at a time, reading only headers and skipping over frame bodies, until the title frame (`TIT2`, or `TT2` in v2.2) is found or the tag ends.
  - Frame sizes are syncsafe in v2.4 and plain 32-bit in v2.3.
  - Text encodings: `0` ISO-8859-1, `1` UTF-16 with BOM, `2` UTF-16BE, `3` UTF-8. Trim trailing `\0` and whitespace.
  - If tag-wide unsynchronization is set (v2.3), read the whole tag (giving up beyond **2 MB**), reverse the unsynchronization, then parse. For v2.4, honor the per-frame unsynchronization flag on the title frame only.
- **ID3v1.** If there is no ID3v2 title, read the last 128 bytes. If they start with `TAG`, bytes 3–32 hold the title in ISO-8859-1, trimmed.

### 4.2 OGG: Vorbis comments

- Read Ogg pages (`"OggS"` capture pattern, segment table) and reassemble packets until the **second** logical packet, which is the comment header. Stop after reading **1 MB**, because comment packets can hold embedded cover art.
- Recognize `\x03vorbis` (Vorbis) and `OpusTags` (Opus in Ogg). Parse the vendor string, then the comment list. The value of the first `TITLE=` entry (key matched case-insensitively) is the title, decoded as UTF-8.
- Other codecs in an Ogg container return `null`.

### 4.3 Tests

Tests build tag bytes in code (helpers such as `buildId3v23({ title, encoding })` and `buildOggVorbis({ comments })`) and write them to temporary files, so no binary fixtures are committed. Covered cases: each ID3 version and encoding, the v1 fallback, unsynchronization, a missing title, truncated or garbage data, a comment header split across pages, and the read limit.

---

## 5. Backend

### 5.1 Domain model (`src/library/`)

```js
Library  { root, playlists: Playlist[], sounds: Sound[], files: Map<id, AudioFile> }
Playlist { id, title, tracks: AudioFile[], includedSubdirectories: string[] }
AudioFile{ id /* root-relative POSIX path */, title, format: 'mp3'|'ogg', size, absolutePath }
Settings { volumes: { master, music, sfx } }   // backed by SettingsStore → .soundboard
```

`SettingsStore` keeps the current settings in memory and writes them back to `.soundboard`. It uses the same read-merge-write and atomic rename as the options files (§2.3). Writes are **serialized**: one in flight at a time, and only the newest pending value is written next, so quick slider changes can't interleave or arrive out of order.

### 5.2 HTTP API (`src/http/`, built on `node:http`)

The server knows nothing about playback state. That keeps **[FUTURE]** LAN and remote control possible without changing the API (§12).

| Method | Path | Response |
|---|---|---|
| GET | `/` and static assets | Files from `public/`, with a MIME map. Path traversal guard: resolve, then check that the path is still inside `public/`. 404 otherwise. |
| GET | `/api/library` | JSON (below), `Cache-Control: no-store` |
| GET | `/api/settings` | `{ "volumes": { "master": 1, "music": 0.8, "sfx": 1 } }` |
| PUT | `/api/settings/volumes` | Body `{ master?, music?, sfx? }` (numbers in `0..1`). Merged into the settings and saved. Returns the full settings. `400` for invalid input. |
| GET, HEAD | `/media/<encoded id>` | The audio file, streamed |

`/api/library`
```json
{
	"version": 1,
	"playlists": [
		{ "id": "Combat", "title": "Combat", "tracks": [
			{ "id": "Combat/01 Battle.mp3", "title": "Battle", "format": "mp3", "size": 4194304, "url": "/media/Combat/01%20Battle.mp3" }
		] }
	],
	"sounds": [
		{ "id": "Explosion.mp3", "title": "Big Explosion", "format": "mp3", "size": 48213, "url": "/media/Explosion.mp3" }
	]
}
```

**Media streaming.** Safari refuses to play media unless the server answers Range requests correctly, so this has to be exact.
- Each path segment is URL-decoded and the result is looked up in `Library.files`. Only indexed files can be served; anything else is a 404. The filesystem is never accessed with a path the user controls.
- `Accept-Ranges: bytes`, `Content-Type` (`audio/mpeg` or `audio/ogg`), `Content-Length`, `Last-Modified`, `ETag` (built from size and mtime).
- A `Range: bytes=a-b`, `a-` or `-n` request gets a `206` with `Content-Range`. An unsatisfiable range gets a `416` with `Content-Range: bytes */size`. Multiple ranges are not supported; only the first is served.
- The body is `fs.createReadStream(path, { start, end })` piped with `stream.pipeline`. The stream is destroyed when the client disconnects.
- `HEAD` returns the same headers with no body.

Other server behavior:
- Unexpected errors (500s, failed streams) are always printed to stderr with their stack trace.
- With `--verbose`, each request is logged to stdout when its response finishes or the client disconnects:
  `GET /media/Combat/01%20Battle.mp3 206 bytes=0-1023 12ms`. That's the method, the raw path, the status, the `Range` header if there was one, and the duration. A request whose client disconnected first ends with `(aborted)`.
- If the port is already in use, print a clear error and exit `1`.
- On SIGINT or SIGTERM, close the server and exit `0`.

---

## 6. Frontend architecture

```
UI layer (DOM)  ──commands──▶  Soundboard (logic facade)  ──▶  AudioEngine port
     ▲                              │                              ▲
     └──────────events──────────────┘                ┌─────────────┴────────────┐
                                                WebAudioEngine            FakeAudioEngine
                                                (browser)                 (tests, manual clock)
```

- `public/app/logic/**` **must not touch** `window`, `document` or any audio API. Everything it needs is injected: the `AudioEngine`, a `Clock`/timer port, and a `BackendApi` port (`fetchLibrary()`, `fetchSettings()`, `saveVolumes(volumes, { keepalive })`). Node imports and tests it directly.
- The UI calls only the facade's methods and listens to its events. The UI never reads logic internals.
- **Commands and events are plain, serializable objects.** Each facade method builds a command (`{ type: 'playlist.next', playlistId, transition: 'instant' }`) and passes it to `dispatch(command)`. Events are `{ type, ...payload }`. This is what lets **[FUTURE]** remote control from a phone forward commands and events over a socket unchanged.

### 6.1 Facade API (`Soundboard`)

```js
// lifecycle
start() → Promise<void>                   // called from the splash screen click (§9.0): unlock audio,
                                          // fetch library + settings, apply volumes, emit 'app.ready'
unlockAudio()                             // UI also calls this synchronously at the start of every
                                          // click handler, to recover if Safari suspended the context

// sounds (no transitions; sounds have no rules)
playSound(soundId)
stopSound(soundId)                        // stops all instances of that sound, instantly

// playlists; transition is 'default' (follow the playlist's rules) or 'instant'.
// Omitted means 'default'.
togglePlaylist(playlistId)                // tile click: play if idle, otherwise stop ('default')
playPlaylist(playlistId, { transition })
stopPlaylist(playlistId, { transition })
nextTrack(playlistId, { transition })
previousTrack(playlistId, { transition })
jumpToTrack(playlistId, trackIndex, { transition })
seek(playlistId, seconds)
pausePlaylist(playlistId)
resumePlaylist(playlistId)

// volume (value is 0..1, the slider position); saved to .soundboard (§6.4)
setVolume(bus, value)                     // bus: 'master' | 'music' | 'sfx'
flushSettings()                           // UI calls this on 'pagehide' to save a pending change

// queries (read-only snapshots)
getLibrary(), getPlaylistSnapshot(id), getActivePlaylists(), getVolumes(), isSoundActive(id)

dispatch(command)                         // the methods above are thin wrappers around this
on(type, handler) / off(type, handler)
```

**Transitions** are a deliberate two-way choice, not a list of effects:

- **`'default'`** asks the playlist's `PlaybackRules` (§8.2) what to do. For example: play → fade in, next → crossfade, stop → fade out. In V2 all the rule values are `0`, so `'default'` currently behaves exactly like `'instant'`. When fades arrive, only the rules change; callers stay the same.
- **`'instant'`** ignores the rules completely. It starts or stops **everything** for that playlist right now, including tracks that are still fading out (the retiring set, §8). It's the panic button: a guaranteed immediate start or silence.

### 6.2 Events

| Event | Payload |
|---|---|
| `app.ready` | `{ library, volumes, unplayable: string[] }`, where `unplayable` lists IDs whose format the engine cannot play (from `canPlayType`) |
| `app.startFailed` | `{ message }`, e.g. the server isn't reachable |
| `audio.suspended` | `{}`, sent when the audio context leaves `running` without being asked (Safari interruption, Mac wake from sleep) |
| `audio.resumed` | `{}` |
| `sound.activeChanged` | `{ soundId, active }`, sent when the instance count goes from 0 to ≥1 or back |
| `playlist.stateChanged` | `{ playlistId, state, trackIndex, track, duration }` |
| `playlist.progress` | `{ playlistId, position, duration }`, at about 4 Hz while playing |
| `playlist.error` | `{ playlistId, trackId, message }` |
| `volume.changed` | `{ bus, value }` |

### 6.3 AudioEngine port

```js
engine.now()                         → seconds (audio clock)
engine.unlock()                      // creates (first call) or resumes the AudioContext;
                                     // must be called synchronously inside a user gesture
engine.on('suspended' | 'resumed', handler)   // from AudioContext 'statechange'
engine.canPlay(format)               → boolean
engine.setBusGain(bus, gain)         // 'master' | 'music' | 'sfx'
engine.createStreamVoice({ url, bus }) → Voice          // HTMLAudioElement, streamed
engine.loadBuffer(url)               → Promise<BufferHandle>   // fetch + decodeAudioData
engine.createBufferVoice({ buffer, bus }) → Voice

Voice:
	play()  pause()  stop()          // stop() = stop now and release resources; no-op if called twice
	seek(seconds)
	position, duration (NaN until known), paused
	rampGain(target, seconds)        // used by FUTURE fades
	on('loaded' | 'ended' | 'error', handler)   // 'ended' fires exactly once
```

**WebAudioEngine** (browser):
- One `AudioContext`, created inside the first `unlock()` call (the splash screen click), never at page load. The graph is `voiceGain → (musicBus | sfxBus) → masterGain → destination`. Each stream voice is `new Audio(url)` (`preload = 'auto'`) feeding `createMediaElementSource`. Each buffer voice is an `AudioBufferSourceNode`.
- `stop()` on a stream voice: `pause()`, disconnect the nodes, `removeAttribute('src')`, then `load()` so the browser drops the connection and its buffers.
- `play()` returns a promise in browsers. A rejection becomes an `error` event, never an unhandled rejection.
- Gain changes use `setTargetAtTime` or ramps, never per-frame JavaScript loops.

**FakeAudioEngine** (tests): a manual clock (`advance(seconds)`) and scripted voices: load delay, duration, injected load or play errors. It records every voice it created, so tests can check invariants such as "no live voice is left behind".

### 6.4 Volume

There are three sliders: Master, Music and Sound Effects. Gain is `value ** 2`, which sounds more even across the slider than a linear mapping.

**Saving.** Volumes are saved in `.soundboard` (§2.3), so they survive reloads and restarts.
- `start()` loads them with `fetchSettings()` and applies them before anything can play.
- `setVolume` changes the gain immediately. It then **debounces** the save: `saveVolumes` is sent 500 ms after the last change, so dragging a slider doesn't send a stream of requests.
- `flushSettings()` sends any pending change straight away with `keepalive: true`, so closing the tab mid-drag still saves it.
- A failed save logs a warning and is retried on the next change. Volume itself keeps working. **[FUTURE]** Per-playlist, per-track and per-sound volume, applied through an extra gain node per playlist or voice (the graph already allows for it).

---

## 7. Sound effect playback (`SoundPlayer`)

- `playSound(id)` starts a **new instance** every time. Instances of one sound overlap.
- Sounds never appear in the footer. Their only playing indicator is the stop button on the tile (§9.1).
- **At most 8 live instances per sound.** Starting a ninth stops the oldest one instantly.
- **At most 24 streamed sound instances in total**, across all sounds. Starting another stops the oldest streamed instance instantly. This keeps the number of media elements bounded (§14).
- **Source choice.** Files of **256 KB or less** (`size` from the library) are decoded once with `loadBuffer` and cached, so they start almost instantly. Larger files stream through a stream voice.
  - *This changes the agreed 2 MB threshold.* A 2 MB MP3 is about 2 minutes of audio and would decode to roughly 40 MB of memory. 256 KB is about 15 s, or roughly 5 MB decoded.
- **Buffer cache.** An LRU cache with a **64 MB** budget, measured as `length × channels × 4` bytes. Entries are evicted, least recently used first, when the budget is exceeded. A buffer that is currently playing is never evicted.
- **First press on an uncached small sound.** Decoding is asynchronous. Pressing the sound again while it decodes shares the same pending promise. **Race guard:** each sound has an `epoch` counter that `stopSound` increments. A pending start captures the epoch and is dropped if the epoch has changed by the time decoding finishes. "Stop All" therefore also cancels starts that haven't happened yet.
- When a voice ends or fails, its instance is removed, and `sound.activeChanged` is sent when the count reaches 0.
- Decode or load failure: `sound.error` (console plus a short-lived marker on the tile). The failed promise is evicted, so the next press tries again.

---

## 8. Playlist playback (`PlaylistPlayer`)

This is where the race-condition risk sits. The design rules:

1. **Every command runs synchronously.** No command `await`s anything. Commands start async work (loading, `play()`) and return straight away, so two commands can never interleave.
2. **Generation tokens.** Each playlist has a `generation` integer, incremented whenever the *current voice* changes or the playlist stops. Every callback from a voice (`loaded`, `ended`, `error`) is bound to the generation it was created under. **A callback with an old generation is ignored.** A late `ended` from a skipped track can therefore never advance or restart the playlist.
3. **One current voice, plus a retiring set.** At most one voice is *current*. A replaced voice moves to `retiring`. Today the rules have no fades, so it is stopped instantly and removed. With **[FUTURE]** fades and crossfades it fades out first. **Any `'instant'` command stops every retiring voice immediately**, as well as replacing or stopping the current one. Each retiring voice also gets a **hard deadline** (fade duration + 1 s); when it passes, `stop()` is forced. This guarantees no sound plays forever. The retiring set is capped at 4 voices, and the oldest is stopped instantly when the cap is exceeded. This covers someone mashing "Next" while crossfades are on.
4. **Invariant, tested after random command sequences:** once enough time has passed for all fades to finish, the playlist owns at most one live voice when playing or paused, and zero when stopped.

### 8.1 States

```
          play                 loaded
 idle ───────────▶ loading ───────────▶ playing ◀──resume──┐
  ▲                  │  ▲                  │  └──pause──▶ paused
  │ stop (any state) │  └─next/prev/jump───┘                 │
  └──────────────────┴───────────────────────────────────────┘
                     (stopping: [FUTURE] fade-out in progress → idle)
```

- `next`, `previous` and `jumpTo` from `paused` start the new track **playing**.
- `seek` works in `playing`, `paused` and `loading`. In `loading` it is applied once the track has loaded.
- `previous`: if the position is past **3 s**, restart the current track. Otherwise go to the previous track, following the order strategy.
- Track ends naturally: advance to the next track. With the default `loop: true` it wraps to the first track. If the strategy returns no next track, the playlist stops.
- Track error (404, decode failure, `play()` rejected): send `playlist.error` and skip to the next track. After `tracks.length` errors in a row, stop the playlist so it doesn't loop on broken files.
- Starting a playlist always begins at the strategy's first track. **[FUTURE]** Resume position.

### 8.2 Extension points

The defaults are hard-coded now. Each one is a single seam that later work can fill from the options files.

```js
// Resolved per playlist; V2 always returns the defaults.
PlaybackRules {
	order: 'sequential',   // [FUTURE] 'shuffle', 'shuffle-no-repeat', …
	loop: true,
	fadeIn: 0,             // seconds, [FUTURE]: applied on first track via voice.rampGain
	fadeOut: 0,            // [FUTURE]: applied on stop/last track
	crossfade: 0,          // [FUTURE]: next/previous/jump and natural track end
}

// The single place where a transition becomes concrete timings.
// 'instant' → all zeros, and retiring voices are killed. 'default' → taken from the rules.
resolveTransition(action /* 'play'|'stop'|'change' */, transition, rules)
	→ { fadeInSeconds, fadeOutSeconds, killRetiring }

// Order strategy registry: name → factory. Strategies are pure and seeded, so they can be tested.
OrderStrategy {
	first() → index | null
	next(currentIndex) → index | null    // null = end of playlist
	previous(currentIndex) → index | null
}

// Per-track plan; V2 returns { startAt: 0, endAt: null }.
planTrack(track, rules) → { startAt, endAt }
```

- `startAt` is applied by seeking before the first `play()`.
- `endAt` is enforced by a clock timer, bound to the current generation, that treats reaching `endAt` like `ended`.
- The **[FUTURE]** crossfade starts the next voice at `endAt - crossfade`, using the same retiring mechanism.

### 8.3 Progress

While a playlist is `playing`, a timer from the injected clock sends `playlist.progress` every 250 ms. The timer is cleared on pause and stop, and when the generation changes.

---

## 9. UI

Dark theme, plain and functional. Icons appear only on controls (play, pause, stop, previous, next, volume), drawn as inline SVG. Sound and playlist tiles have no icons.

### 9.0 Splash screen

Browsers only allow an `AudioContext` to start inside a user gesture, so the app starts behind a splash screen.

- On page load the app does **nothing** except show a full-screen splash: the app name and **"Click anywhere to start"**. No audio context, no requests.
- The first click calls `soundboard.start()`. Inside that click handler, `unlockAudio()` creates and resumes the `AudioContext` **synchronously**. Then the library and settings are fetched and the splash shows "Loading…".
- On `app.ready` the splash is removed and the board is rendered. On `app.startFailed` the splash shows the error and "Click to retry".
- **Re-locking.** If Safari suspends the context later (the Mac sleeps, or another app takes the audio device), `audio.suspended` brings the splash back as "Audio paused by the system. Click to resume". The click calls `unlockAudio()`. Playlist state is kept; the media elements resume with the context.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Soundboard          🔊 Master ▬▬▬▬○  Music ▬▬▬○▬  Sound Effects ▬▬○▬▬ │  header
├──────────────────────────────────────────────────────────────────────┤
│ PLAYLISTS                                                            │
│ [Combat ▶] [Tavern] [Exploration] [Boss Fight] …                     │  main (scrolls)
│                                                                      │
│ SOUND EFFECTS                                                        │
│ [Explosion ■] [Door creak] [Sword] [Thunder] …                       │
├──────────────────────────────────────────────────────────────────────┤
│ ┌Combat ───────────┐ ┌Tavern ───────────┐ ┌Ambient ──────────┐       │  footer: player bars
│ │01 Battle ▾       │ │Drinking song ▾   │ │Rain ▾            │       │  3 per row, 2 rows max,
│ │⏮ ⏸ ⏭ ⏹  1:12/3:40│ │…                 │ │…                 │       │  then scrolls
│ │━━━━━━○──────────│ │                  │ │                  │       │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘       │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.1 Layout

- The page is a full-height column: header, a scrolling main area, then the footer.
- Tiles are `<button>`s in a flex-wrap grid (min width about 160 px) with titles clamped to 3 lines. The full title shows in `title=`.
- Playlist tiles and sound tiles are visually distinct (different accent colors).
- A **playing playlist** tile is highlighted.
- A **sound with live instances** shows a small ■ stop button in its top-right corner. That button is a separate element; clicking it calls `stopSound` and does not also trigger a play.
- Tiles for unplayable formats (for example `.ogg` in an older Safari) are disabled, with a tooltip explaining why.
- The footer shows **playlists only**. Sound effects never create a player bar.
- The footer is hidden when no playlist is active. Player bars sit in a CSS grid of `repeat(3, 1fr)`, in the order the playlists were started. The footer's max height is two rows of bars; beyond that it scrolls vertically.
- Color tokens are defined as CSS custom properties on `:root`.

### 9.2 Player bar

Each bar shows:
- The playlist title.
- The track title, which is clickable and opens the **track list popover**.
- ⏮ previous, ⏯ pause/resume, ⏭ next, and ⏹ stop. Previous, next and stop use the `'default'` transition. Instant versions are in the context menu.
- `m:ss / m:ss`, with `--:--` until the duration is known.
- A progress bar. Clicking it seeks to that point.

The track list popover lists every track with the current one marked. Clicking a track calls `jumpToTrack` with `'default'`.

### 9.3 Overlay and context menus

There is one shared `Overlay` component, used by both the context menus and the track list popover.

- A full-screen backdrop (`rgba(0,0,0,.35)`) sits above the page. A `click`, `contextmenu` or `pointerdown` on the backdrop **closes the overlay and is swallowed**, so nothing on the page reacts. **Esc** also closes it.
- The menu opens at the cursor and is clamped so it stays inside the viewport.
- Right-clicking a tile suppresses the browser's own context menu.

**Sound menu**

| Item | Behavior |
|---|---|
| Play | `playSound` |
| Stop All | `stopSound` (disabled when no instances are playing) |
| Customize | disabled (stub) |

**Playlist menu**

| Item | Behavior |
|---|---|
| Play | `playPlaylist('default')`; disabled while active |
| Play (Instant) | `playPlaylist('instant')`; disabled while active |
| Next | `nextTrack('default')`; enabled only while active |
| Next (Instant) | `nextTrack('instant')`; enabled only while active |
| Stop | `stopPlaylist('default')`; enabled only while active |
| Stop (Instant) | `stopPlaylist('instant')`; enabled only while active |
| Customize | disabled (stub) |

"Active" means `loading`, `playing` or `paused`. In V2, each plain item behaves exactly like its "(Instant)" twin, because the rules have no fades yet.

### 9.4 DOM helpers

A small helper module (`ui/dom.js`) with three functions:
- `h(tag, props, ...children)` creates elements.
- `on(el, type, handler)` adds a listener and returns a function that removes it.
- `qs` / `qsa` look up elements.

UI components are classes with `mount(parent)` and `destroy()`. They subscribe to facade events and unsubscribe in `destroy()`.

### 9.5 Safari notes

- `AudioContext` is created by the splash click (§9.0). As a safety net, the UI also calls `soundboard.unlockAudio()` **synchronously** at the start of every click handler; this costs nothing when the context is already running.
- Media is same-origin, so `createMediaElementSource` works without CORS settings.
- Ogg playback in Safari depends on the version. `canPlay('ogg')` is checked when the library loads, and unsupported tiles are disabled rather than failing silently.
- These points are confirmed by hand (§11.3), not by automated tests.

---

## 10. Project structure

```
index.js                         CLI entry: args → bootstrap → server
package.json                     type: module, engines, scripts (§10.2)
eslint.config.js  .editorconfig  tsconfig*.json (§10.1)
src/
	cli/        args.js  prompter.js  reporter.js  colors.js
	library/    scanner.js  classify.js  options-store.js  validate.js
	            bootstrap-service.js  library.js  sort.js  settings-store.js
	metadata/   index.js  id3.js  ogg.js  binary-reader.js
	http/       server.js  router.js  static-files.js  media.js  range.js  mime.js
public/
	index.html  styles.css
	app/
		main.js                    composition root (creates the engine, Soundboard and UI)
		logic/                     NO DOM / audio globals
			event-emitter.js  soundboard.js  commands.js  library-model.js
			sound-player.js  buffer-cache.js
			playlist-player.js  playback-rules.js  transitions.js  order-strategies.js
			volume.js  settings-sync.js  errors.js
		audio/
			web-audio-engine.js
		api/
			backend-api.js             fetch-based BackendApi
		ui/
			dom.js  splash.js  overlay.js  context-menu.js  tile-grid.js  sound-tile.js  playlist-tile.js
			player-bar.js  player-dock.js  track-list.js  volume-controls.js  icons.js  format.js
test/
	backend/   …*.test.js
	frontend/  …*.test.js
	helpers/   fake-audio-engine.js  fake-clock.js  fake-backend-api.js  fake-prompter.js  tmp-tree.js  tag-builders.js
test_fixtures/
	example_soundboard/            real MP3/OGG library: 3 playlists, 4 sounds, some with titles
```

### 10.1 Type-checking projects

Each project is checked against only the globals its code may use, so the compiler enforces the logic/UI boundary:

| Project | Covers | Globals available |
|---|---|---|
| Backend | `index.js`, `src/**`, `test/backend/**` | Node (`@types/node`), no DOM |
| Frontend logic | `public/app/logic/**` | ECMAScript only: **no DOM, no Node**. Using `document`, `window` or `Audio` here is a compile error. |
| Frontend UI | `public/app/**` except `logic/` | DOM |
| Frontend tests | `test/frontend/**`, `test/helpers/**` | Node, plus the logic sources |

ESLint backs this up with `no-restricted-globals` in `public/app/logic/**`.

### 10.2 Scripts

| Script | Runs |
|---|---|
| `npm start -- <dir>` | `node index.js <dir>` |
| `npm run dev -- <dir>` | `node --watch index.js <dir>` |
| `npm test` | `node --test` |
| `npm run typecheck` | `tsc` for every project in §10.1 |
| `npm run lint` / `npm run lint:fix` | `eslint .` / `eslint . --fix` |
| `npm run check` | typecheck + lint + test; must pass before every commit |

---

## 11. Testing strategy

### 11.1 Automated tests (`npm test` → `node --test`)

| Unit | What is tested |
|---|---|
| `metadata/*` | §4.3, plus every file in `test_fixtures/example_soundboard` (checking which have titles) |
| `range.js` | Parsing `a-b`, `a-`, `-n`, invalid, out of bounds, multiple ranges |
| `scanner` / `classify` | Built temporary trees: hidden files, symlinks, orphans, unsupported files, nesting, empty playlists, case-insensitive extensions |
| `validate` / `options-store` | Fatal errors gathered together, unknown keys kept on rewrite, atomic write |
| `settings-store` | Default volumes, merging partial updates, invalid values rejected, writes serialized so only the newest pending value is written, unknown `.soundboard` keys kept |
| `bootstrap-service` | One end-to-end case runs against a **copy** of `test_fixtures/example_soundboard` in a temp directory. The fixture itself is never written to. First run and later runs driven by a fake prompter: answering No to nesting writes nothing, `.soundboard` is written last, new subdirectories are detected, missing options files are created without asking, metadata accepted versus declined |
| `http` | Server started on port 0 and exercised with `fetch`: library JSON, settings GET/PUT (including `400`), 200/206/416/404, HEAD, traversal attempts (`/media/../x`, encoded `%2e%2e`), static MIME types |
| `sound-player` | Overlapping instances, 8-per-sound and 24-streamed caps, stop-all during a pending decode (epoch), `activeChanged` edges, LRU eviction that skips buffers in use |
| `playlist-player` | Every state transition, stale `ended`/`error` callbacks ignored, previous within 3 s versus after, wrap-around, consecutive error limit, seek while loading, progress timer cleanup, randomized command sequences checking the voice invariant (§8 rule 4) |
| `order-strategies` | Sequential with and without loop, empty list |
| `transitions` | `'instant'` gives zero timings and kills retiring voices; `'default'` follows the rules (tested with non-zero rule values, so the future path is already covered) |
| `soundboard` facade | `start()` order (unlock → fetch → apply volumes → `app.ready`), `startFailed`, suspended/resumed forwarding, commands map to players, volume save debounce and `flushSettings` |

### 11.2 Not tested automatically

The DOM layer and `WebAudioEngine` are kept thin and checked by hand.

### 11.3 Manual checklist (Chrome, Firefox, Safari)

- [ ] Splash screen appears on load; nothing plays or loads until the click.
- [ ] Close the lid for a minute and reopen: the "resume" splash appears and audio continues after a click.
- [ ] Volumes survive a page reload and a server restart.
- [ ] Switching the audio output (speakers, headphones, Bluetooth) while playing.
- [ ] Overlapping sounds; stop-all button appears and disappears; ninth instance replaces the oldest; sounds never create a player bar.
- [ ] Several playlists at once; next, previous, jump, seek, pause and stop on each.
- [ ] Mashing "next" never leaves a stray track playing.
- [ ] Clicking outside a context menu doesn't trigger the tile underneath.
- [ ] Volume buses affect only their own category.
- [ ] Footer wraps at 3 bars and scrolls after 6.
- [ ] Seeking in a long MP3 works (Range requests).
- [ ] Ogg behavior in Safari.

---

## 12. Future work (not in this version)

| Feature | Seam already in place |
|---|---|
| Fade in/out and crossfade, used by the plain "Play", "Next" and "Stop" | `'default'` transition → `resolveTransition` → `PlaybackRules`; `voice.rampGain`; retiring set with deadlines |
| Track ordering options (shuffle, …) | `OrderStrategy` registry |
| Custom track start and end points | `planTrack → { startAt, endAt }` |
| "Customize" dialogs for sounds, tracks and playlists | Options files keep unknown keys; menu items exist |
| Per-playlist, per-track and per-sound volume | Per-voice gain node in the graph |
| Rescanning while running, or watching the directory | `BootstrapService` and `scanner` are reusable; library is reloaded through `/api/library` |
| LAN access and phone remote control (phone chooses, PC plays) | Serializable commands and events, `dispatch()`, stateless server. Would add `--host`, a `/api/events` stream (SSE) and `POST /api/commands` relay |
| Search or filter tiles; keyboard shortcuts | UI-only, uses the existing facade |
| Saving more UI preferences | `.soundboard` settings and the `/api/settings` endpoints |
| Context menus on touch screens (long press) | Overlay component |
| Resume playlist position; preload next track | `PlaylistPlayer` |

---

## 13. Build order (TDD, each step ends with passing tests)

1. Skeleton: `package.json`, `.gitignore`, `.editorconfig`, ESLint and TypeScript configs, `npm run check` passing on an empty project, test helpers (temporary trees, fake prompter).
2. Metadata: `binary-reader`, `id3`, `ogg`.
3. Library: `classify`, `scanner`, `sort`, `validate`, `options-store`, `settings-store`.
4. `BootstrapService`, then CLI wiring (`args`, `prompter`, `reporter`, `index.js`).
5. HTTP: `range`, `media`, `static-files`, `/api/library`, `/api/settings`, server lifecycle.
6. Frontend logic: `event-emitter`, `fake-clock`, `fake-audio-engine`, `fake-backend-api`, `order-strategies`, `playback-rules`, `transitions`, `playlist-player`, `buffer-cache`, `sound-player`, `volume`, `settings-sync`, `soundboard` facade.
7. `WebAudioEngine` and `BackendApi`.
8. UI: layout and tokens → splash → tiles → overlay and context menus → player dock, bars and track list → volume controls.
9. Manual checklist (§11.3) in all three browsers, with Safari on the MacBook Neo as the one that matters most.

---

## 14. Target machine: MacBook Neo, 8 GB RAM

The streaming design already keeps resource use well within what this machine can handle. No architectural changes are needed. These are the specific points, and how the design handles each.

**Memory (expected total under about 200 MB for the browser tab, a few tens of MB for Node):**
- Node holds only the file index and settings. Files are streamed in chunks from disk.
- Each streamed track (a media element) buffers only a few MB ahead. With, say, 6 playlists, the 24 streamed-sound cap and a few retiring voices, that is well under 200 MB in the worst case.
- Decoded sound effects are capped at 64 MB (§7).
- macOS memory compression and swapping make occasional spikes harmless. The real goal is that the tab never grows over a 4-hour session. That is why voices release their resources on `stop()` (§6.3) and the retiring set has deadlines (§8). Manual check: compare the tab's memory in Activity Monitor at the start and after an hour of play.

**CPU and battery:**
- Decoding is done by the browser's native code. Mixing a handful of streams through Web Audio costs very little.
- No `requestAnimationFrame` loops. Progress updates run at 4 Hz, and only while a playlist is playing. The progress bar uses CSS `transform`, not layout changes.

**Safari specifics:**
- Range requests (§5.2), the splash unlock (§9.0) and same-origin media are covered in the design.
- **Ogg support depends on the macOS and Safari version.** Tiles are disabled when `canPlayType` reports no support. If your library is mostly `.ogg` and the tiles show as disabled, use Chrome or Firefox, or convert the files to MP3.
- Safari slows down timers in background tabs. Track changes are driven by the media `ended` event, which still fires in the background, so playlists keep advancing even when the window isn't in front.

**Sleep, wake and audio devices:**
- After the Mac wakes, or when another app takes the audio device, the context may be suspended. This is handled by the "resume" splash (§9.0).
- Switching to headphones, Bluetooth or HDMI: the `AudioContext` follows the system's default output device. Checked by hand (§11.3).

**Filesystem (APFS, or an external drive):**
- `.DS_Store` files, and the `._*` AppleDouble files macOS creates on exFAT and FAT drives, start with `.` and are ignored by rule §2.1-1.
- macOS may store filenames in decomposed Unicode (NFD). IDs are always taken from what `readdir` returns and passed back unchanged through the URL, so the lookup in §5.2 matches without normalizing.
- APFS is case-insensitive by default, so extension matching is already case-insensitive (§2.1).

**Session safety:**
- **Keep the terminal window open.** Closing it stops the server, and with it any music that hasn't been buffered yet.
- "Stop (Instant)" on each playlist, and the sound stop buttons, are the guaranteed ways to cut audio immediately.
