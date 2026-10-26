# Soundboard — Design

This document describes the app **as it is**. Planned features and proposals live in [`ROADMAP.md`](ROADMAP.md); the test strategy and the manual browser checklist live in [`TESTING.md`](TESTING.md).

It is a living document: every change to it is reviewed by hand by the project owner. Places where the code already leaves room for planned features are marked **Extension point** and point to the roadmap.

---

## 1. Overview

A local soundboard for running RPG sessions. A Node.js server scans a directory of audio files and serves a vanilla-JS web app. The browser does all audio playback: overlapping sound effects plus several music playlists at once.

```
node index.js <path-to-audio-directory> [--port <number>] [--verbose]
```

- The server listens on `127.0.0.1` only. The default port is `3000`; `--port` accepts 1–65535.
- Output is quiet by default: the startup summary, warnings and errors. `--verbose` also logs every HTTP request (§5.2).
- After startup it prints `Soundboard running at http://127.0.0.1:3000` and `Press Ctrl+C to stop.` The user opens that URL themselves.
- It is always started by hand from a terminal. There is no unattended mode.

### 1.1 Constraints

| Area | Decision |
|---|---|
| Runtime | Node **24.14.0** (`"engines": { "node": ">=24.14.0" }`) |
| Runtime dependencies | **None on the server.** The browser loads exactly one third-party file: Tailwind CSS's browser build, vendored in `public/vendor/` (§9.6). Nothing is ever fetched from the internet. |
| UI styling | Tailwind CSS v4 browser build (`@tailwindcss/browser`). It turns class names into CSS at runtime, so there is no CLI and no build step. |
| Dev dependencies | Tooling only, never imported by app code: `typescript` and `@types/node` (type-checking JSDoc), `eslint`, `@eslint/js`, `@stylistic/eslint-plugin` and `globals` (linting and formatting) |
| Language | Plain `.js` with JSDoc types. No build or compile step. The browser loads the source files directly as ES modules. |
| Type-checking | `tsc` (TypeScript 7) with `checkJs` and `strict`, across four projects with different globals (§10.1) |
| Formatting | ESLint with `@stylistic`, auto-fixed with `--fix`. Not Prettier, which always puts `&&`, `\|\|` and `?:` at the end of a line. Multi-line expressions put the operator at the **start** of the line (`@stylistic/operator-linebreak: before`); assignments keep `=` at the end. |
| Module system | ES modules everywhere (`"type": "module"`) |
| Tests | `node --test` with `node:assert/strict` ([`TESTING.md`](TESTING.md)) |
| Browsers | Current desktop Chrome, Firefox and **Safari** |
| Touch | No special handling. Touch users may not be able to open the context menus. |
| Memory/CPU | Files stream over HTTP Range requests. The server never holds audio in memory. The browser holds decoded audio only for small sound effects, within a fixed memory budget. |
| Target machine | MacBook Neo, 8 GB RAM, macOS, Safari as the likely browser, used at the table during RPG sessions (§12) |

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

1. Names starting with `.` (files or directories, at any depth) are **ignored**. This includes `.soundboard`, `.DS_Store` and macOS `._*` files.
2. **Symlinks are ignored**, with a warning, to avoid loops and files outside the root.
3. In the root:
   - Each directory is a **playlist**. Its ID is the directory name.
   - A file with a supported audio extension is a **sound effect**.
   - `<name>.<ext>.json`, where `<name>.<ext>` is an audio file in the root, is that **sound's options file**. The name must match exactly, including case.
   - `<dir>.json`, where `<dir>/` is a directory in the root, is that **playlist's options file**.
   - Any other `.json` file is an **orphan options file**: warning, then ignored.
4. Inside a playlist directory, at any depth:
   - A supported audio file is a **track**. Its ID is its path relative to the root, using `/`.
   - `<file>.json` next to a track is that **track's options file**. Other `.json` files are orphans.
   - A subdirectory is a **nested subdirectory** (§3.3). Its tracks belong to the top-level playlist.
5. Supported extensions, matched case-insensitively: `.mp3` and `.ogg`.
6. Known but unsupported audio extensions (`.wav .flac .m4a .aac .opus .wma .aif .aiff .webm .mp4`) are **reported as warnings** and skipped. All other files are ignored silently.
7. A playlist with no tracks gets a warning and is **hidden** from the UI.

File names are used exactly as the file system returns them, including Unicode normalization, so IDs always match what the server looks up later.

### 2.2 Sorting

All sorting uses `Intl.Collator('en', { numeric: true, sensitivity: 'base' })`, so `2` sorts before `10` and case and accents are ignored. Names the collator considers equal fall back to code point order, so the result never depends on the order the file system listed them in.

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
- `volumes` is optional. A missing bus defaults to `1`. Each value must be a number from `0` to `1` (the slider position, not the gain). Unknown keys inside `volumes` are ignored.
- The server rewrites this file whenever the browser saves volumes (§5.2), keeping unknown keys.

Sound or track options (`Explosion.mp3.json`)
```json
{
	"title": "Big Explosion",
	"gain": 0.5957,
	"duration": 4.21,
	"measuredFrom": { "size": 48213, "modified": "2026-10-24T16:41:00.000Z", "sha1": "3f786850e387550fdab836ed7e6dc881de23001b" }
}
```
- `title` is optional; without it the default title is used (§2.4).
- `duration` (seconds, 2 decimals, or `null` when it can't be read) and `measuredFrom` (the file's size, modification time and SHA-1 at that moment) are written by bootstrap (§3.5), never by hand. They always come together.
- `gain` is optional and defaults to `1`. It is the item's own volume as the linear multiplier a Web Audio `GainNode` takes: `1` plays the file as recorded, `2` doubles the amplitude (about +6 dB), `0` is silent. The UI shows it in decibels (§6.4). It is deliberately not called `volume`, because the volumes in `.soundboard` are slider positions, a different thing. A track's `gain` is applied together with its playlist's (§6.4); there is no UI for it yet ([roadmap](ROADMAP.md)).
- The app writes `gain` rounded to 4 decimal places.

Playlist options (`Combat.json`)
```json
{
	"title": "Combat",
	"gain": 0.8,
	"crossfade": 2.5,
	"includedSubdirectories": ["Boss", "Boss/Phase 2"]
}
```
- `gain` means the same as for sounds and tracks, and applies to the whole playlist.
- `crossfade` is in seconds, `0` (the default, off) to `30`, rounded to 2 decimals (§8.4).
- `includedSubdirectories` lists paths relative to the playlist directory, using `/`. Every depth is listed explicitly.
- Listed directories that no longer exist are ignored. They are not removed.

**Validation (fatal).** Any options file or `.soundboard` that fails `JSON.parse`, is not an object, or has the wrong type for a known key (`title` must be a non-empty string, `gain` must be a number from `0` to `4`, `crossfade` a number from `0` to `30`, `duration` a non-negative number or `null` and present together with a well-formed `measuredFrom`, `includedSubdirectories` must be an array of strings, `version` must be a positive integer, `volumes.*` must be numbers in `0..1`) is an error. Bootstrap gathers **all** such errors, prints them in red with their paths, and exits with code `1` **before asking any questions or writing anything**. The user must fix or delete those files. Options files of empty playlists are validated too.

**Unknown keys are preserved.** Whenever the app rewrites a file, it reads it again, merges, and writes back the whole object, so keys from future versions survive.

**Writes.** Files are written as JSON with tab indentation and a trailing newline. Each write goes to `<file>.tmp` and is then renamed into place, so a crash cannot leave a half-written file.

### 2.4 Default titles

- A sound or track uses its metadata title if one was found and accepted (§3). Otherwise it uses the **filename exactly as it is, extension included** (`01_battle-theme.mp3`).
- A playlist uses the directory name.

---

## 3. Bootstrap (CLI)

Bootstrap runs before the HTTP server starts. The decision logic is the domain service `BootstrapService` (`src/library/`). Terminal input and output go through two ports, `Prompter.confirm(question) → Promise<boolean>` and `Reporter`, so the whole flow is tested with fakes. `src/cli/main.js` wires the real terminal in and turns the outcome into an exit code.

- **Prompts** (`TerminalPrompter`) print `Question? [y/N] `. Only `y` or `yes` (any case) means yes; anything else, including just Enter or closed input, means no. Lines typed ahead are queued for the following questions rather than lost.
- **Output** (`ConsoleReporter`) shows paths relative to the root. Colors use ANSI codes: red for nested directories and errors, yellow for warnings, bold for headings. Colors are off when `NO_COLOR` is set to a non-empty value or stdout is not a TTY.
- **Ctrl+C** during the questions ends the process immediately. That is safe because every write is atomic and `.soundboard` is written last.

### 3.1 Steps common to both modes

1. Parse arguments. On a usage error (missing directory, extra arguments, unknown option, invalid port) or a path that is not a directory, print the reason and the usage line to stderr and exit `1`.
2. **Scan** the tree (§2.1). Scanning reads directory listings and file sizes and modification times only, never file contents.
3. **Validate** every existing options file and `.soundboard` (§2.3). Any error is fatal.
4. **Report warnings**: unsupported audio files, orphan options files, symlinks, empty playlists. These never stop the app.

Playlists without tracks take no further part: no question is asked about their nested directories and no options file is created for them.

### 3.2 First run (no `.soundboard`)

5. **Nested subdirectories.** If any exist, print the first 10 in red as `Combat/Boss`, followed by `…and N more` when there are more. Then ask:
   `Nested directories will be merged into their playlists. Continue? [y/N]`
   - **No:** exit `0` without writing anything.
   - **Yes:** each one is recorded in its playlist's `includedSubdirectories` (written in step 7).
6. **Metadata titles.** For every audio file **without** an options file, try to read a title (§4). If any were found, list them as `path → "Title"`, then ask:
   `Use these titles in the generated options files? [y/N]`
   - No means filenames are used for all of them.
7. **Write**:
   - An options file for every sound and track that lacks one. The title comes from step 6, or the filename.
   - An options file for every playlist that lacks one. The title is the directory name, plus the accepted subdirectories.
   - Playlist options files that already exist get the accepted subdirectories merged in.
   - **`.soundboard` last**, as `{ "version": 1, "volumes": { "master": 1, "music": 1, "sfx": 1 } }`. If anything fails before this point, the next run is still treated as a first run.

### 3.3 Later runs (`.soundboard` exists)

5. **New nested subdirectories.** These are subdirectories not listed in the playlist's `includedSubdirectories`. A brand-new playlist has none listed, so all of its subdirectories count as new. If there are any, print and ask exactly as in §3.2 step 5. No exits `0`; Yes appends them to the list and writes the file.
6. **Missing options files.** For every audio file without one, generate it **without asking**: the metadata title if found, otherwise the filename. Missing playlist options files are created as in §3.2 step 7. `.soundboard` is not rewritten.

### 3.4 Result

Bootstrap reports how many options files it created or updated and how many playlists and sounds were loaded. It returns an in-memory `Library` (§5.1) and a `SettingsStore` loaded from `.soundboard`. The server keeps only these, never file contents.

**Extension point:** the library is built once at startup. Rescanning while running would reuse `BootstrapService` and the scanner ([roadmap](ROADMAP.md)).

### 3.5 Durations

In both modes, after the questions and without asking anything, bootstrap makes sure every sound and track has a current `duration` (§2.3). The decision is `measureIfNeeded` in `src/library/durations.js`:

- **No `duration` yet:** hash the whole file (SHA-1, `node:crypto`), read its duration (§4.3), and store both.
- **Same size and modification time as `measuredFrom`:** nothing is read.
- **Otherwise:** hash the whole file. If the hash is the same, only `size` and `modified` in `measuredFrom` are refreshed, because the file was merely copied or touched. If it differs, the file was replaced, so the duration is read again.

A file whose duration can't be read is stored as `"duration": null` with its `measuredFrom`, so it isn't read again on every start. New options files get their duration in the same write as their title; existing ones are merged as usual (§2.3), and each counts as updated in the report. Before any file is read, bootstrap prints `Measuring the duration of N audio files…`. The first run therefore reads every file once; later runs only read files that look changed.

---

## 4. Metadata extraction

`readTitle(filePath) → Promise<string | null>` and `readDuration(filePath) → Promise<number | null>` in `src/metadata/` pick the parser by extension (`.mp3`, `.ogg`, case-insensitive). They return `null` for missing or malformed data and only throw for file system errors. They read through a file handle with bounded reads and never load the whole file. No third-party code is involved.

### 4.1 MP3: ID3v2, falling back to ID3v1

- **ID3v2.2, 2.3 and 2.4.** Read the 10-byte header (`"ID3"`, version, flags, syncsafe size). Skip the extended header if present (a v2.2 tag with that flag set is treated as unreadable). Walk frame headers one at a time, reading only headers and skipping over frame bodies, until the title frame (`TIT2`, or `TT2` in v2.2) is found, padding begins, or the tag ends.
  - Frame sizes are syncsafe in v2.4 and plain 32-bit in v2.3.
  - Text encodings: `0` ISO-8859-1, `1` UTF-16 with BOM, `2` UTF-16BE, `3` UTF-8. The first of several null-separated values is used, trimmed. An empty title counts as missing.
  - If tag-wide unsynchronization is set (v2.2/2.3), read the whole tag (giving up beyond **2 MB**), reverse the unsynchronization, then parse. In v2.4, the title frame's own flags are honored: unsynchronization, data length indicator and group byte.
  - Compressed or encrypted title frames count as missing. A title frame over 64 KB is ignored.
- **ID3v1.** If there is no ID3v2 title, read the last 128 bytes. If they start with `TAG`, bytes 3–32 hold the title in ISO-8859-1, trimmed.

### 4.2 OGG: Vorbis comments

- Read Ogg pages (`"OggS"` capture pattern, segment table) of the first logical stream, ignoring pages of other multiplexed streams, and reassemble the first two packets. The second is the comment header. Reading stops after **1 MB**, because comment packets can hold embedded cover art; whatever part of the comments arrived is still searched.
- Recognize Vorbis (`\x01vorbis` / `\x03vorbis`) and Opus (`OpusHead` / `OpusTags`). Parse the vendor string, then the comment list. The value of the first non-empty `TITLE=` entry (key matched case-insensitively) is the title, decoded as UTF-8.
- Other codecs in an Ogg container return `null`.

### 4.3 Durations

- **MP3** (`mpeg.js`, MPEG-1, -2 and -2.5 Layer III). Skip the ID3v2 tag (and its footer, if flagged) and look for the first frame header within 64 KB. A header only counts if another one follows at the frame length it implies, or the file ends there, so stray bytes are skipped.
  - With a `Xing` or `Info` header (after the side information: 32 or 17 bytes for MPEG-1 stereo or mono, 17 or 9 for MPEG-2/2.5) whose frame count flag is set, or a `VBRI` header (32 bytes after the frame header): `frames × samples per frame ÷ sample rate`, with 1152 samples per frame for MPEG-1 and 576 otherwise.
  - Otherwise, as constant bitrate: `audio bytes × 8 ÷ bitrate`. The audio bytes run from the first frame to the end of the file, minus a trailing 128-byte ID3v1 tag.
- **Ogg** (`ogg.js`). The first packet of the first stream gives the clock: a Vorbis sample rate, or 48 kHz minus the pre-skip for Opus. The last page of that stream in the final 128 KB (a page is at most about 64 KB) with a granule position other than `-1` gives the length in samples: `(granule − pre-skip) ÷ sample rate`.
- Anything else, or data that doesn't fit these shapes, returns `null`.

---

## 5. Backend

### 5.1 Domain model (`src/library/`)

```js
Library   { root, playlists: Playlist[], sounds: AudioFile[], files: Map<id, AudioFile> }
Playlist  { id, title, gain, crossfade, tracks: AudioFile[], includedSubdirectories: string[] }
AudioFile { id /* root-relative POSIX path */, title, format: 'mp3'|'ogg', size, gain, duration /* seconds or null */, absolutePath }
Settings  { volumes: { master, music, sfx } }   // held by SettingsStore, saved to .soundboard
```

- `playlists` contains only non-empty playlists, sorted by title; `sounds` are sorted by title; tracks keep path order (§2.2).
- `files` indexes every sound and track by id. It is the only list of files the server may stream.
- `LibraryEditor` changes the library while the app runs. `updateSound(id, { title?, gain? })` validates the change with the options file rules (§2.3), rejects unknown keys, trims the title, and rounds the gain. It then merges the change into the sound's options file (read, merge, atomic write, unknown keys kept), and only once that succeeded updates the `AudioFile` in place and sorts `sounds` again. Writes to one options file run one after another in the order they were requested, so the file always ends with the newest values; a failed write doesn't block later ones. An id that isn't a sound (including a track id) is an `UnknownSoundError`.
- `updatePlaylist(id, { title?, gain?, crossfade? })` does the same for a playlist's options file (`<directory>.json` in the root), leaving its `includedSubdirectories` alone, and sorts `playlists` again after a rename. `crossfade` is accepted only here, not for sounds. An unknown id is an `UnknownPlaylistError`.
- `SettingsStore` keeps the settings in memory and writes them back to `.soundboard` with the same read-merge-write and atomic rename as the options files (§2.3). Writes are **serialized**: one in flight at a time, and changes made meanwhile are written together by one follow-up write, so the file always ends with the newest values.

### 5.2 HTTP API (`src/http/`, built on `node:http`)

The server knows nothing about playback state.

| Method | Path | Response |
|---|---|---|
| GET, HEAD | `/` and other paths | Files from `public/` (`/` serves `index.html`), with a MIME map and `Cache-Control: no-cache`. 404 for anything missing or outside `public/`. |
| GET | `/api/library` | JSON (below) |
| GET | `/api/settings` | `{ "volumes": { "master": 1, "music": 0.8, "sfx": 1 } }` |
| PUT | `/api/settings/volumes` | Body `{ master?, music?, sfx? }` (numbers in `0..1`). Merged into the settings and saved; returns the full settings. `400` for invalid JSON, a non-object, an out-of-range value or an unknown key. `413` for bodies over 16 KB. |
| PATCH | `/api/sounds/<encoded id>` | Body `{ title?, gain? }`. Saved through `LibraryEditor` (§5.1); returns the updated sound in the `/api/library` format. `400` for invalid JSON, a non-object, an unknown key, an empty title or an out-of-range gain. `404` when the id isn't a sound. `413` for bodies over 16 KB. |
| PATCH | `/api/playlists/<encoded id>` | The same for a playlist, with body `{ title?, gain?, crossfade? }` (`LibraryEditor.updatePlaylist`); returns the playlist with its tracks in the `/api/library` format. |
| GET, HEAD | `/media/<encoded id>` | The audio file, streamed |

- API responses are JSON with `Cache-Control: no-store`. Errors are `{ "error": "message" }`.
- A known path with the wrong method gets `405` with an `Allow` header. Unknown `/api/…` paths get a JSON `404`.

`/api/library`
```json
{
	"version": 1,
	"playlists": [
		{ "id": "Combat", "title": "Combat", "gain": 0.8, "crossfade": 2.5, "tracks": [
			{ "id": "Combat/01 Battle.mp3", "title": "Battle", "format": "mp3", "size": 4194304, "gain": 1, "duration": 213.47, "url": "/media/Combat/01%20Battle.mp3" }
		] }
	],
	"sounds": [
		{ "id": "Explosion.mp3", "title": "Big Explosion", "format": "mp3", "size": 48213, "gain": 0.5957, "duration": 4.21, "url": "/media/Explosion.mp3" }
	]
}
```
Each path segment of a media URL is percent-encoded separately. The library reflects changes made through `PATCH`, so a reload shows them.

**Static files.** The path guard works on the raw request path, before any URL normalization: the path is percent-decoded, resolved against `public/`, and rejected unless it is still inside. Null bytes and malformed encoding are rejected too.

**Media streaming.** Safari refuses to play media unless the server answers Range requests correctly, so this is exact.
- Each path segment is percent-decoded and the result is looked up in `Library.files`. Only indexed files can be served; anything else is a 404. The file system is never accessed with a path from the URL.
- Headers: `Accept-Ranges: bytes`, `Content-Type` (`audio/mpeg` or `audio/ogg`), `Content-Length`, `Last-Modified`, `ETag` (built from size and mtime).
- `Range: bytes=a-b`, `a-` or `-n` gets a `206` with `Content-Range`. A range starting past the end gets a `416` with `Content-Range: bytes */size`. A malformed `Range` header is ignored and the whole file is sent. Only the first of several ranges is served.
- The body is a file read stream piped with `stream.pipeline`. A client disconnecting mid-stream (seeking, skipping tracks) is normal: the stream is closed and nothing is logged as an error.
- `HEAD` returns the same headers with no body.

**Other server behavior:**
- Unexpected errors (500s, failed streams) are always printed to stderr with their stack trace.
- With `--verbose`, each request is logged to stdout when its response finishes or the client disconnects: `GET /media/Combat/01%20Battle.mp3 206 bytes=0-1023 12ms`. That is the method, the raw path, the status, the `Range` header if there was one, and the duration. A request whose client disconnected first ends with `(aborted)`.
- If the port is in use, or not allowed, print a clear message and exit `1`.
- On SIGINT or SIGTERM, close the server, including open media streams, print `Stopped.` and exit `0`.

---

## 6. Frontend architecture

```
UI layer (DOM)  ──commands──▶  Soundboard (logic facade)  ──▶  AudioEngine port
     ▲                              │                              ▲
     └──────────events──────────────┘                ┌─────────────┴────────────┐
                                                WebAudioEngine            FakeAudioEngine
                                                (browser)                 (tests, fake clock)
```

- `public/app/main.js` is the composition root. It creates the `WebAudioEngine`, the `HttpBackendApi`, the browser clock and the `console` logger, passes them to `Soundboard`, and mounts the UI.
- `public/app/logic/**` **never touches** `window`, `document`, audio APIs or Node APIs. Everything it needs is injected through ports, whose types live in `public/app/logic/ports.js`:
  - the `AudioEngine` (§6.3);
  - a `Clock` (`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`);
  - a `BackendApi` (`fetchLibrary()`, `fetchSettings()`, `saveVolumes(volumes, { keepalive })`, `saveSoundOptions(soundId, { title, gain }, { keepalive })`, `savePlaylistOptions(playlistId, { title, gain }, { keepalive })`);
  - a `Logger` (`warn`, `error`).

  Node imports and tests this code directly; the type-checker and ESLint enforce the boundary (§10.1).
- The UI calls only the facade's methods and listens to its events. It never reads logic internals. The one exception is stateless helpers with no state of their own: the UI imports `MAX_GAIN`, `gainToDb`, `dbToGain` and `sliderToGain` from `logic/volume.js`, and `MAX_CROSSFADE` from `logic/playback-rules.js`, so the ranges and the volume math exist only once.
- **Commands and events are plain, serializable objects.** Each facade method builds a command (`{ type: 'playlist.next', playlistId, transition: 'instant' }`) and passes it to `dispatch(command)`, which validates it first. Events are `{ type, ...payload }` and contain only JSON-safe values: an unknown duration is `null`, never `NaN`. **Extension point:** a remote control could forward commands and events over a connection unchanged ([roadmap](ROADMAP.md)).
- A UI event handler that throws never stops other handlers or leaves playback half-updated; the error is passed to the logger.

### 6.1 Facade API (`Soundboard`)

```js
// lifecycle
start() → Promise<void>                   // from the splash click (§9.0): unlock audio synchronously, then fetch
                                          // library + settings once, apply volumes, emit 'app.ready' or 'app.startFailed'
unlockAudio()                             // resume audio if the browser suspended it; must run inside a user gesture
flushSettings()                           // save pending volume, sound and playlist changes now, with keepalive (on 'pagehide')

// sounds (no transitions; sounds have no rules)
playSound(soundId)
stopSound(soundId)                        // stops all instances of that sound, instantly
customizeSound(soundId, { title?, gain? }) // applies at once, saves 500 ms later (§6.4)
flushSoundOptions(soundId)                // save that sound's pending change now (its dialog closed)

// playlists; transition is 'default' (follow the playlist's rules) or 'instant'. Omitted means 'default'.
togglePlaylist(playlistId)                // tile click: play if idle, otherwise stop ('default')
playPlaylist(playlistId, { transition })
stopPlaylist(playlistId, { transition })
nextTrack(playlistId, { transition })
previousTrack(playlistId, { transition })
jumpToTrack(playlistId, trackIndex, { transition })
seek(playlistId, seconds)
pausePlaylist(playlistId)
resumePlaylist(playlistId)
customizePlaylist(playlistId, { title?, gain?, crossfade? })  // applies at once; saves 500 ms later
flushPlaylistOptions(playlistId)          // save that playlist's pending change now (its dialog closed)

// volume (value is the slider position, 0..1, clamped)
setVolume(bus, value)                     // bus: 'master' | 'music' | 'sfx'

// queries (read-only snapshots)
getLibrary(), getPlaylistSnapshot(id), getActivePlaylists() /* in start order */, getVolumes(), isSoundActive(id)

dispatch(command)                         // the command methods above are thin wrappers around this
on(type, handler) → unsubscribe, off(type, handler)
```

- Commands before `start()` has finished throw `NotReadyError`. Malformed commands, unknown ids and invalid arguments throw `InvalidCommandError`.
- `start()` can be called again after a failure; once ready it only unlocks audio.

**Transitions** are a deliberate two-way choice, not a list of effects:

- **`'default'`** asks the playlist's `PlaybackRules` (§8.2) what to do: play → fade in, next → crossfade, stop → fade out. All rule values are currently `0`, so `'default'` behaves like `'instant'`. When fades are configured, only the rules change; callers stay the same.
- **`'instant'`** ignores the rules completely. It starts or stops **everything** for that playlist right now, including tracks still fading out (§8). It is the panic button: a guaranteed immediate start or silence.

### 6.2 Events

| Event | Payload |
|---|---|
| `app.ready` | `{ library, volumes, unplayable: string[] }`, where `unplayable` lists ids whose format this browser cannot play |
| `app.startFailed` | `{ message }`, e.g. the server isn't reachable |
| `audio.suspended` | `{}`, sent when the audio context stops running without being asked (Safari interruption, Mac wake from sleep) |
| `audio.resumed` | `{}`, sent when it runs again after a suspension |
| `sound.activeChanged` | `{ soundId, active }`, sent when the instance count goes from 0 to ≥1 or back |
| `sound.error` | `{ soundId, message }`: decoding or playback failed, or the browser cannot play the format |
| `sound.changed` | `{ sound }`, the sound with its new title or gain, right after `customizeSound` |
| `sound.saved` | `{ soundId }`, once every change to that sound has been saved |
| `sound.saveFailed` | `{ soundId, message }`; the change stays in effect and is saved again with the next one |
| `playlist.changed` | `{ playlist }`, the playlist (with its tracks) with its new title, gain or crossfade, right after `customizePlaylist` |
| `playlist.saved` | `{ playlistId }`, once every change to that playlist has been saved |
| `playlist.saveFailed` | `{ playlistId, message }`, as for sounds |
| `playlist.stateChanged` | `{ playlistId, state, trackIndex, track, duration }` |
| `playlist.progress` | `{ playlistId, position, duration }`, every 250 ms while playing and right after a seek |
| `playlist.error` | `{ playlistId, trackId, message }` |
| `volume.changed` | `{ bus, value }` |

### 6.3 AudioEngine port

```js
engine.unlock()                      // creates (first call) or resumes the AudioContext;
                                     // must be called synchronously inside a user gesture
engine.on('suspended' | 'resumed', handler)
engine.canPlay(format)               → boolean
engine.setBusGain(bus, gain)         // 'master' | 'music' | 'sfx'
engine.createStreamVoice({ url, bus, gain? }) → Voice          // streamed through a media element
engine.loadBuffer(url)               → Promise<BufferHandle>   // fetch + decodeAudioData; { memoryBytes }
engine.createBufferVoice({ buffer, bus, gain? }) → Voice      // gain: the voice's own volume, default 1

Voice:
	play()  pause()  stop()          // play() failures arrive as an error event; stop() releases everything
	seek(seconds)                    // and is safe to call twice
	position, duration               // seconds; duration is NaN until 'loaded'
	rampGain(target, seconds)        // fades
	setGain(gain)                    // the voice's own volume, smoothed; independent of fades
	on('loaded' | 'ended', handler)  // 'ended' fires at most once
	onError(handler)                 // handler receives { message }
	                                 // no event fires after stop()
```

**WebAudioEngine** (`public/app/audio/`):
- One `AudioContext` (`latencyHint: 'interactive'`), created inside the first `unlock()`, never at page load. The graph is `source → voice gain → voice fade → music or sfx bus gain → master gain → speakers`. Bus gains set before the context exists are applied when it is created.
- Every voice plays through two gain nodes (`VoiceOutput`): its own volume (`gain`, `setGain`) and its fade (`rampGain`). Keeping them apart means a fade never needs to know the volume, and a volume change never disturbs a fade in progress.
- `VoiceOutput` remembers the fade it last scheduled (`fade-ramp.js`) and starts every new fade from that fade's level at the current time. It never reads `AudioParam.value`, which only catches up once the audio thread has run. A fade-in scheduled straight after a jump to silence therefore really starts from silence, and an interrupted fade continues from wherever it had got to.
- **Stream voices** are `Audio` elements (`preload = 'auto'`) feeding `createMediaElementSource`. `loaded` is the element's `loadedmetadata`. `stop()` pauses, disconnects the nodes, removes `src` and calls `load()`, so the browser drops the connection and its buffers. A rejected `play()` becomes an `error` event, except `AbortError`, which only means a pause or stop interrupted the start.
- **Buffer voices** use an `AudioBufferSourceNode` per play; pausing remembers the offset. `loaded` is announced asynchronously right away. `memoryBytes` is `length × channels × 4`.
- `canPlay` uses `canPlayType` and caches the answer per format.
- Bus gains and voice volumes change with `setTargetAtTime` (15 ms), so moving a slider never clicks; fades use ramps. No per-frame JavaScript loops.
- `suspended` is only reported for a context that was running, so the short suspended state right after creation is not mistaken for an interruption. Safari's `interrupted` state counts as suspended.

**FakeAudioEngine** (`test/helpers/`) runs on a fake clock and models how media elements behave: loading takes time, `play()` before loading waits for it, position only advances while playing, `ended` fires once. Errors, durations and "leaky" voices that keep firing events after `stop()` can be scripted per URL. It records every voice, with its current `gain`, so tests can check that none is left behind.

### 6.4 Volume

There are three volume controls in the header: Master, Music and Sound Effects. Each is a gain widget (§9.7) on `BUS_SCALE`: its value is a slider position from `0` to `1`, and the gain is `value ** 2`, which sounds more even across the widget than a linear mapping. They stop at 0 dB and have no boost.

Volumes are saved in `.soundboard` (§2.3), so they survive reloads and restarts.
- `start()` loads them with `fetchSettings()` and applies them before anything can play.
- `setVolume` changes the gain immediately. The save is **debounced**: `saveVolumes` is sent 500 ms after the last change, and only one save is in flight at a time, so saves can't arrive out of order.
- `flushSettings()` sends a pending change straight away with `keepalive: true`, so closing the tab mid-drag still saves it.
- A failed save logs a warning; the next change saves the full set again. Volume itself keeps working.

**Item volume.** Each sound, playlist and track has its own `gain` (§2.3). Sounds and playlists set it in their Customize dialogs (§9.7).
- **Range and display.** Gain runs from `0` (silent) to `MAX_GAIN = 4` (+12.04 dB); the server enforces the same limit. People see decibels: `dB = 20 · log10(gain)`, `gain = 10^(dB / 20)`, and gain 0 is shown as `−∞ dB`. Above gain 1 a loud file can clip; that is allowed, and the widget shows it in orange.
- **Sounds.** Every instance plays at the sound's gain.
- **Playlists.** Every playlist voice plays at `playlist gain × track gain`, through the voice's own gain stage (§6.3), so no extra node per playlist is needed.
- **Applying.** `customizeSound` and `customizePlaylist` change the browser's library at once (`LibraryModel.updateSound` / `updatePlaylist`, which keep the items sorted with the same order as the server, §2.2). `SoundPlayer.setGain` applies a sound's gain to every playing instance and to later ones; `PlaylistPlayer.setGain` applies a playlist's gain to its current voice, to voices still fading out, and to later ones. An empty title or a gain out of range is an `InvalidCommandError`.
- **Saving.** `OptionsSync` saves per item like the volume save: 500 ms after the last change, one request per item in flight, always the full `{ title, gain }`, so a failed save is repaired by the next one. Its queues are keyed by kind and id, so a sound and a playlist with the same id never share one. `flushSoundOptions` / `flushPlaylistOptions` send one item's pending change now (after any save of it in flight); `flushSettings` sends everything pending with `keepalive`.

**Extension point:** a per-track volume control only needs UI, since the track's `gain` is already applied ([roadmap](ROADMAP.md)).

---

## 7. Sound effect playback (`SoundPlayer`)

- `playSound(id)` starts a **new instance** every time. Instances of one sound overlap.
- Sounds never appear in the footer. Their only playing indicator is the stop button on the tile (§9.1).
- **At most 8 live instances per sound.** Starting a ninth stops the oldest one instantly.
- **At most 24 streamed sound instances in total**, across all sounds. Starting another stops the oldest streamed instance instantly. This keeps the number of media elements bounded (§12). Buffered instances don't count toward this limit.
- **Source choice.** Files of **256 KB or less** (`size` from the library, about 15 s of MP3) are decoded once with `loadBuffer` and cached, so they start almost instantly. Larger files stream; their `play()` is called synchronously inside the click.
- **Buffer cache.** An LRU cache with a **64 MB** budget, measured as `memoryBytes`. Entries are evicted, least recently used first, when the budget is exceeded. A buffer that is playing is never evicted, and neither is one that has just finished decoding, since its caller is about to play it.
- **First press on an uncached small sound.** Decoding is asynchronous. Pressing the sound again while it decodes shares the same pending load. **Race guard:** each sound has an `epoch` counter that `stopSound` increments. A pending start captures the epoch and is dropped if it has changed by the time decoding finishes, so "Stop All" also cancels starts that haven't happened yet.
- **Volume.** Every instance starts at the sound's gain (§6.4). `setGain(soundId, gain)` applies a new gain to the instances playing and remembers it for later ones, including a press still waiting for its decode.
- When a voice ends or fails, its instance is removed and its resources released, and `sound.activeChanged` is sent when the count reaches 0.
- Errors: a decode or playback failure, or a format the browser can't play, sends `sound.error`. A failed decode is forgotten, so the next press tries again.

---

## 8. Playlist playback (`PlaylistPlayer`)

This is where the race-condition risk sits. The design rules:

1. **Every command runs synchronously.** No command `await`s anything. Commands start async work (loading, `play()`) and return straight away, so two commands can never interleave. `play()` is called right away, inside the click that caused it.
2. **Generation tokens.** Each playlist has a `generation` integer, incremented whenever the *current voice* changes or the playlist stops. Every callback from a voice (`loaded`, `ended`, `error`) is bound to the voice and generation it was created under. **A callback from a replaced or stopped voice is ignored**, even if the engine delivers it after `stop()`. A late `ended` from a skipped track can therefore never advance or restart the playlist.
3. **One current voice, plus a retiring set.**
   - At most one voice is *current*. A replaced voice moves to the *retiring* set, where it fades out.
   - Only an audible (`playing`) voice is faded. A voice that is paused or still loading, or whose track ended or failed, is stopped at once. Without a crossfade, every replaced voice is stopped at once.
   - **Any `'instant'` command stops every retiring voice immediately**, as well as replacing or stopping the current one.
   - Each retiring voice has a **hard deadline** (fade duration + 1 s), after which `stop()` is forced. No sound can play forever.
   - The retiring set holds at most 4 voices; the oldest is stopped when it would grow larger. This covers someone mashing "Next" while crossfades are on.
4. **Invariant**, checked by a randomized test over 400 command sequences, with and without crossfades and fades: while active, at most one live voice is not fading out, and the fading ones stay within the cap; when idle, no voice and no timer is left. After a final stop and enough time for any fade, nothing is left either.
5. **Clock timers are bound too.** The crossfade timer (§8.4) is cancelled whenever the track changes, the playlist stops or pauses, and it also checks that its voice is still current before acting.

### 8.1 States

```
          play                 loaded
 idle ───────────▶ loading ───────────▶ playing ◀──resume──┐
  ▲                  │  ▲                  │  └──pause──▶ paused
  │ stop (any state) │  └─next/prev/jump───┘                 │
  └──────────────────┴───────────────────────────────────────┘
```

- `play` is ignored unless idle. `jumpTo` works in any state; from idle it starts the playlist at that track.
- `next`, `previous` and `jumpTo` from `paused` start the new track **playing**. `pause` in `loading` keeps the track paused once it loads; `resume` before loading goes back to `loading`.
- `pause` means silence: it also stops voices still fading out from a crossfade. A `'default'` stop without a fade-out does the same (`killRetiring`), so Stop means silence too.
- `seek` works in `loading`, `playing` and `paused`, clamped to the track. While loading it is applied once the track has loaded.
- `previous`: past **3 s** into the track, or when there is no previous track, it restarts the current track (seek to 0, and resume if paused). Otherwise it goes to the previous track, following the order strategy.
- `next` past the last track without looping stops the playlist.
- Track ends naturally: advance to the next track. With the default `loop: true` it wraps to the first track. If the strategy returns no next track, the playlist stops. With a crossfade the next track has usually started already (§8.4); `ended` is the fallback.
- Track error (404, decode failure, rejected `play()`), or a track in a format this browser cannot play: send `playlist.error` and skip to the next track. Unplayable tracks get no voice at all. After `tracks.length` errors in a row (reset whenever a track loads), the playlist stops instead of looping over broken files.
- Starting a playlist always begins at the strategy's first track.
- Volume: each voice starts at `playlist gain × track gain`. `setGain(gain)` applies a new playlist gain to the current voice and to the retiring ones, each with its own track's gain. Fades use a separate gain stage (§6.3), so this never disturbs one.

### 8.2 Extension points

Each is a single seam that the planned features in the [roadmap](ROADMAP.md) fill in. `crossfade` is the only rule read from the playlist so far; the others are the defaults.

```js
// Resolved per playlist by resolvePlaybackRules(playlist); PlaylistPlayer.setRules replaces them while playing.
PlaybackRules {
	order: 'sequential',   // name of an order strategy
	loop: true,
	fadeIn: 0,             // seconds, when the playlist starts
	fadeOut: 0,            // seconds, when it stops
	crossfade: 0,          // seconds, when the track changes
}

// The single place where a transition becomes concrete timings.
// 'instant' → all zeros and retiring voices are killed; 'default' → taken from the rules
// (a stop without a fade-out also kills retiring voices).
resolveTransition(action /* 'play'|'stop'|'change' */, transition, rules)
	→ { fadeInSeconds, fadeOutSeconds, killRetiring }

// Order strategy registry: name → factory. Strategies are pure, so they can be tested deterministically.
OrderStrategy {
	first() → index | null
	next(currentIndex) → index | null    // null = end of playlist
	previous(currentIndex) → index | null
}

// Per-track plan; currently always { startAt: 0, endAt: null }.
planTrack(track, rules) → { startAt, endAt }
```

- A non-zero `fadeIn` ramps the new voice's gain from 0; a non-zero fade-out ramps the old voice to 0 in the retiring set. Both are covered by tests with non-zero rules.
- A non-zero `startAt` is applied by seeking once the track has loaded.

### 8.3 Progress

While a playlist is `playing`, a clock interval sends `playlist.progress` every 250 ms. The interval is cleared on pause, on stop, and whenever the track changes.

### 8.4 Crossfade

With a non-zero `crossfade` rule, one track gives way to the next by fading out while the next fades in. Both fades start at once when the change happens.

- **Overlap.** A crossfade from track A to track B lasts `min(crossfade, A's duration ÷ 2, B's duration ÷ 2)`. A's duration is the one its voice reports, or the stored one (§3.5) until then; B's is the stored one; unknown durations don't limit it. A's fade-out is cut to the time A has left, so it never ends mid-fade. B fades in over the whole overlap.
- **At a natural end.** While a track is `playing`, a clock timer fires at `time left − overlap` and starts the next track with that timing. It is planned when the track starts playing (`loaded`, `resume`) and planned again on `seek` and `setRules`. Pause, stop and every change of track cancel it. From within the last `overlap` seconds (after a seek, say), the crossfade starts at once. A track whose duration is unknown has no timer, and `ended` advances as without a crossfade, with the next track fading in.
- **Manual changes.** Next, Previous and jumps with `'default'` use the same overlap, if the old track is audible. `'instant'` cuts over and stops every voice still fading out.
- **One track, looping.** The track crossfades into a new start of itself.
- **Stop and pause** silence both tracks (§8.1).

---

## 9. UI

Dark theme, plain and functional. Icons appear only on controls (play, pause, stop, previous, next, volume, and the track list chevron) and as the saving spinner and checkmark (§9.7), drawn as inline SVG. Sound and playlist tiles have no icons.

### 9.0 Splash screen

Browsers only allow audio to start inside a user gesture, so the app starts behind a full-screen splash.

- On page load the app does **nothing** except show the splash: the app name and **"Click anywhere to start"**. No audio context, no API requests.
- The first click calls `soundboard.start()`, which creates and resumes the `AudioContext` **synchronously** inside the click. The splash shows "Loading…" while the library and settings are fetched.
- On `app.ready` the splash is hidden and the board is rendered. On `app.startFailed` the splash shows "Could not start the soundboard. Click to retry." with the error; clicking starts again.
- **Re-locking.** If the system suspends audio later (the Mac sleeps, or another app takes the audio device), `audio.suspended` closes any open popup (an open Customize dialog stays, underneath the splash) and brings the splash back as "Audio paused by the system. Click to resume." A click calls `unlockAudio()`, and the splash hides on `audio.resumed`. Playlist state is kept.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Soundboard     🔊 Master ▂▄▆█ 0.0 dB  Music ▂▄▆ −3.1 dB  Sound Effects … │  header
├──────────────────────────────────────────────────────────────────────┤
│ PLAYLISTS                                                            │
│ [Combat ▶] [Tavern] [Exploration] [Boss Fight] …                     │  main (scrolls)
│                                                                      │
│ SOUND EFFECTS                                                        │
│ [Explosion ■] [Door creak] [Sword] [Thunder] …                       │
├──────────────────────────────────────────────────────────────────────┤
│ ┌Combat ───────────┐ ┌Tavern ───────────┐ ┌Ambient ──────────┐       │  footer: always visible,
│ │01 Battle ▾       │ │Drinking song ▾   │ │Rain ▾            │       │  3 bars per row,
│ │⏮ ⏸ ⏭ ⏹  1:12/3:40│ │…                 │ │…                 │       │  2 rows max, then scrolls
│ │━━━━━━○──────────│ │                  │ │                  │       │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘       │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.1 Layout

- The page is a full-height column: header (title and volume controls), a scrolling main area, then the footer.
- The main area has a "Playlists" section above a "Sound Effects" section; empty sections are left out. With neither, it says no playlists or sounds were found.
- Tiles are `<button>`s in a grid of columns at least 10rem (160 px) wide, with titles clamped to 3 lines. The full title shows as a tooltip.
- Playlist tiles have a blue accent and sound tiles an amber one.
- A playlist tile shows its track count when idle and "Loading…", "Playing" or "Paused" when active, and is highlighted while active.
- A **sound with live instances** is highlighted and shows a small ■ stop button in its top-right corner. That button is a sibling of the tile, not inside it, so pressing it calls `stopSound` and never also plays the sound.
- Tiles that can't play (an unsupported format, or a playlist with no playable track) are disabled, with a tooltip explaining why.
- A playlist or sound error flashes a red ring on its tile for 2 seconds.
- Sound and playlist tiles show a new title as soon as `sound.changed` or `playlist.changed` arrives, but tiles are only moved into the new sorted order when the Customize dialog closes, so a tile never jumps around while it is being renamed. Player bars show a new playlist title at once, too, and keep their start order.
- The footer shows **playlists only**. Sound effects never create a player bar.
- The footer is **always visible**, so the layout doesn't shift when music starts or stops. It is at least one row of player bars tall; while no playlist is active, that row shows a muted "No playlist playing". Player bars sit in a three-column grid, in the order the playlists were started. The footer grows to at most two rows of bars; beyond that it scrolls vertically.
- Color tokens are defined once, in Tailwind's `@theme` (§9.6).

### 9.2 Player bar

Each bar shows:
- The playlist title and `m:ss / m:ss` (`h:mm:ss` from an hour on), with `--:--` while the duration is unknown.
- The track title with a ▾ chevron. Clicking it opens the **track list popover**.
- ⏮ previous, ⏯ pause/resume, ⏭ next, and ⏹ stop. Previous, next and stop use the `'default'` transition; the instant versions are in the context menu.
- A progress bar. Pressing anywhere on it seeks to that point.

The track list popover lists every track, numbered, with the current one marked and scrolled into view. Tracks this browser can't play are disabled. Clicking a track calls `jumpToTrack` with `'default'`.

### 9.3 Overlay and context menus

One shared `Overlay` shows the context menus and the track list popover; opening one closes any other.

- A full-screen backdrop (`black/35`) sits above the page. Presses on it are swallowed. A `click` or right-click on the backdrop **closes the popup**, so nothing on the page reacts. **Esc** also closes it. Closing on `click` rather than `pointerdown` keeps the whole press on the backdrop, so the element underneath never receives a stray click.
- A popup opens at the cursor (the track list at its chevron button). Where it would overflow the window, it flips to the other side of that point, and as a last resort it is clamped inside an 8 px margin. It is placed again whenever its size changes, because Tailwind may only style a newly used class after the popup has been measured.
- Right-clicking a tile suppresses the browser's own context menu. Choosing a menu item closes the menu first, then runs the action. Disabled items are greyed out.

**Sound menu**

| Item | Behavior |
|---|---|
| Play | `playSound` |
| Stop All | `stopSound`; enabled only while instances are playing |
| Customize | opens the sound's Customize dialog (§9.7) |

**Playlist menu**

| Item | Behavior |
|---|---|
| Play | `playPlaylist('default')`; disabled while active |
| Play (Instant) | `playPlaylist('instant')`; disabled while active |
| Next | `nextTrack('default')`; enabled only while active |
| Next (Instant) | `nextTrack('instant')`; enabled only while active |
| Stop | `stopPlaylist('default')`; enabled only while active |
| Stop (Instant) | `stopPlaylist('instant')`; enabled only while active |
| Customize | opens the playlist's Customize dialog (§9.7) |

"Active" means `loading`, `playing` or `paused`. With the current all-zero rules, each plain item behaves exactly like its "(Instant)" twin. Separators divide the groups.

### 9.4 Components and DOM helpers

`ui/dom.js` has three helpers:
- `h(tag, props, ...children)` creates elements; `on<Event>` props become listeners.
- `on(target, type, handler)` adds a listener and returns a function that removes it.
- `qs` / `qsa` look up elements.

UI components extend `Component` (`ui/component.js`): `render()` builds the element once, `mount(parent)` attaches it, and `destroy()` removes it together with every subscription registered through `own()`. `App` switches between the splash and the board; the board mounts the volume controls, the tiles and the player dock, and destroys them with itself.

### 9.5 Browser notes

- The `AudioContext` is created by the splash click (§9.0). As a safety net, a capturing `pointerdown` listener on the document calls `soundboard.unlockAudio()` on every press, which costs nothing while audio is running.
- Media is same-origin, so `createMediaElementSource` works without CORS settings.
- Ogg support in Safari depends on the version. Formats are checked with `canPlayType` when the library loads, and unsupported tiles are disabled rather than failing silently.
- Before closing, the page flushes any pending volume save (`pagehide`).
- These points are confirmed by hand ([`TESTING.md`](TESTING.md)).

### 9.6 Styling with Tailwind

- `public/vendor/tailwindcss-browser-<version>.js` is the unmodified `dist/index.global.js` from the npm package `@tailwindcss/browser`, with its MIT license next to it. `index.html` loads it with a plain `<script>`. It makes no network requests and uses no `eval`.
  - **Updating** means replacing the file, renaming it to the new version, and updating `index.html`.
- Components style themselves with utility classes. App-wide tokens (colors, fonts) and base styles live in one `<style type="text/tailwindcss">` block in `index.html`, using `@theme`. A small plain `<style>` sets the page background before Tailwind runs, so the page never flashes white.
- The browser build watches the DOM and generates CSS for class names as they first appear. Keeping that cheap:
  - Anything that changes several times a second (progress bars, time readouts) is updated through inline `style` or text, **never** by swapping classes.
  - State (active, playing, error) is a `data-*` attribute styled with Tailwind's `data-*` variants, so the full set of classes is already present when an element is created.
- Because CSS for a class is generated only after the class first appears, code that measures a newly built element must allow for its size changing afterwards (§9.3).

### 9.7 Customize dialog

**Dialog** (`ui/dialog.js`) is a centered modal shared by the Customize dialogs.
- It has a title, a body and a × button. Every change inside applies at once, so nothing can be lost by closing: the × button, Esc, and a click that both starts and ends on the backdrop all close it. Esc is left to a popup when one is open on top.
- It sits above the board and the footer, but below popups (§9.3) and the splash (§9.0).
- When a Customize dialog closes, the board saves that item's pending change at once (`flushSoundOptions` / `flushPlaylistOptions`) and moves that kind of tile into sorted order.

**Shared parts** (`ui/customize-parts.js`), from which both dialogs are built:
- **Title.** A text field, focused on open, with a hint below it. Every edit is sent at once. While the field is empty or only spaces, it is marked invalid, nothing is sent, the hint explains that the last title is kept, and the tile keeps it.
- **Volume.** The gain widget on `ITEM_SCALE`.
- **Play / Stop.** A button showing whether the item is playing.
- **Status.** In the corner, without text: a spinner after a change, a checkmark once saved. A failure is shown as a red message.

**The sound dialog** (`ui/sound-editor.js`), opened from the sound menu: the title (hint: the file name), the volume, Play / Stop (`playSound`, or stopping all instances; it follows `sound.activeChanged`, so it also reflects presses on the tile) and the status (`sound.saved`, `sound.saveFailed`).

**The playlist dialog** (`ui/playlist-editor.js`), opened from the playlist menu: the title (hint: `Folder: <directory>`), the volume, Play / Stop (`togglePlaylist`, like a tile click; it follows `playlist.stateChanged`) and the status (`playlist.saved`, `playlist.saveFailed`). Later playlist settings add their sections here.

**Crossfade section** (`ui/crossfade-control.js`), in the playlist dialog:
- A slider in 0.5 s steps and a readout (`Off`, `2.5 s`) that turns into a text field when clicked, like the gain widget's. Typed values accept `,` as the decimal point, an `s` suffix and `off`.
- The limits come from the playlist's tracks with a known duration (`crossfadeLimits` in `ui/crossfade-scale.js`). The text field allows up to `min(30 s, half the shortest track)`, and longer typed values are clamped to that. The slider stops at `min(10 s, that limit)`, rounded down to a step.
- A note below says what limits it ("Up to 15.1 s, half the shortest track."). A stored value above the limit, for example after a shorter track was added, is shown as stored, with a note that short tracks use at most half their length; the player clamps it anyway (§8.4).

**Gain widget** (`ui/gain-control.js`), used in the dialogs and for the header volumes. It looks like the volume control of many media players, `h-8` tall:
```
▁ ▂ ▃ ▄ ▅ ▆ ▇ █ █ █  ┌──────┐
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  │boost │   +3.5 dB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
- **Scales.** A `GainScale` (`ui/gain-scale.js`) decides what the widget controls: its range, whether it has a boost section, how a value maps onto the width, and which real gain the readout shows.
  - `ITEM_SCALE`: a sound's gain, 0 to 4, with the boost section. Used in the dialogs.
  - `BUS_SCALE`: a header volume's slider position, 0 to 1, over the full width with no boost section, so it never goes above 0 dB. The readout shows the gain the position really gives, its square (§6.4): halfway reads `−12.0 dB`. Used in the header in a narrower, `compact` size.
- **Bars.** Ten bars that grow taller cover gain 0 to 1: the left three quarters of the width with a boost section, the whole width without one. They light up in proportion, so the last lit bar can be partly lit.
- **Boost.** One wide rectangle covers gain 1 to 4. It fills in proportion and is **orange** (`--color-boost`).
- **Line.** A thick line under the whole widget lights up to the same point, orange over the boost part.
- **Pointer.** Pressing sets the value for that point, and dragging keeps setting it. Over the bars an item's gain is linear in the position (halfway is 0.5, −6 dB). There is no snapping. Double-clicking resets to 0 dB.
- **Readout.** The dB value on the right (`+3.5 dB`, `0.0 dB`, `−12.0 dB`, `−∞ dB`), orange while the gain is above 1; that color is the only warning that boosting can distort. Clicking it swaps in a text field, focused and selected. Enter or leaving the field applies the value. Esc cancels only the edit, and a dialog around it stays open. Pressing Enter on unreadable text keeps the field open and marks it red; leaving the field discards it. Values above the scale's maximum are clamped; `-inf` or −60 dB and below mean silence. Signs, `,` as the decimal point and a `dB` suffix are accepted.
- **Keyboard.** It is a `role="slider"`: the arrow keys step 1 dB on whole decibels, stepping into and out of silence below −59 dB, and Home and End go to silence and to the scale's maximum.
- **Drawing.** The lit part is a copy of the shapes, clipped with an inline `clip-path`, so updates during a drag never change classes (§9.6). The scales, keyboard steps and dB formatting and parsing are pure functions in `ui/gain-scale.js`, with unit tests.

---

## 10. Project structure

```
index.js                         entry point: wires process streams and signals into src/cli/main.js
package.json  package-lock.json  type: module, engines, scripts (§10.2), dev dependencies only
eslint.config.js  .editorconfig  tsconfig.json  tsconfig.*.json (§10.1)
scripts/        mutate.js                checks that tests fail when code is broken (TESTING.md)
src/
	cli/        main.js  args.js  prompter.js  reporter.js  colors.js
	library/    bootstrap-service.js  scanner.js  classify.js  sort.js  validate.js  errors.js
	            options-store.js  settings-store.js  library.js  library-editor.js  durations.js
	metadata/   index.js  id3.js  ogg.js  mpeg.js  binary-reader.js
	http/       server.js  router.js  responses.js  static-files.js  media.js  range.js  mime.js  request-log.js
public/
	index.html  favicon.svg
	vendor/     tailwindcss-browser-<version>.js  tailwindcss-browser.LICENSE   (excluded from lint and type-checking)
	app/
		main.js  browser-clock.js       composition root and the browser Clock
		logic/                          no DOM, audio or Node APIs
			ports.js  soundboard.js  commands.js  errors.js  event-emitter.js  library-model.js
			playlist-player.js  playback-rules.js  transitions.js  order-strategies.js
			sound-player.js  buffer-cache.js  volume.js  settings-sync.js  options-sync.js  sort.js
		audio/      web-audio-engine.js  fade-ramp.js
		api/        backend-api.js
		ui/         app.js  component.js  dom.js  icons.js  format.js  menus.js  position.js
		            splash.js  overlay.js  context-menu.js  track-list.js  tile-grid.js
		            playlist-tile.js  sound-tile.js  player-dock.js  player-bar.js  volume-controls.js
		            dialog.js  customize-parts.js  sound-editor.js  playlist-editor.js  gain-control.js  gain-scale.js
		            crossfade-control.js  crossfade-scale.js
test/
	backend/    cli/  http/  library/  metadata/
	frontend/   logic tests, backend-api.test.js, ui/ (pure UI helpers)
	helpers/    fake-audio-engine.js  fake-clock.js  fake-backend-api.js  fake-prompter.js  fake-reporter.js
	            tmp-tree.js  tag-builders.js  http-client.js
test_fixtures/
	example_soundboard/             real MP3/OGG library: 3 playlists, 4 sounds, with and without title tags
```

### 10.1 Type-checking projects

Each project is checked against only the globals its code may use, so the compiler enforces the logic/UI boundary. `tsconfig.json` lists them for the editor; `npm run typecheck` runs each.

| Project | Covers | Globals available |
|---|---|---|
| Backend (`tsconfig.backend.json`) | `index.js`, `scripts/**`, `src/**`, `test/backend/**`, `test/helpers/**` | Node, no DOM |
| Frontend logic (`tsconfig.logic.json`) | `public/app/logic/**` | ECMAScript only: **no DOM, no Node**. Using `document`, `window`, `console` or `setTimeout` here is a compile error. |
| Frontend UI (`tsconfig.ui.json`) | `public/app/**` except `logic/` | DOM |
| Frontend tests (`tsconfig.frontend-tests.json`) | `test/frontend/**`, `test/helpers/**` | Node, plus the sources they import |

ESLint backs this up with `no-restricted-globals` in `public/app/logic/**`.

### 10.2 Scripts

| Script | Runs |
|---|---|
| `npm start -- <dir>` | `node index.js <dir>` |
| `npm run dev -- <dir>` | `node --watch index.js <dir>` |
| `npm test` | `node --test` |
| `npm run typecheck` | `tsc -p` for every project in §10.1 |
| `npm run lint` / `npm run lint:fix` | `eslint .` / `eslint . --fix` |
| `npm run check` | typecheck + lint + test; must pass before every commit |

---

## 11. Testing

Logic and backend code are developed test-first and covered by automated tests that run in Node, against fakes for the audio engine, clock, backend and terminal. The DOM layer and `WebAudioEngine` stay thin and are checked by hand in real browsers. What each suite covers, how the fakes work, and the manual checklist are in [`TESTING.md`](TESTING.md).

---

## 12. Target machine: MacBook Neo, 8 GB RAM

The streaming design keeps resource use well within what this machine can handle.

**Memory (expected total under about 200 MB for the browser tab, a few tens of MB for Node):**
- Node holds only the file index and settings. Files are streamed from disk in chunks.
- Each streamed track (a media element) buffers only a few MB ahead. With, say, 6 playlists, the 24 streamed-sound cap and a few retiring voices, that is well under 200 MB in the worst case.
- Decoded sound effects are capped at 64 MB (§7).
- The real goal is that the tab never grows over a 4-hour session. That is why voices release their resources on `stop()` (§6.3) and retiring voices have deadlines (§8).

**CPU and battery:**
- Decoding is done by the browser's native code. Mixing a handful of streams through Web Audio costs very little.
- No `requestAnimationFrame` loops. Progress updates run at 4 Hz, only while a playlist is playing, and only change inline styles and text (§9.6).

**Safari specifics:**
- Range requests (§5.2), the splash unlock (§9.0) and same-origin media are covered above.
- **Ogg support depends on the macOS and Safari version.** Unplayable tiles are disabled. If a library is mostly `.ogg` and its tiles show as disabled, use Chrome or Firefox, or convert the files to MP3.
- Safari slows down timers in background tabs. Track changes are driven by the media `ended` event, which still fires in the background, so playlists keep advancing even when the window isn't in front.
- New media elements created after the audio context has been unlocked are assumed to play without a fresh gesture, as in browser games and web music players.

**Sleep, wake and audio devices:**
- After the Mac wakes, or when another app takes the audio device, audio may be suspended. The "resume" splash handles this (§9.0).
- The `AudioContext` follows the system's default output device when switching to headphones, Bluetooth or HDMI.

**Filesystem (APFS, or an external drive):**
- `.DS_Store` files, and the `._*` AppleDouble files macOS creates on exFAT and FAT drives, start with `.` and are ignored (§2.1).
- macOS may store filenames in decomposed Unicode (NFD). IDs are taken from what `readdir` returns and passed back unchanged through the URL, so lookups match without normalizing.
- APFS is case-insensitive by default; extension matching is case-insensitive too (§2.1).

**Session safety:**
- **Keep the terminal window open.** Closing it stops the server, and with it any music that hasn't been buffered yet.
- "Stop (Instant)" on each playlist, and the sound stop buttons, are the guaranteed ways to cut audio immediately.
