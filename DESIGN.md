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
	"startAt": 0.25,
	"endAt": 3.8,
	"fadeIn": 0.05,
	"fadeOut": 0.5,
	"duration": 4.21,
	"measuredFrom": { "size": 48213, "modified": "2026-10-24T16:41:00.000Z", "sha1": "3f786850e387550fdab836ed7e6dc881de23001b" }
}
```
- `title` is optional; without it the default title is used (§2.4).
- `startAt` and `endAt` choose the part of a sound that plays (§7), in seconds. `startAt` defaults to `0`; `endAt` defaults to `null`, the end of the file. The app writes both rounded to 3 decimals, so whole milliseconds survive. They are not checked against `duration`, which is only an estimate for some MP3s.
- `fadeIn` and `fadeOut` fade a sound in from its start point and out to its end point (§7), in seconds, `0` (the default, off) to `30`, rounded to 3 decimals.
- Track files accept `startAt`, `endAt`, `fadeIn` and `fadeOut` too, but tracks ignore them for now ([roadmap](ROADMAP.md)).
- `duration` (seconds, 2 decimals, or `null` when it can't be read) and `measuredFrom` (the file's size, modification time and SHA-1 at that moment) are written by bootstrap (§3.5), never by hand. They always come together.
- `gain` is optional and defaults to `1`. It is the item's own volume as the linear multiplier a Web Audio `GainNode` takes: `1` plays the file as recorded, `2` doubles the amplitude (about +6 dB), `0` is silent. The UI shows it in decibels (§6.4). It is deliberately not called `volume`, because the volumes in `.soundboard` are slider positions, a different thing. A track's `gain` is applied together with its playlist's (§6.4); there is no UI for it yet ([roadmap](ROADMAP.md)).
- The app writes `gain` rounded to 4 decimal places.

Playlist options (`Combat.json`)
```json
{
	"title": "Combat",
	"gain": 0.8,
	"crossfade": 2.5,
	"fadeIn": 1,
	"fadeOut": 3,
	"order": "shuffle",
	"trackLooping": false,
	"stopMode": "pause",
	"includedSubdirectories": ["Boss", "Boss/Phase 2"]
}
```
- `gain` means the same as for sounds and tracks, and applies to the whole playlist.
- `crossfade` (§8.4), `fadeIn` and `fadeOut` (§8.5) are in seconds, `0` (the default, off) to `30`, rounded to 3 decimals. Every time the app writes keeps whole milliseconds, which is what the dialogs show.
- `order` is how the playlist moves through its tracks (§8.1): `"ordered"` (the default), `"random"` or `"shuffle"`.
- `trackLooping` makes the current track repeat until the user moves on (§8.1); `false` by default.
- `stopMode` is what stopping the playlist remembers (§8.1): `"pause"` (the track and its position), `"resetTrack"` (the track, to start over) or `"resetPlaylist"` (nothing, the default).
- `includedSubdirectories` lists paths relative to the playlist directory, using `/`. Every depth is listed explicitly.
- Listed directories that no longer exist are ignored. They are not removed.

**Validation (fatal).** Any options file or `.soundboard` that fails `JSON.parse`, is not an object, or has the wrong type for a known key (`title` must be a non-empty string, `gain` must be a number from `0` to `4`, `crossfade`, `fadeIn` and `fadeOut` numbers from `0` to `30`, `order` one of `"ordered"`, `"random"` and `"shuffle"`, `trackLooping` `true` or `false`, `stopMode` one of `"pause"`, `"resetTrack"` and `"resetPlaylist"`, `startAt` a non-negative number, `endAt` a non-negative number or `null` and, when both points are numbers, at least 10 ms (`MIN_CLIP_MS`) after `startAt`, `duration` a non-negative number or `null` and present together with a well-formed `measuredFrom`, `includedSubdirectories` must be an array of strings, `version` must be a positive integer, `volumes.*` must be numbers in `0..1`) is an error. Bootstrap gathers **all** such errors, prints them in red with their paths, and exits with code `1` **before asking any questions or writing anything**. The user must fix or delete those files. Options files of empty playlists are validated too.

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
Playlist  { id, title, gain, crossfade, fadeIn, fadeOut, order, trackLooping, stopMode, tracks: AudioFile[], includedSubdirectories: string[] }
AudioFile { id /* root-relative POSIX path */, title, format: 'mp3'|'ogg', size, gain, duration /* seconds or null */,
            startAt, endAt /* seconds or null */, fadeIn, fadeOut, absolutePath }
Settings  { volumes: { master, music, sfx } }   // held by SettingsStore, saved to .soundboard
```

- `playlists` contains only non-empty playlists, sorted by title; `sounds` are sorted by title; tracks keep path order (§2.2).
- `files` indexes every sound and track by id. It is the only list of files the server may stream.
- `LibraryEditor` changes the library while the app runs. `updateSound(id, { title?, gain?, startAt?, endAt?, fadeIn?, fadeOut? })` validates the change with the options file rules (§2.3), rejects unknown keys, trims the title, and rounds the numbers. The points are checked again after merging with the sound's current ones, so a change to one point must still fit the other. It then merges the change into the sound's options file (read, merge, atomic write, unknown keys kept), and only once that succeeded updates the `AudioFile` in place and sorts `sounds` again. Writes to one options file run one after another in the order they were requested, so the file always ends with the newest values; a failed write doesn't block later ones. An id that isn't a sound (including a track id) is an `UnknownSoundError`.
- `updatePlaylist(id, { title?, gain?, crossfade?, fadeIn?, fadeOut?, order?, trackLooping?, stopMode? })` does the same for a playlist's options file (`<directory>.json` in the root), leaving its `includedSubdirectories` alone, and sorts `playlists` again after a rename. The crossfade, the order, track looping and the stop mode are accepted only here, and the points only for sounds. An unknown id is an `UnknownPlaylistError`.
- `updateTrack(id, { title })` does the same for a track's options file (`<file>.json` next to it). Only `title` is accepted. Tracks keep their path order (§2.2), so nothing is sorted again. An id that isn't a track (including a sound id) is an `UnknownTrackError`.
- `SettingsStore` keeps the settings in memory and writes them back to `.soundboard` with the same read-merge-write and atomic rename as the options files (§2.3). Writes are **serialized**: one in flight at a time, and changes made meanwhile are written together by one follow-up write, so the file always ends with the newest values.

### 5.2 HTTP API (`src/http/`, built on `node:http`)

The server knows nothing about playback state.

| Method | Path | Response |
|---|---|---|
| GET, HEAD | `/` and other paths | Files from `public/` (`/` serves `index.html`), with a MIME map and `Cache-Control: no-cache`. 404 for anything missing or outside `public/`. |
| GET | `/api/library` | JSON (below) |
| GET | `/api/settings` | `{ "volumes": { "master": 1, "music": 0.8, "sfx": 1 } }` |
| PUT | `/api/settings/volumes` | Body `{ master?, music?, sfx? }` (numbers in `0..1`). Merged into the settings and saved; returns the full settings. `400` for invalid JSON, a non-object, an out-of-range value or an unknown key. `413` for bodies over 16 KB. |
| PATCH | `/api/sounds/<encoded id>` | Body `{ title?, gain?, startAt?, endAt?, fadeIn?, fadeOut? }`. Saved through `LibraryEditor` (§5.1); returns the updated sound in the `/api/library` format. `400` for invalid JSON, a non-object, an unknown key, an empty title, an out-of-range value, or points less than 10 ms apart. `404` when the id isn't a sound. `413` for bodies over 16 KB. |
| PATCH | `/api/playlists/<encoded id>` | The same for a playlist, with body `{ title?, gain?, crossfade?, fadeIn?, fadeOut?, order?, trackLooping?, stopMode? }` (`LibraryEditor.updatePlaylist`); returns the playlist with its tracks in the `/api/library` format. |
| PATCH | `/api/tracks/<encoded id>` | The same for a track, with body `{ title }` (`LibraryEditor.updateTrack`); returns the track. The id contains `/`: the rest of the path is decoded as a whole, which keeps literal slashes, so `Combat%2F1.mp3` and `Combat/1.mp3` both work. The browser sends the first. |
| GET, HEAD | `/media/<encoded id>` | The audio file, streamed |

- API responses are JSON with `Cache-Control: no-store`. Errors are `{ "error": "message" }`.
- A known path with the wrong method gets `405` with an `Allow` header. Unknown `/api/…` paths get a JSON `404`.

`/api/library`
```json
{
	"version": 1,
	"playlists": [
		{ "id": "Combat", "title": "Combat", "gain": 0.8, "crossfade": 2.5, "fadeIn": 1, "fadeOut": 3, "order": "shuffle", "trackLooping": false, "stopMode": "resetPlaylist", "tracks": [
			{ "id": "Combat/01 Battle.mp3", "title": "Battle", "format": "mp3", "size": 4194304, "gain": 1, "duration": 213.47,
			  "startAt": 0, "endAt": null, "fadeIn": 0, "fadeOut": 0, "url": "/media/Combat/01%20Battle.mp3" }
		] }
	],
	"sounds": [
		{ "id": "Explosion.mp3", "title": "Big Explosion", "format": "mp3", "size": 48213, "gain": 0.5957, "duration": 4.21,
		  "startAt": 0.25, "endAt": 3.8, "fadeIn": 0.05, "fadeOut": 0.5, "url": "/media/Explosion.mp3" }
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
  - a `Clock` (`now`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`); `now()` is a monotonic time in milliseconds, which the voice monitor (§6.5) uses to follow fades;
  - a `BackendApi` (`fetchLibrary()`, `fetchSettings()`, `saveVolumes(volumes, { keepalive })`, `saveSoundOptions(soundId, { title, gain, startAt, endAt, fadeIn, fadeOut }, { keepalive })`, `savePlaylistOptions(playlistId, { title, gain, crossfade, fadeIn, fadeOut, order, trackLooping, stopMode }, { keepalive })`, `saveTrackOptions(trackId, { title }, { keepalive })`);
  - a `Logger` (`warn`, `error`);
  - optionally a `random` function for the random playback orders (§8.1), `Math.random` unless tests pass a seeded one.

  Node imports and tests this code directly; the type-checker and ESLint enforce the boundary (§10.1).
- The UI calls only the facade's methods and listens to its events. It never reads logic internals. The one exception is stateless helpers with no state of their own: the UI imports `MAX_GAIN`, `gainToDb`, `dbToGain` and `sliderToGain` from `logic/volume.js`, `MAX_CROSSFADE` from `logic/playback-rules.js`, `MIN_CLIP_MS` from `logic/clip.js`, and `PLAYBACK_ORDERS` from `logic/order-strategies.js`, so the ranges, the list of orders and the volume math exist only once.
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
customizeSound(soundId, { title?, gain?, startAt?, endAt?, fadeIn?, fadeOut? })  // applies at once, saves 500 ms later (§6.4)
                                          // points and fades only reach later presses (§7)
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
customizePlaylist(playlistId, { title?, gain?, crossfade?, fadeIn?, fadeOut?, order?, trackLooping?, stopMode? })  // applies at once;
                                          // saves 500 ms later; a new order refills the history around the current
                                          // track, track looping reaches the current track at once, and a new stop
                                          // mode trims what a stopped playlist remembers (§8.1)
forgetPlaylist(playlistId)                // a stopped playlist forgets where it would resume; the next play starts afresh
flushPlaylistOptions(playlistId)          // save that playlist's pending change now (its dialog closed)
customizeTrack(trackId, { title })        // renames a track at once, announced as playlist.changed; saves 500 ms later
flushTrackOptions(trackId)                // save that track's pending change now

// volume (value is the slider position, 0..1, clamped)
setVolume(bus, value)                     // bus: 'master' | 'music' | 'sfx'

// queries (read-only snapshots)
getLibrary(), getPlaylistSnapshot(id), getActivePlaylists() /* in start order */, getVolumes(), isSoundActive(id)
getVoices()                               // every voice the audio engine plays or recently played, oldest first (§6.5)

dispatch(command)                         // the command methods above are thin wrappers around this
on(type, handler) → unsubscribe, off(type, handler)
```

- Commands before `start()` has finished throw `NotReadyError`. Malformed commands, unknown ids and invalid arguments throw `InvalidCommandError`.
- `start()` can be called again after a failure; once ready it only unlocks audio.

**Transitions** are a deliberate two-way choice, not a list of effects:

- **`'default'`** asks the playlist's `PlaybackRules` (§8.2) what to do: play → fade in, next → crossfade, stop → fade out (§8.4, §8.5). With all of them off (the defaults), `'default'` behaves like `'instant'`, except that it doesn't cut voices already fading out.
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
| `sound.changed` | `{ sound }`, the sound with its new title, gain, points or fades, right after `customizeSound` |
| `sound.saved` | `{ soundId }`, once every change to that sound has been saved |
| `sound.saveFailed` | `{ soundId, message }`; the change stays in effect and is saved again with the next one |
| `playlist.changed` | `{ playlist }`, the playlist (with its tracks) with its new title, gain, timings, order, track looping or stop mode, right after `customizePlaylist`, or with a renamed track, right after `customizeTrack` |
| `playlist.saved` | `{ playlistId }`, once every change to that playlist has been saved |
| `playlist.saveFailed` | `{ playlistId, message }`, as for sounds |
| `track.saved` | `{ trackId }`, once every change to that track has been saved. A rename itself is announced as `playlist.changed`, with the playlist holding the renamed track, so every view of the playlist follows from one event. |
| `track.saveFailed` | `{ trackId, message }`, as for sounds |
| `playlist.stateChanged` | `{ playlistId, state, trackIndex, track, duration, crossfadeFrom, resume }`, where `resume` is `{ trackIndex, track, position }` while a stopped playlist remembers where it will resume (`position` is `null` when the track starts over), otherwise `null`. It is sent again when `forgetPlaylist` or a new stop mode changes it. |
| `playlist.progress` | `{ playlistId, position, duration, crossfadeFrom }`, every 250 ms while playing, right after a seek, and when the rules change |
| `playlist.error` | `{ playlistId, trackId, message }` |
| `volume.changed` | `{ bus, value }` |
| `voices.changed` | `{}`, sent when a voice appears, changes status or is removed from the voice monitor's list (§6.5). Volumes move continuously and are not announced; read them with `getVoices()`. |

### 6.3 AudioEngine port

```js
engine.unlock()                      // creates (first call) or resumes the AudioContext;
                                     // must be called synchronously inside a user gesture
engine.on('suspended' | 'resumed', handler)
engine.canPlay(format)               → boolean
engine.setBusGain(bus, gain)         // 'master' | 'music' | 'sfx'
engine.createStreamVoice({ url, bus, gain?, startAt?, endAt?, label? }) → Voice  // streamed through a media element;
                                     // label: the sound's or track's title, only for the voice monitor (§6.5), ignored by the engine
engine.loadBuffer(url)               → Promise<BufferHandle>   // fetch + decodeAudioData; { memoryBytes }
engine.createBufferVoice({ buffer, bus, gain?, startAt?, endAt?, label? }) → Voice  // gain: the voice's own volume, default 1
                                     // startAt/endAt: the part of the file it plays, in seconds (default 0 and null,
                                     // the end of the file); reaching endAt stops it and fires 'ended'

Voice:
	play()  pause()  stop()          // play() failures arrive as an error event; stop() releases everything
	seek(seconds)                    // and is safe to call twice
	position, duration               // seconds; duration is NaN until 'loaded'
	rampGain(target, seconds)        // fades
	setGain(gain)                    // the voice's own volume, smoothed; independent of fades
	setLooping(looping)              // while on: start over at the start point without a gap instead of ending;
	                                 // 'ended' doesn't fire, and position jumps back
	on('loaded' | 'ended', handler)  // 'ended' fires at most once
	onError(handler)                 // handler receives { message }
	                                 // no event fires after stop()
```

**WebAudioEngine** (`public/app/audio/`):
- One `AudioContext` (`latencyHint: 'interactive'`), created inside the first `unlock()`, never at page load. The graph is `source → voice gain → voice fade → music or sfx bus gain → master gain → speakers`. Bus gains set before the context exists are applied when it is created.
- Every voice plays through two gain nodes (`VoiceOutput`): its own volume (`gain`, `setGain`) and its fade (`rampGain`). Keeping them apart means a fade never needs to know the volume, and a volume change never disturbs a fade in progress.
- `VoiceOutput` remembers the fade it last scheduled (`logic/fade-ramp.js`, shared with the voice monitor, §6.5) and starts every new fade from that fade's level at the current time. It never reads `AudioParam.value`, which only catches up once the audio thread has run. A fade-in scheduled straight after a jump to silence therefore really starts from silence, and an interrupted fade continues from wherever it had got to.
- **Stream voices** are `Audio` elements (`preload = 'auto'`) feeding `createMediaElementSource`. `loaded` is the element's `loadedmetadata`. `stop()` pauses, disconnects the nodes, removes `src` and calls `load()`, so the browser drops the connection and its buffers. A rejected `play()` becomes an `error` event, except `AbortError`, which only means a pause or stop interrupted the start.
- **Buffer voices** use an `AudioBufferSourceNode` per play; pausing remembers the offset. `loaded` is announced asynchronously right away. `memoryBytes` is `length × channels × 4`.
- **Start and end points.** `position` stays in file time.
  - A buffer voice starts at `startAt` and passes the length left to `endAt` to `AudioBufferSourceNode.start(0, offset, length)`, so the audio thread stops it at the exact sample.
  - A stream voice seeks to `startAt` on `loadedmetadata`, before any audio plays. Media elements have no end point, so a timer, set on `playing` and `seeked` and cleared on `pause` and `stop`, pauses it within 5 ms of `endAt` and fires `ended`; a timer that fires early waits again for the time left. That is accurate to a few milliseconds while the window is in front. Safari slows timers down in background tabs, so a streamed sound can run past its end there.
- **Looping** uses the browser's own gapless looping.
  - A stream voice sets the element's `loop`, which covers the whole file and never fires `ended`. With an end point, the end-point timer seeks back to `startAt` instead of ending.
  - A buffer voice plays with `loop`, `loopStart = startAt` and `loopEnd` at its end, and no length, since a length would cap the loops too. A playing source can't change how it was started, so `setLooping` restarts it from its current position. While looping, `position` wraps within the loop.
  - How seamless an MP3 loop sounds depends on the browser, since MP3 files carry encoder padding.
- `canPlay` uses `canPlayType` and caches the answer per format.
- Bus gains and voice volumes change with `setTargetAtTime` (15 ms), so moving a slider never clicks; fades use ramps. No per-frame JavaScript loops.
- `suspended` is only reported for a context that was running, so the short suspended state right after creation is not mistaken for an interruption. Safari's `interrupted` state counts as suspended.

**FakeAudioEngine** (`test/helpers/`) runs on a fake clock and models how media elements behave: loading takes time, `play()` before loading waits for it, position only advances while playing, `ended` fires once. A voice's position starts at its `startAt`, and `ended` fires when it reaches its `endAt`. A looping voice goes back to `startAt` instead, counting `loops`, until it is stopped or looping is turned off. Errors, durations and "leaky" voices that keep firing events after `stop()` can be scripted per URL. It records every voice, with its current `gain`, so tests can check that none is left behind.

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
- **Applying.** `customizeSound` and `customizePlaylist` change the browser's library at once (`LibraryModel.updateSound` / `updatePlaylist`, which keep the items sorted with the same order as the server, §2.2). `SoundPlayer.setGain` applies a sound's gain to every playing instance and to later ones; `PlaylistPlayer.setGain` applies a playlist's gain to its current voice, to voices still fading out, and to later ones. An empty title, a gain out of range or an unknown order is an `InvalidCommandError`.
- **Saving.** `OptionsSync` saves per item like the volume save: 500 ms after the last change, one request per item in flight, always the item's full editable options, so a failed save is repaired by the next one. Its queues are keyed by kind (`sound`, `playlist`, `track`) and id, so items of different kinds with the same id never share one. `flushSoundOptions`, `flushPlaylistOptions` and `flushTrackOptions` send one item's pending change now (after any save of it in flight); `flushSettings` sends everything pending with `keepalive`.

**Extension point:** a per-track volume control only needs UI, since the track's `gain` is already applied ([roadmap](ROADMAP.md)).

### 6.5 Voice monitor (`VoiceMonitor`)

The debug view (§9.8) shows what the audio engine was really asked to do. Voices can't be asked about their state, and the players don't expose them, so `VoiceMonitor` (`logic/voice-monitor.js`) wraps the `AudioEngine` port as a decorator. The facade creates it around the real engine and hands it to both players, which never know it is there. It forwards every call, so the monitor sees every voice, including tracks fading out after a crossfade and sounds replaced by the ninth press.

A created voice is wrapped in a `MonitoredVoice` that forwards its calls and records `play`, `pause`, `stop`, `setGain` and `rampGain`. `voices()` returns a snapshot per voice, oldest first:

```js
{ serial, label, bus, status, volume, finished, message }
```

- **`serial`** counts voices in creation order. **`label`** is the title the players pass in `VoiceOptions.label` (§6.3). **`message`** is the error text, otherwise `null`.
- **`status`** is `loading` until the voice reports `loaded`, then `playing`, `paused` after `pause()`, `fading in` or `fading out` while a fade runs (derived at read time from the last fade, so no timers are needed), and finally `ended` (the voice fired `ended`), `stopped` (someone called `stop()`) or `error`.
- **`volume`** is the voice's own level: its last `setGain` times its fade level now. The fade level is computed from the last `rampGain` and `Clock.now()` with `levelAt`/`rampTo` in `logic/fade-ramp.js`, the same linear formula `WebAudioEngine` uses. Bus and master sliders are not included. A finished voice keeps the volume it had at the end.
- **Lingering.** The first final status wins, so a later `stop()` on a voice that already ended changes nothing. The voice is marked `finished` and removed 5 s later (`LINGER_MS`), by one clock timeout per voice. The players and the engine release a voice as they always do; only the monitor's record stays.
- **Limit.** At most 200 entries (`MAX_ENTRIES`). Beyond that the oldest finished entries are dropped first; live voices never are.
- **Notification.** `onChange` runs when a voice is added, changes status or is removed, and the facade announces it as `voices.changed` (§6.2). The monitor always records, whether or not the panel is open.

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
- **Start and end points.** Every instance plays the part of the file between the sound's `startAt` and `endAt` (§2.3), which the voice handles (§6.3); reaching the end point ends the instance like the end of the file. A start point at or past the real end of the file ends it right away.
  - `customizeSound` rounds the points to whole milliseconds and checks them after merging with the current ones (`checkClip` in `logic/clip.js`): both non-negative, and the end at least `MIN_CLIP_MS` (10 ms) after the start. Anything else is an `InvalidCommandError`.
- **Fades.** They work like a playlist's (§8.5), using the voice's fade stage (§6.3).
  - With `fadeIn`, an instance starts silent and ramps up over `fadeIn` as it starts.
  - With `fadeOut`, a clock timer bound to the instance, planned once the voice has loaded, starts the ramp down `fadeOut` before the end point (or the end of the file). The fade is cut to the time the sound has, so it always ends where playback ends, and it starts from wherever a fade-in had got to.
  - **Stop All** and a ninth press replacing the oldest stay instant. Removing an instance clears its timer.
- **Changes only reach later presses.** An instance keeps the points and fades it started with, so dragging a handle never makes a playing sound jump or cut off. Volume is the exception, as it can't make anything jump.
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
4. **Invariant**, checked by a randomized test over 400 command sequences, with and without crossfades and fades: while active, at most one live voice is not fading out, and the fading ones stay within the cap. While idle, voices may still be fading out after a stop (§8.5); once their fades and deadlines are over, no voice and no timer is left. After a final stop and enough time for any fade, nothing is left either.
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
- `pause` and `resume` are immediate and ignore the fade settings. `pause` means silence: it also stops voices still fading out from a crossfade, and it ends a fade-in in progress by setting the voice to full level, so `resume` never has to know about fades. A `'default'` stop without a fade-out also stops retiring voices (`killRetiring`), so Stop means silence too; with a fade-out they carry on (§8.5).
- `seek` works in `loading`, `playing` and `paused`, clamped to the track, and with a crossfade coming, to the crossfade point (§8.4). While loading it is applied, and clamped, once the track has loaded.
- Which track plays is decided by the **play history** (below). Starting a playlist starts a fresh history. `next` moves forward in it and `previous` back; `jumpTo(index)` starts a fresh history at that track.
- `previous`: past **3 s** into the track, or at the first entry of the history, it restarts the current track (seek to 0, and resume if paused). Otherwise it goes back one entry. It never wraps from the first track to the last.
- `next` with nothing more in the history (only without `playlistLooping`) stops the playlist.
- Track ends naturally: advance to the next entry. With a crossfade the next track has usually started already (§8.4); `ended` is the fallback.
- **Track looping.** With `trackLooping`, every new voice gets `setLooping(true)` (§6.3), so the current track starts over at its end, without a gap, and never ends by itself. The position, and with it the progress bar, jumps back at each loop. There is no crossfade timer and no crossfade marker while it loops (§8.4). Next, Previous and `jumpTo` move on as usual, and the new track loops in turn. `setRules` applies a change to the current voice at once: turned off, the track plays to its end and the playlist moves on. During a crossfade that is the incoming track; the outgoing one just finishes its fade.
- Track error (404, decode failure, rejected `play()`), or a track in a format this browser cannot play: send `playlist.error` and skip to the next entry. Unplayable tracks get no voice at all. After `tracks.length` errors in a row (reset whenever a track loads), the playlist stops instead of looping over broken files.
- `setRules` with a different order refills the history around the current track, which keeps playing (below), and a different `trackLooping` is applied to the current voice.
- **What stopping remembers.** Stopping keeps the play history, and the `stopMode` rule decides what else the next `play` picks up. Whatever is kept is the *resume point*: a track and, for `pause`, its position.
  - `pause`: play again starts the same track and seeks to where it was. `resetTrack`: the same track, from its start point. `resetPlaylist` (the default): nothing is kept, and play starts as the order's first entry, as for a fresh playlist.
  - `'default'` and `'instant'` stops both remember. The position is the one at the moment of the stop, not where a fade-out ended, and a stop while a track is still loading remembers the position it was going to seek to. Stopping during a crossfade remembers the incoming track.
  - Resuming is an ordinary start: a `'default'` play fades in from the remembered position, `'instant'` doesn't, and a remembered position past the crossfade point lands on it, like any seek (§8.4).
  - **Forgetting.** Everything is forgotten when a track is chosen with `jumpTo` (which starts a fresh history), when the playlist stops by itself (no more tracks without playlist looping, or every track failing), and on `forget()` while idle. `forget()` only clears the resume point; the history stays, so the next play starts a fresh one anyway.
  - `setRules` with a different `stopMode` trims the resume point at once (`resetTrack` drops the position, `resetPlaylist` drops everything), so what the tile shows always matches the dialog. It never brings back what was dropped. A different order refills the history around the remembered track, as while playing.
  - Snapshots and `playlist.stateChanged` carry `resume` (§6.2) while idle.
- `setPlaylist(playlist)` takes a changed copy of the playlist with the same tracks in the same order (after a rename) and, while active, sends `playlist.stateChanged` again so the current track's new title shows.
- Volume: each voice starts at `playlist gain × track gain`. `setGain(gain)` applies a new playlist gain to the current voice and to the retiring ones, each with its own track's gain. Fades use a separate gain stage (§6.3), so this never disturbs one.

**Play history** (`logic/play-history.js`). Each player keeps a list of track indices and a cursor at the current one. Upcoming tracks are entries too, so the crossfade timer, the crossfade marker and the natural end of a track all agree on one next track, even in Random.
- `start(at?)` fills a fresh history by the order (below) and returns the track to play; `at` is a track to start at, chosen in the track list or playing when the order changed.
- `next()` moves the cursor forward. Past the last entry it first extends the history by the order, unless `playlistLooping` is off; then there is nothing more and the playlist stops. `upcoming()` returns the entry `next()` would move to, extending in the same way, so it can be asked for any number of times without picking again.
- `previous()` moves the cursor back, but never before the first entry (`canGoBack`). Going back and then forward replays the same tracks.
- `setOrder(order)` switches the order and, once started, refills the history as `start(current)` would; the current track keeps playing. While idle, the new order is simply used at the next start.
- It keeps at most `MAX_HISTORY` = 2¹⁶ entries. Beyond that it drops the oldest entries, but only ones before the cursor, so the current track and the round ahead are never cut.

**Orders** (`logic/order-strategies.js`). Each fills the history with `start(trackCount, random, at)` → `{ entries, cursor }` and `extend(trackCount, random, last)` → entries to append. They are pure apart from the injected `random`, so tests use a seeded generator.

| Order | Starting | Extending |
|---|---|---|
| `ordered` (default) | The whole playlist in order, with the cursor at `at` (or the first track), so Previous goes to the tracks listed before it. | The whole playlist in order again, so it wraps to the first track. |
| `random` | Just `at`, or a random track. | One random track that isn't `last`. |
| `shuffle` | A shuffled round of every track (Fisher–Yates), with `at` moved to the front. | A new shuffled round; if it would start with `last`, its first track is swapped with a random other one. |

Random picks among the tracks other than `last` directly instead of retrying, and with a single track both Random and Shuffle simply repeat it, so they can never loop forever.

### 8.2 Extension points

Each is a single seam that the planned features in the [roadmap](ROADMAP.md) fill in. `crossfade`, `fadeIn`, `fadeOut`, `order`, `trackLooping` and `stopMode` are read from the playlist; `playlistLooping` is always on.

```js
// Resolved per playlist by resolvePlaybackRules(playlist); PlaylistPlayer.setRules replaces them while playing.
PlaybackRules {
	order: 'ordered',      // 'ordered' | 'random' | 'shuffle' (§8.1)
	playlistLooping: true, // false: the history is never extended, so the playlist stops after its first fill
	trackLooping: false,   // true: the current track repeats until the user moves on (§8.1)
	stopMode: 'resetPlaylist', // 'pause' | 'resetTrack' | 'resetPlaylist': what stopping remembers (§8.1)
	fadeIn: 0,             // seconds, when the playlist starts
	fadeOut: 0,            // seconds, when it stops
	crossfade: 0,          // seconds, when the track changes
}

// The single place where a transition becomes concrete timings.
// 'instant' → all zeros and retiring voices are killed; 'default' → taken from the rules
// (a stop without a fade-out also kills retiring voices).
resolveTransition(action /* 'play'|'stop'|'change' */, transition, rules)
	→ { fadeInSeconds, fadeOutSeconds, killRetiring }

// Order strategies: name → how the play history is filled (§8.1).
orderStrategy(name) → { start(trackCount, random, at), extend(trackCount, random, last) }

// Per-track plan; currently always { startAt: 0, endAt: null }.
planTrack(track, rules) → { startAt, endAt }
```

- A non-zero `fadeIn` ramps the new voice's gain from 0; a non-zero fade-out ramps the old voice to 0 in the retiring set. Both are covered by tests with non-zero rules.
- A non-zero `startAt` is applied by seeking once the track has loaded.
- **Extension point:** voices already take `startAt` and `endAt` (§6.3), as sounds use them (§7), so track start and end points can pass `planTrack`'s plan to the voice ([roadmap](ROADMAP.md)).

### 8.3 Progress

While a playlist is `playing`, a clock interval sends `playlist.progress` every 250 ms. The interval is cleared on pause, on stop, and whenever the track changes.

### 8.4 Crossfade

With a non-zero `crossfade` rule, one track gives way to the next by fading out while the next fades in. Both fades start at once when the change happens.

- **Overlap.** A crossfade from track A to track B lasts `min(crossfade, A's duration ÷ 2, B's duration ÷ 2)`. A's duration is the one its voice reports, or the stored one (§3.5) until then; B's is the stored one; unknown durations don't limit it. A's fade-out is cut to the time A has left, so it never ends mid-fade. B fades in over the whole overlap.
- **At a natural end.** While a track is `playing`, a clock timer fires at `time left − overlap` and starts the next track with that timing. The next track is always the history's upcoming entry (§8.1), so the timer, the marker below and `next` agree on it. It is planned when the track starts playing (`loaded`, `resume`) and planned again on `seek` and `setRules`. Pause, stop and every change of track cancel it. At or past the crossfade point (after a seek to it, or when a longer crossfade is set), the crossfade starts at once. A track whose duration is unknown has no timer, and `ended` advances as without a crossfade, with the next track fading in.
- **Seeking** never goes past the crossfade point: a seek beyond it lands on it, so the whole crossfade plays (starting at once when playing) instead of being squeezed into the last moment. The player enforces this, whoever asks to seek.
- **Manual changes.** Next, Previous and jumps with `'default'` use the same overlap, if the old track is audible. `'instant'` cuts over and stops every voice still fading out.
- **One track.** With track looping off, a single track crossfades into a new start of itself.
- **Track looping.** A looping track has no crossfade at its end: no timer, and `crossfadeFrom` is `null`. It starts over seamlessly instead (§8.1). Changing tracks by hand still crossfades.
- **Pause** silences both tracks (§8.1). **Stop** does too without a fade-out; with one, the old track finishes its crossfade while the new one fades out (§8.5).
- **For display**, snapshots and the `playlist.stateChanged` and `playlist.progress` events carry `crossfadeFrom`: the position in the current track where the crossfade into the next will start, `duration − overlap`. It is `null` when there won't be one (no crossfade, an unknown duration, or no next track). `setRules` sends a progress event at once, so the display follows a new setting even while paused.

### 8.5 Fade in and fade out

- **Fade-in.** A `'default'` start (a tile click, Play, or a jump to a track while idle) ramps the first voice from silence over `fadeIn`. `'instant'` starts at full level.
- **Fade-out.** A `'default'` stop marks the playlist idle at once; there is no "stopping" state. The current voice, if audible, moves to the retiring set and ramps to silence over `fadeOut`, cut to the time the track has left. The ramp starts from the voice's current level (§6.3), so a fade-in that was still going turns round smoothly. A paused or still-loading voice is stopped at once.
- **Fades carry on.** Voices already fading out, from an earlier stop or a crossfade, keep fading after a stop and after a new start, which plays over them. Only `'instant'` commands, pause, and a stop without a fade-out cut them. Their deadlines (fade + 1 s) still apply.
- **Short tracks.** The fade-in has no extra limit; a crossfade or the track's end takes over from wherever it had got to.

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

- The page is a full-height column: header (title, volume controls and the debug button, §9.8), a scrolling main area, then the footer.
- The main area has a "Playlists" section above a "Sound Effects" section; empty sections are left out. With neither, it says no playlists or sounds were found.
- Tiles are `<button>`s in a grid of columns at least 10rem (160 px) wide, with titles clamped to 3 lines. The full title shows as a tooltip.
- Playlist tiles have a blue accent and sound tiles an amber one.
- A playlist tile shows its track count when idle and "Loading…", "Playing" or "Paused" when active, and is highlighted while active.
- A stopped playlist that remembers where it will resume (§8.1) keeps its normal idle look, except that its left border is dashed and its status, in the playlist accent, reads "Resumes at 1:23" (`pause`) or "Resumes track 3" (`resetTrack`). The tooltip names the track ("Combat: resumes "Boss Theme" at 1:23" or "… from its start").
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
- A progress bar. Pressing anywhere on it seeks to that point. When a crossfade is coming (`crossfadeFrom`, §8.4), the stretch from that point to the end is drawn in a lighter blue (`bg-music/40`) under the playback fill, so it is clear where the next track will take over. Its width is set with an inline style, like the fill's. A looping track has no such stretch, and its fill and time go back to the start at each loop.

The track list popover lists every track, numbered, with the current one marked and scrolled into view. The bar keeps the newest playlist from `playlist.changed`, so the popover shows renamed tracks. Tracks this browser can't play are disabled. Clicking a track calls `jumpToTrack` with `'default'`.

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
| Reset | `forgetPlaylist`; enabled only while the playlist is idle and remembers where it will resume (§8.1) |
| Customize | opens the playlist's Customize dialog (§9.7) |

"Active" means `loading`, `playing` or `paused`. The plain items follow the playlist's fades and crossfade; with those off, each behaves like its "(Instant)" twin, except for cutting voices already fading out. Separators divide the groups.

### 9.4 Components and DOM helpers

`ui/dom.js` has three helpers:
- `h(tag, props, ...children)` creates elements; `on<Event>` props become listeners.
- `on(target, type, handler)` adds a listener and returns a function that removes it.
- `qs` / `qsa` look up elements.

UI components extend `Component` (`ui/component.js`): `render()` builds the element once, `mount(parent)` attaches it, and `destroy()` removes it together with every subscription registered through `own()`. `App` switches between the splash and the board; the board mounts the volume controls, the debug view, the tiles and the player dock, and destroys them with itself.

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
  - `raised-dim` and `line-dim` are opaque colors halfway between `raised` / `line` and the dialog's `panel`, for cards at rest (§9.7). They are opaque so a pill drawn over a border never lets the border show through.
  - `animate-warn` pulses a background between the app's red and a darker red twice a second, for settings that can't play out as set (§9.7).
- Colors that a component picks at runtime (a dialog's accent) are looked up in small maps of complete class names (`ACCENTS`), because the browser build only generates classes it sees written out.
- The browser build watches the DOM and generates CSS for class names as they first appear. Keeping that cheap:
  - Anything that changes several times a second (progress bars, time readouts) is updated through inline `style` or text, **never** by swapping classes.
  - State (active, playing, error) is a `data-*` attribute styled with Tailwind's `data-*` variants, so the full set of classes is already present when an element is created.
- Because CSS for a class is generated only after the class first appears, code that measures a newly built element must allow for its size changing afterwards (§9.3).

### 9.7 Customize dialog

**Dialog** (`ui/dialog.js`) is a centered modal shared by the Customize dialogs.
- It has a title, a body and a × button. Every change inside applies at once, so nothing can be lost by closing: the × button, Esc, and a click that both starts and ends on the backdrop all close it. Esc is left to a popup when one is open on top.
- It sits above the board and the footer, but below popups (§9.3) and the splash (§9.0).
- It is at most 90 % of the window high; its body scrolls under the fixed header.
- When a Customize dialog closes, the board saves its pending changes at once (`flushSoundOptions`, or the playlist dialog's `flushEdits`, which covers the playlist and every track renamed in it) and moves that kind of tile into sorted order.

**Accent.** Each dialog has one accent color for everything that lights up: amber (`sfx`) in the sound dialog, blue (`music`) in the playlist dialog. The parts below take it as an `accent` option.

**Shared parts** (`ui/customize-parts.js`), from which both dialogs are built:
- **Card** (`card(title, accent, ...children)`). Settings are grouped in raised cards with rounded corners, a soft shadow and the title as a small uppercase pill on the top border. At rest the card is dimmed (`bg-raised-dim`, `border-line-dim`) and the pill is drawn in the border's color, so it reads as part of the border. While the card is hovered or anything in it has focus, it lights up (`bg-raised`, `border-line`) and the pill takes the accent color, so it is clear which part of the dialog is being worked with. Pills stick out above their cards, so cards are spaced `space-y-8`.
- **Labeled row** (`labeledRow`). Several settings in one card: a fixed-width label on the left, the control on the right.
- **Radio group** (`radioGroup({ name, choices, value, accent, onChange })`). Native radio buttons in the accent color (`role="radiogroup"`), each with its name and a one-line description below it. Choosing one reports it at once; `update(value)` follows changes made elsewhere.
- **Checkbox** (`checkbox({ name, label, description, checked, accent, onChange })`). One on/off setting, laid out like a radio choice: a native checkbox in the accent color, its name, and a description below. `update(checked)` follows changes made elsewhere.
- **Title.** A filled field (below), focused on open, with the floating label "Title" and a hint below it. Every edit is sent at once. While the field is empty or only spaces, it is marked invalid (`aria-invalid` and `data-invalid`), nothing is sent, the hint explains that the last title is kept, and the tile keeps it.
- **Volume.** The gain widget on `ITEM_SCALE`.
- **Play / Stop.** A button showing whether the item is playing.
- **Status.** In the corner, without text: a spinner after a change, a checkmark once saved. A failure is shown as a red message.
- **Tabs.** A tab bar over panels (`role="tablist"`, `tab`, `tabpanel`), the first selected. The left and right arrow keys move between tabs, and only the selected panel is shown. The bar stays at the top while the dialog scrolls.

**Filled field** (`ui/filled-field.js`, `filledField({ label?, unit?, accent, align, width, attributes })`), the one style for text fields in the dialogs:
- A background (`bg-surface`) with rounded top corners and only a 2 px underline, no outline.
- An optional **floating label**: small at the top of the field, or in its middle like a placeholder while the field is empty and unfocused. It works with styles only: the input has `placeholder=" "` and is a Tailwind `peer`, and the label follows `:placeholder-shown` and `:focus`.
- An optional **unit** (`s`, `dB`) inside the field after the value, so the value itself is only ever what was typed.
- On focus, underline, label and unit take the accent color; while the input has `data-invalid="true"`, they are red.

**The sound dialog** (`ui/sound-editor.js`), opened from the sound menu, in amber. Its cards:
- **Sound:** the title (hint: the file name).
- **Volume:** the gain widget.
- **Start and end** (below). A sound without a measured duration has no such card ([roadmap](ROADMAP.md)).
- **Fades:** Fade in and Fade out as labeled rows of seconds controls with the playlist fades' limits (below).

Below the cards: Play / Stop (`playSound`, or stopping all instances; it follows `sound.activeChanged`, so it also reflects presses on the tile) and the status (`sound.saved`, `sound.saveFailed`).

**Start and end section** (`ui/range-control.js`). It works in whole milliseconds and shows them as seconds with three decimals. Every change sends both points with `customizeSound`, and `sound.changed` updates the control unless a handle is being dragged.
- **Slider.** It spans the sound's stored duration. Two handles (`role="slider"`, "Start point" and "End point") never cross and stay at least `MIN_CLIP_MS` apart. Dragging a handle moves it; pressing the bar moves the nearer handle there (the start on a tie) and keeps dragging it. The part between the handles is amber (`bg-sfx`) on a dim bar. Handle and bar positions are inline styles (§9.6).
- **Fades on the slider.** Inside the amber part, the fade-in is drawn in blue (`bg-music`) from the start handle and the fade-out up to the end handle, as shares of the part that plays (`fadeBands`). Where they overlap, that stretch pulses red (`animate-warn`, §9.6); when either fade is longer than the whole part, all of it does. The dialog passes the fades in with `showFades` whenever the sound changes.
- **Keyboard.** On a handle, the arrow keys step 0.010 s and Shift + arrow 0.100 s; Home and End go to the handle's limits.
- **Fields.** "Start" on the left and "End" on the right are filled fields with the unit `s`, showing three decimals (`1.250`). They take seconds (`1.25`, `1,25`, `1.25 s`), rounded to whole milliseconds, and apply on Enter or when the field loses focus; values out of range are clamped. On Enter, text that can't be read marks the field red; leaving the field drops it. Esc restores the field without closing the dialog. A field being typed in isn't overwritten by updates.
- **Reset.** A bar in the fields' underline color joins the two fields, with a small Reset pill in its middle that goes back to the whole file.
- **Readout.** Centered below, in small text: "Plays 0.670 s of 1.670 s".
- **The end of the file is stored as `null`.** An end point at the duration is sent as `endAt: null`, so a longer replacement file still plays to its end. Stored points are fitted into the duration for display.
- The clamping, mapping, key steps, fade bands, formatting and parsing are pure functions in `ui/range-scale.js`, with unit tests.

**The playlist dialog** (`ui/playlist-editor.js`), opened from the playlist menu, in blue, always on its first tab:
- **"Playlist" tab:** cards for the **Playlist** (the title, hint: `Folder: <directory>`), the **Volume**, the **Playback order**, **When stopped**, and the **Fades**: Fade in, Crossfade and Fade out as labeled rows of seconds controls (below). Later playlist settings add their cards here.
  - **Playback order** is a radio group, sent with `customizePlaylist({ order })` and following `playlist.changed`: **Ordered** "First to last, as listed.", **Random** "Any track next, never the same one twice in a row." and **Shuffle** "Every track once in a shuffled order, then shuffled again." Below the radio buttons, after a divider, the checkbox **Repeat the current track** "It plays again until you move to another track." is sent with `customizePlaylist({ trackLooping })`.
  - **When stopped** is a radio group, sent with `customizePlaylist({ stopMode })` and following `playlist.changed`: **Pause** "Playing again continues where it stopped.", **Reset track** "Playing again starts the same track from its beginning." and **Reset playlist** "Playing again starts afresh, as if for the first time."
- **"Tracks (N)" tab:** the track accordion (`ui/track-accordion.js`).
  - The list runs edge to edge between the tab bar and the Play row, with lines between the rows and no outer border.
  - One row per track: a play / stop button, then a button with `aria-expanded` showing number, title and duration (`m:ss`, `--:--` when unknown). Clicking the button area opens the row and closes any other; clicking the open one closes it. Hovering anywhere on the header tints the whole row blue (`bg-music/15`), and the open row's header has a stronger tint (`bg-music/20`) and a blue title.
  - **Test playback** (`ui/track-playback.js` holds the pure rules, with unit tests). Only the playlist's current track is playing or paused (`trackPlayback`), and a loading track counts as playing. The row's button is a sibling of the toggle, so pressing it doesn't open or close the row. It does what `trackAction` says: on a track that isn't current, `jumpToTrack(…, { transition: 'instant' })`; on the playing track, `stopPlaylist(…, { transition: 'instant' })`, which follows the stop mode (§8.1); on a paused track, `resumePlaylist`. Buttons follow `playlist.stateChanged`, so a track started from the footer shows as playing here too. All tracks are assumed playable.
  - An open track shows two cards (`card`, §9.7): **Progress** and **Track**.
    - **Progress** holds only a bar that looks and seeks like the footer's (§9.2, pressing seeks with `seekPosition`), including the crossfade section at its end, hidden while the track loops (§8.4). Only the current track's bar fills, following `playlist.progress`. For any other track the bar is disabled: drawn as diagonal stripes, with a "not allowed" cursor, ignoring presses. A paused track's bar stays enabled. Fill and crossfade width are inline styles (§9.6), and the enabled state is a `data-enabled` attribute.
    - **Track** holds the title field (hint: `File: <track id>`), sent with `customizeTrack`. Row headers follow `playlist.changed`, while the open field is left alone, so it keeps its focus while typing. Later track settings go in the open row.
- **Below both tabs**, staying in view while either scrolls: Play / Stop (`togglePlaylist`, like a tile click; it follows `playlist.stateChanged`) and the status, which follows the playlist's saves (`playlist.saved`, `playlist.saveFailed`) and its tracks' (`track.saved`, `track.saveFailed`).

**Fade in, Crossfade and Fade out** in the playlist dialog, in that order, and Fade in and Fade out in the sound dialog, each a seconds control (`ui/seconds-control.js`):
- A slider in 0.1 s steps, in the dialog's accent, and a readout with three decimals (`Off`, `2.500 s`) that turns into a filled field with the unit `s` when clicked, like the gain widget's. Typed values accept `,` as the decimal point, an `s` suffix and `off`, and are clamped to the control's limit. An optional note sits below.
- **Fade in and fade out** allow up to 10 s on the slider and 30 s typed (`SECONDS_LIMITS` in `ui/seconds-scale.js`), with no note.
- **Crossfade** limits come from the playlist's tracks with a known duration (`crossfadeLimits`). The text field allows up to `min(30 s, half the shortest track)`, and the slider stops at `min(10 s, that limit)`, rounded down to a step. The note says what limits it ("Up to 15.100 s, half the shortest track."). The slider limit is rounded down with a small tolerance, so floating-point noise never costs a whole step. A stored value above the limit, for example after a shorter track was added, is shown as stored, with a note that short tracks use at most half their length; the player clamps it anyway (§8.4).

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
- **Readout.** The dB value on the right (`+3.5 dB`, `0.0 dB`, `−12.0 dB`, `−∞ dB`), orange while the gain is above 1; that color is the only warning that boosting can distort. Clicking it swaps in a filled field with the unit `dB` (in the dialog's accent; blue in the header), focused and selected. Enter or leaving the field applies the value. Esc cancels only the edit, and a dialog around it stays open. Pressing Enter on unreadable text keeps the field open and marks it red; leaving the field discards it. Values above the scale's maximum are clamped; `-inf` or −60 dB and below mean silence. Signs, `,` as the decimal point and a `dB` suffix are accepted.
- **Keyboard.** It is a `role="slider"`: the arrow keys step 1 dB on whole decibels, stepping into and out of silence below −59 dB, and Home and End go to silence and to the scale's maximum.
- **Drawing.** The lit part is a copy of the shapes, clipped with an inline `clip-path`, so updates during a drag never change classes (§9.6). The scales, keyboard steps and dB formatting and parsing are pure functions in `ui/gain-scale.js`, with unit tests.

### 9.8 Debug view

`ui/debug-view.js`. A small bug-icon button (title "Debug view", `aria-expanded`, `aria-controls`) sits at the right end of the header, after the volume controls, and is lit in the music accent while the panel is open. The panel starts closed after every reload.

- **Position.** The panel hangs below the button, right-aligned, absolutely positioned with `z-[60]`: above dialogs, popups and the splash. It is non-modal: no backdrop, no focus taken, and the board keeps working under it.
- **Closing.** The button toggles it. Esc closes it only when no popup or dialog is open (`[data-overlay-backdrop]`, `[data-dialog-body]`), which take Esc first.
- **Rows.** One per voice from `getVoices()` (§6.5), oldest first, so the list is static: a badge in the bus color (amber `SFX`, blue `Music`), the label, the status and the volume in dB (`formatDb`, as in the gain widget). A finished voice (`data-finished="true"`) is muted until the monitor removes it. An error status shows its message as a tooltip and is red. With no voices the panel says "No voices." The list scrolls inside 60 % of the window height.
- **Refreshing.** Rows are created once and updated in place, rewriting text only when it changed. The panel refreshes on `voices.changed` and every 250 ms while open, because volumes move without any event. Nothing runs while it is closed; the monitor keeps recording regardless (§6.5).
- No position or duration columns.

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
			playlist-player.js  playback-rules.js  transitions.js  order-strategies.js  play-history.js
			sound-player.js  buffer-cache.js  clip.js  volume.js  settings-sync.js  options-sync.js  sort.js
			voice-monitor.js  fade-ramp.js
		audio/      web-audio-engine.js
		api/        backend-api.js
		ui/         app.js  component.js  dom.js  icons.js  format.js  menus.js  position.js
		            splash.js  overlay.js  context-menu.js  track-list.js  tile-grid.js
		            playlist-tile.js  sound-tile.js  player-dock.js  player-bar.js  volume-controls.js
		            dialog.js  customize-parts.js  filled-field.js  sound-editor.js  playlist-editor.js  track-accordion.js
		            gain-control.js  gain-scale.js  debug-view.js
		            seconds-control.js  seconds-scale.js  range-control.js  range-scale.js
test/
	backend/    cli/  http/  library/  metadata/
	frontend/   logic tests, backend-api.test.js, ui/ (pure UI helpers)
	helpers/    fake-audio-engine.js  fake-clock.js  fake-backend-api.js  fake-prompter.js  fake-reporter.js
	            tmp-tree.js  tag-builders.js  http-client.js  seeded-random.js
test_fixtures/
	example_soundboard/             real MP3/OGG library: 4 playlists, 4 sounds, with and without title tags; "Music Order"
	                                has six 10 s tracks ("Order 1" to "Order 6") so the playback orders can be told apart
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
