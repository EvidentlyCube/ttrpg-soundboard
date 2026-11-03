# Soundboard — Design

This document describes the app **as it is**. Planned features and proposals live in [`ROADMAP.md`](ROADMAP.md); the test strategy and the manual browser checklist live in [`TESTING.md`](TESTING.md).

It is a living document: every change to it is reviewed by hand by the project owner. Places where the code already leaves room for planned features are marked **Extension point** and point to the roadmap.

---

## 1. Overview

A local soundboard for running RPG sessions. A Node.js server scans a directory of audio files and serves a vanilla-JS web app. The browser does all audio playback: overlapping sound effects plus several music playlists at once.

```
node index.js [<audio-directory>…] [--port <number>] [--lan [<address>]] [--UNSAFE-lan-manager]
              [--whitelisted-root <path>]… [--allow-hidden] [--no-open] [--verbose] [--help]
```

- The server listens on `127.0.0.1` only. The default port is `13872`, high enough not to clash with development servers; `--port` accepts 1–65535. When the port is taken, the next nine are tried in turn, and a yellow line says which one is used (`Port 13872 is in use, so the app uses port 13873.`).
- It prints `Soundboard running at http://localhost:13872` and opens that address in the default browser (`open` on macOS, `cmd /c start "" <url>` on Windows, `xdg-open` elsewhere, in `src/cli/open-browser.js`; a failure is ignored, since the address is printed). `--no-open` leaves the browser alone. `*.localhost` names were tried for a nicer address and don't resolve in Safari.
- Everything about choosing and loading a soundboard happens in the browser, in three phases: the **Selector** chooses the folder, the **Initializer** loads it and asks the startup questions, then the **soundboard** itself (§3). Folders given on the command line are the only ones the Selector offers. The terminal asks nothing.
- Only folders inside the **allowed roots** can be browsed and opened: the home folder, or the folders given with `--whitelisted-root` (§5.7). `--allow-hidden` also allows hidden folders.
- With **`--lan`** it listens on all interfaces instead, or only on `<address>` when one is given (the next argument counts as the address only if it is an IP address). It prints one address per network address of this machine (`http://192.168.1.20:13872/`; Docker, bridge and virtual machine interfaces are left out) for opening the app on a phone as a remote control (§5.5, §9.15). Other devices can do nothing until a soundboard is open (§1.1). A device that opens it must then be allowed from this machine first (§5.6), and can reach only the pages and the remote routes (§5.2). The terminal prints `Connection request from <address>, code <code>` for every new request.
- **`--UNSAFE-lan-manager`** implies `--lan` and also lets any device on the network use the Selector and the Initializer, without pairing (§1.1). The terminal warns about it in yellow.
- Output is quiet by default: the allowed folders, the tools and the address at startup, `Opened <folder>: 4 playlists and 4 sounds.` and `Closed <folder>.`, then `Press Ctrl+C or type exit and press Enter to stop.`, warnings and errors. `--verbose` also logs every HTTP request (§5.2). `--help` prints every option with what it does and exits; a usage error prints the reason, the usage line and a pointer to `--help`, and exits `1`.
- While it runs, it watches the directory. Files added, removed or changed from outside the app are not loaded by themselves: the page offers a refresh, which rebuilds the library as a restart would (§3.6, §5.3).
- It can add sounds, playlists and tracks from a pasted link. The server downloads it with `yt-dlp`, or fetches a direct link to a file itself, keeps its Opus audio as `.opus` or converts it to `.ogg` with `ffmpeg`, and the page shows each new file at once (§5.4, §9.9).
- It runs in a terminal window, which a launcher may open by itself; closing it, Ctrl+C or typing `exit` stops the app. There is no unattended mode.

### 1.1 Constraints

| Area | Decision |
|---|---|
| Runtime | Node **24.14.0** (`"engines": { "node": ">=24.14.0" }`) |
| Runtime dependencies | **None on the server.** The browser loads exactly one third-party file: Tailwind CSS's browser build, vendored in `public/vendor/` (§9.6). The browser never fetches anything from the internet; only the server does, and only the links the user pastes (§5.4). |
| External programs | `yt-dlp` and `ffmpeg`, for downloads only (§5.4). They are found on `PATH` and run as child processes; the app never bundles or installs them. Without them, everything except downloads works as usual. |
| UI styling | Tailwind CSS v4 browser build (`@tailwindcss/browser`). It turns class names into CSS at runtime, so there is no CLI and no build step. |
| Dev dependencies | Tooling only, never imported by app code: `typescript` and `@types/node` (type-checking JSDoc), `eslint`, `@eslint/js`, `@stylistic/eslint-plugin` and `globals` (linting and formatting), and `@playwright/test` (the browser tests, §11) |
| Language | Plain `.js` with JSDoc types. No build or compile step. The browser loads the source files directly as ES modules. |
| Type-checking | `tsc` (TypeScript 7) with `checkJs` and `strict`, across five projects with different globals (§10.1) |
| Formatting | ESLint with `@stylistic`, auto-fixed with `--fix`. Not Prettier, which always puts `&&`, `\|\|` and `?:` at the end of a line. Multi-line expressions put the operator at the **start** of the line (`@stylistic/operator-linebreak: before`); assignments keep `=` at the end. |
| Module system | ES modules everywhere (`"type": "module"`) |
| Tests | `node --test` with `node:assert/strict`, and Playwright for the UI ([`TESTING.md`](TESTING.md)) |
| Browsers | Current desktop Chrome, Firefox and **Safari** |
| Trust | The server listens on the loopback address only and trusts whoever can reach it: it has no login. It protects against other web pages open in the same browser (the request guard, §5.2), not against other programs or users on the same machine. The Selector can list folders and the Initializer can delete broken options files, so both are limited to the allowed roots (§5.7) and answered only to this machine. With `--lan` the server also answers other machines, but until a soundboard is open they get only a waiting page, and afterwards only those that were allowed from this machine (§5.6), and only for the pages and the remote routes (§5.2). A remote can therefore start and stop sounds and playlists on the host, and nothing else. Closing the soundboard (Change soundboard, §3) disconnects every device and forgets its approval. `--UNSAFE-lan-manager` gives every device on the network the Selector and the Initializer without pairing, so any of them can browse the allowed roots, open a soundboard and delete broken options files. |
| Touch | The player has no special handling: touch users may not be able to open the context menus. The remote page (§9.15) is built for a phone. |
| Memory/CPU | Files stream over HTTP Range requests. The server never holds audio in memory. The browser holds decoded audio only for small sound effects, within a fixed memory budget. |
| Target machine | MacBook Neo, 8 GB RAM, macOS, Safari as the likely browser, used at the table during RPG sessions (§12) |

---

## 2. Audio directory layout

```
<root>/
├── .soundboard                 ← marker and app settings (version, volumes)
├── .soundboard-downloads/      ← where downloads work (§5.4); emptied at every start
├── .trash/                     ← deleted sounds, tracks and playlists, at the paths they had (§2.5)
├── Explosion.mp3               ← sound effect
├── Explosion.mp3.json          ← its options
├── Explosion.mp3.wf            ← its waveform, made by the browser (§6.6); disposable
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

1. Names starting with `.` (files or directories, at any depth) are **ignored**. This includes `.soundboard`, `.soundboard-downloads/`, `.trash/`, `.DS_Store` and macOS `._*` files.
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
5. Supported extensions, matched case-insensitively: `.mp3`, `.ogg` and `.opus` (Ogg Opus). The format comes from the extension alone; an `.ogg` that holds Opus is still `ogg` and plays as it always did.
6. Known but unsupported audio extensions (`.wav .flac .m4a .aac .wma .aif .aiff .webm .mp4`) are **reported as warnings** and skipped. All other files are ignored silently, which includes the waveform files (`<file>.wf`, §5.1) next to the audio files.
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
- Track files accept `startAt` and `endAt` and play only that part (§8.1). They accept `fadeIn` and `fadeOut` too, but tracks ignore those.
- `duration` (seconds, 2 decimals, or `null` when it can't be read) and `measuredFrom` (the file's size, modification time and SHA-1 at that moment) are written by bootstrap (§3.5), never by hand. They always come together.
- `source` says where the file came from. Every file has one after its first start (§3.3); it can't be changed through the API yet, but is sent to the browser (§5.2) and shown in the metadata dialog (§9.13).
  ```json
  "source": { "origin": "download", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "extractor": "Youtube", "videoId": "dQw4w9WgXcQ", "playlistId": "PL…", "chapter": 3, "chapterStart": 61.5 }
  ```
  - `origin` says how it was learned: `"download"` (§5.4), `"fileName"` (an id in the file name), `"tags"` (a link in the file's tags) or `"unknown"`, which is just `{ "origin": "unknown" }`. `"edited"` is kept for an editor to come. A `source` without `origin` counts as a download.
  - `url`: for a download, the link as pasted for a direct file or the video's own page for `yt-dlp`; for a guess, the link built or found.
  - `extractor` (yt-dlp's `extractor_key`, since an id only means something on its own site) and `videoId` come with every `yt-dlp` download and every YouTube guess, `playlistId` when a playlist was downloaded or a link carried one, and `chapter` (counting from 1) with `chapterStart` (seconds into the video, 3 decimals) only for a file cut from one chapter.
- `gain` is optional and defaults to `1`. It is the item's own volume as the linear multiplier a Web Audio `GainNode` takes: `1` plays the file as recorded, `2` doubles the amplitude (about +6 dB), `0` is silent. The UI shows it in decibels (§6.4). It is deliberately not called `volume`, because the volumes in `.soundboard` are slider positions, a different thing. A track's `gain` is applied together with its playlist's (§6.4); the track accordion sets it (§9.7).
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
	"playlistLooping": true,
	"trackLooping": false,
	"stopMode": "pause",
	"includedSubdirectories": ["Boss", "Boss/Phase 2"]
}
```
- `gain` means the same as for sounds and tracks, and applies to the whole playlist.
- `crossfade` (§8.4), `fadeIn` and `fadeOut` (§8.5) are in seconds, `0` (the default, off) to `30`, rounded to 3 decimals. Every time the app writes keeps whole milliseconds, which is what the dialogs show.
- `order` is how the playlist moves through its tracks (§8.1): `"ordered"` (the default), `"random"` or `"shuffle"`.
- `playlistLooping` makes the playlist start over after its last track (§8.1); `true` by default. When `false` it stops there instead, for one-shot sequences.
- `trackLooping` makes the current track repeat until the user moves on (§8.1); `false` by default.
- `stopMode` is what stopping the playlist remembers (§8.1): `"pause"` (the track and its position), `"resetTrack"` (the track, to start over) or `"resetPlaylist"` (nothing, the default).
- `includedSubdirectories` lists paths relative to the playlist directory, using `/`. Every depth is listed explicitly.
- Listed directories that no longer exist are ignored. They are not removed.

**Validation (fatal).** Any options file or `.soundboard` that fails `JSON.parse`, is not an object, or has the wrong type for a known key (`title` must be a non-empty string, `gain` must be a number from `0` to `4`, `crossfade`, `fadeIn` and `fadeOut` numbers from `0` to `30`, `order` one of `"ordered"`, `"random"` and `"shuffle"`, `playlistLooping` and `trackLooping` `true` or `false`, `stopMode` one of `"pause"`, `"resetTrack"` and `"resetPlaylist"`, `startAt` a non-negative number, `endAt` a non-negative number or `null` and, when both points are numbers, at least 10 ms (`MIN_CLIP_MS`) after `startAt`, `duration` a non-negative number or `null` and present together with a well-formed `measuredFrom`, `includedSubdirectories` must be an array of strings, `source` an object whose `origin` is one of the five above, whose `url`, `extractor`, `videoId` and `playlistId` are strings, whose `chapter` is a positive integer and whose `chapterStart` is a non-negative number (other keys inside it are kept), `version` must be a positive integer, `volumes.*` must be numbers in `0..1`) is an error. Bootstrap gathers **all** such errors, prints them in red with their paths, and exits with code `1` **before asking any questions or writing anything**. The user must fix or delete those files. Options files of empty playlists are validated too.

**Unknown keys are preserved.** Whenever the app rewrites a file, it reads it again, merges, and writes back the whole object, so keys from future versions survive.

**Writes.** Files are written as JSON with tab indentation and a trailing newline. Each write goes to `<file>.tmp` and is then renamed into place, so a crash cannot leave a half-written file.

### 2.4 Default titles

- A sound or track uses its metadata title if one was found and accepted (§3). Otherwise it uses the **filename exactly as it is, extension included** (`01_battle-theme.mp3`).
- A playlist uses the directory name.
- A download writes its title into the options file: the file name without its extension and without the ` [<videoId>]` tag `yt-dlp` added (§5.4). `Battle Theme [dQw4w9WgXcQ].ogg` becomes "Battle Theme". Only the downloaded video's own id is removed, so brackets that belong to the title, such as `[Live]`, stay. A new playlist takes the title typed in the add dialog (§9.9).
- A file whose source is found in its name (§3.3) loses the ` [<id>]` from its title too. A title that is still exactly the file name also loses its extension, so `Battle [dQw4w9WgXcQ].ogg` becomes "Battle", as a download would be named; a title the user changed only loses the id.

### 2.5 Trash and moves

Deleting from the board never removes a file. Everything deleted goes into `.trash/` in the root, which its dot hides from the scanner, the change watcher and refreshes (§2.1). The trash dialog (§9.12) restores it, or deletes it for good.

- **A sound or a track** keeps its path relative to the root inside the trash, and its options file and waveform go with it: `Boom.mp3` becomes `.trash/Boom.mp3` (+ `.json`, `.wf`), and `Combat/Boss/1.mp3` becomes `.trash/Combat/Boss/1.mp3`. Missing folders are created.
- **A playlist** moves as a whole: its folder with everything in it, including subdirectories that aren't included and files the app doesn't show, and its options file. `Combat/` becomes `.trash/Combat/` and `Combat.json` becomes `.trash/Combat.json`.
- **A playlist's only track** can't leave it alone: deleting it deletes the playlist, and moving it away moves the track and then puts what is left of the playlist in the trash. An empty playlist never exists.
- **Clashes.** Folders are merged into one of the same name already in the trash, so a playlist "Duck" deleted twice, and tracks deleted from it one by one, all end up in `.trash/Duck/`. A playlist's options file replaces the one already there. Any other file whose name is taken gets ` (2)`, ` (3)`… before its extension, and its options file and waveform take the same new name, so they stay paired.
- **Moves.** A sound can become a track of any playlist, and a track can move to another playlist or out to the sounds. A playlist can't be moved. The file keeps its name, with ` (2)` added when it, its options file or its waveform is taken, and lands in the top level of the target: a track from a nested subdirectory doesn't take the subdirectory along. The options file moves unchanged, since sounds and tracks accept the same keys (§2.3), so the title, gain, points and fades carry over. The waveform stays valid, because a rename keeps the size and modified time.

**Reading the trash** (`src/library/trash.js`). Audio files at the top of `.trash/` are **sounds**. Each folder there is a **playlist**, and the audio files inside it, at any depth, are its **tracks**. Titles come from the trashed options files, else the default titles (§2.4): a playlist's from `.trash/<folder>.json`, which a folder left by deleting single tracks doesn't have, so it is named after the folder. Options files in the trash are read leniently: a broken one only loses its title. Dot files and folders without audio are not listed. The **size** counts every file under `.trash/`, listed or not.

**The trash is not watched.** The server reads it at startup and after each of its own deletions, moves, restores and purges. Changes made to it by hand show up at the next start.

**Restoring.** Every options file involved is validated first (§2.3), so a broken one refuses the restore before anything moves.
- **A sound** goes back into the root with its options file and waveform. A taken name gets ` (2)`, as moves do; the title stays as it was.
- **A track** goes into the **top level** of the playlist named after its trashed folder, wherever it sat inside that folder, with ` (2)` on a clash. When that playlist is gone, a new one is created: its folder, and a **copy** of `.trash/<folder>.json`, so the tracks still in the trash keep it. Without one, the new options file has the folder's name as its title. A name taken by a folder or options file the library doesn't show gets ` (2)`.
- **A playlist** whose name is free moves back as it is: the folder with everything in it, subfolders included, and its options file. When a playlist of that name exists, each track is restored into it as above, its options stay as they are, and the trashed options file is dropped.
- **Restore all** restores every playlist, then every sound.
- A restored file is measured when its options file has no current duration, as at startup (§3.5).

**Deleting for good** removes an audio file with its options file and waveform, or a playlist's folder with everything in it and its options file. **Delete all** removes `.trash/` itself. A trashed playlist that has no audio files left, after its last track was restored or deleted, leaves the trash completely, with whatever else is still in its folder and its options file.

---

## 3. Startup

The server starts at once and serves the startup in the browser. It is in one of three **phases**, held by `StartupSession` (`src/startup/startup-session.js`):

1. **`selecting`**: the Selector (§9.18) chooses a folder. `select(path)` checks it with the folder rules (§5.7) and moves on with the path the rules allowed, symbolic links resolved. When folders were given on the command line, only those may be chosen (`Only the folders given when the app was started can be opened.`).
2. **`initializing`**: the bootstrap below runs on the folder, and the Initializer (§9.19) shows its questions, its progress and what failed.
3. **`ready`**: the soundboard is open. The session holds it as a `Board`, `{ handle, close }`: the soundboard's own request handler and services (`createBoard`, §5.2), built once the bootstrap and the download tools are done. The folder is added to the recent folders (§5.8) before the phase changes, so a Selector opened right after already lists it.

**Change soundboard** (☰ menu, §9.3) calls `POST /api/startup/close`: `close()` goes back to `selecting` and closes the board, which ends every event stream with `startup.closed`, cancels a running download, forgets every allowed device (§5.6) and stops the change watcher. `shutdown()` closes whatever is open when the app stops; it is safe in any phase and twice.

The decision logic of loading a folder is the domain service `BootstrapService` (`src/library/`). It asks and reports through two ports, `Prompter.confirm(question) → Promise<boolean>` and `Reporter`, so the whole flow is tested with fakes. The session is both while it loads a folder: it keeps what is reported as structured state for the Initializer, and turns each question into one the page shows, with an id and the details reported just before it (the nested folders, the titles, the file count). Only what needs a decision, and the progress, reaches the page; the warnings become problems in the board's Problems dialog (§5.1, §9.14) as before. Every load has its own generation, so the answers and reports of a load that was abandoned are ignored, and a board that finished opening for nobody is closed at once. `src/cli/main.js` wires it all together; the terminal asks nothing.

- **Ctrl+C** or **typing `exit`** stops the app in any phase: `main` reads stdin line by line, and a line that is `exit` (any case, spaces around it ignored) shuts down like SIGINT. Other lines are ignored, and closed input does not stop the app. Stopping during the questions is safe because every write is atomic and `.soundboard` is written last.
- **Colors** in the terminal use ANSI codes, yellow for warnings. They are off when `NO_COLOR` is set to a non-empty value or stdout is not a TTY.

### 3.1 Steps common to both modes

1. Parse arguments. On a usage error (unknown option, invalid port, an empty `--whitelisted-root`), print the reason, the usage line and a pointer to `--help` to stderr and exit `1`. Folders given on the command line are only checked in the Selector, where a refused one shows why (§9.18).
2. **Scan** the tree (§2.1). Scanning reads directory listings and file sizes and modification times only, never file contents.
3. **Validate** every existing options file and `.soundboard` (§2.3). Any error stops the load: the Initializer shows each file and its problems (§3.7).
4. **Report warnings**: unsupported audio files, orphan options files, symlinks, empty playlists. These never stop the app; they become problems (§5.1).

Playlists without tracks take no further part: no question is asked about their nested directories and no options file is created for them.

### 3.2 First run (no `.soundboard`)

5. **Large folder.** When the folder holds more than 5,000 audio files (`LARGE_FOLDER_FILES`), report the count and ask `LARGE_FOLDER_QUESTION`, since a first run writes an options file next to each and a whole music collection is easy to choose by mistake. **No** goes back to the Selector without writing anything.
6. **Nested subdirectories.** If any exist, report them as `Combat/Boss` and ask `NESTED_DIRECTORIES_QUESTION`:
   - **No:** back to the Selector without writing anything.
   - **Yes:** each one is recorded in its playlist's `includedSubdirectories` (written in step 8).
7. **Metadata titles.** For every audio file **without** an options file, try to read a title (§4). If any were found, report them as `path → "Title"` and ask `METADATA_TITLES_QUESTION`.
   - No means filenames are used for all of them; the load goes on.
8. **Write**:
   - An options file for every sound and track that lacks one. The title comes from step 7, or the filename.
   - An options file for every playlist that lacks one. The title is the directory name, plus the accepted subdirectories.
   - Playlist options files that already exist get the accepted subdirectories merged in.
   - **`.soundboard` last**, as `{ "version": 1, "volumes": { "master": 1, "music": 1, "sfx": 1 } }`. If anything fails before this point, the next run is still treated as a first run.

### 3.3 Later runs (`.soundboard` exists)

5. **New nested subdirectories.** These are subdirectories not listed in the playlist's `includedSubdirectories`. A brand-new playlist has none listed, so all of its subdirectories count as new. If there are any, report and ask exactly as in §3.2 step 6. No goes back to the Selector; Yes appends them to the list and writes the file.
6. **Missing options files.** For every audio file without one, generate it **without asking**: the metadata title if found, otherwise the filename. Missing playlist options files are created as in §3.2 step 8. `.soundboard` is not rewritten.

**Sources, in both modes.** Every sound and track whose options file has no `source` gets one (§2.3), so each file is examined once (`src/library/sources.js`). A new options file gets it in the same write; an existing one has it merged in, and these writes are counted with the generated options.
1. **The file name.** The last `[…]` right before the extension, holding exactly 11 characters of `A–Z a–z 0–9 _ -`, is a YouTube video id, as `yt-dlp` names files (`Title - 003 Intro [id].ogg` included). The source is `{ origin: "fileName", url: "https://www.youtube.com/watch?v=<id>", extractor: "Youtube", videoId }`, and the title loses the id (§2.4). False positives, such as `[Instrumentl]`, are accepted, and nothing is checked online.
2. **Otherwise, the tags.** The first link `readSourceLink` finds (§4) becomes `{ origin: "tags", url }`. A YouTube link also gives `extractor`, `videoId` and, with a `list=` parameter, `playlistId`. The known forms are `watch?v=` on `youtube.com` and its `m.` and `music.` hosts, `youtu.be/<id>`, and `/shorts/`, `/embed/`, `/live/` and `/v/`.
3. **Otherwise** `{ origin: "unknown" }`.

### 3.4 Result

Bootstrap reports how many options files it created or updated and how many playlists and sounds were loaded. It returns an in-memory `Library` (§5.1), a `SettingsStore` loaded from `.soundboard`, and the scan it built them from, which the change watcher compares against (§5.3). The server keeps only these, never file contents. A refresh builds them again (§3.6).

**The download tools** are prepared as soon as the app starts, while the Selector is open, not after a bootstrap. `src/cli/main.js` keeps what it finds in the shared `AppInfo`, whose `checking` is set until it is done (`GET /api/info`, §5.2):
1. It looks for the tools (`findTools`: `yt-dlp --version`, `ffmpeg -version`) and prints `Downloads: yt-dlp 2026.08.19, ffmpeg 7.1.1`, or in yellow `Downloads are off: ffmpeg was not found.` A missing tool never stops the app.
2. When yt-dlp was found, it prints `Checking for a yt-dlp update…` and runs `yt-dlp -U` (`updateYtDlp`, §5.4), which installs a newer version when it is allowed to write its own file. It prints `yt-dlp is up to date (2026.10.26).` or `yt-dlp updated to 2026.10.26.`, and after an update looks the versions up again. In yellow, it prints `yt-dlp 2026.10.26 is available (installed: 2026.10.21), but the update failed: Insufficient permissions to write to /usr/bin`, which also becomes a problem (§5.1), or `Could not check for a yt-dlp update: …`, which does not.

**Opening the board.** When the bootstrap succeeds and the tools are not done yet, the Initializer waits on `waitingForTools`, so no download can start during the update. Then `main` empties `.soundboard-downloads/`, since jobs never outlive the soundboard (§5.4), starts the change watcher on the scan, builds the board (`createBoard`, §5.2) and prints `Opened <folder>: N playlists and M sounds.`. Closing it stops the watcher and prints `Closed <folder>.`. A failure while opening (the watcher, the workspace) stops the watcher and shows the error in the Initializer.

### 3.5 Durations

In both modes, after the questions and without asking anything, bootstrap makes sure every sound and track has a current `duration` (§2.3). The decision is `measureIfNeeded` in `src/library/durations.js`:

- **No `duration` yet:** hash the whole file (SHA-1, `node:crypto`), read its duration (§4.3), and store both.
- **Same size and modification time as `measuredFrom`:** nothing is read.
- **Otherwise:** hash the whole file. If the hash is the same, only `size` and `modified` in `measuredFrom` are refreshed, because the file was merely copied or touched. If it differs, the file was replaced, so the duration is read again.

A file whose duration can't be read is stored as `"duration": null` with its `measuredFrom`, so it isn't read again on every start. New options files get their duration in the same write as their title; existing ones are merged as usual (§2.3), and each counts as updated in the report. Before any file is read, bootstrap reports how many will be (`measuringDurations`), then `measured(done, total)` after each one, which the Initializer shows as a progress bar. The first run therefore reads every file once; later runs only read files that look changed.

### 3.6 Refresh

While the server runs, `BootstrapService.refresh(root)` builds the library again from the files, as a later run would (§3.3), when the page asks for it after external changes (§5.3). The terminal prints `Refreshing after external changes…`; the reports go to the session, which ignores them once the soundboard is open. It never asks anything. Differences from opening the folder:

- **No `.soundboard`** would make it a first run, which has questions to ask. The refresh stops at once with `noSettings`, writing nothing, and the page asks for a restart (§9.0).
- **Validation errors** (§2.3) don't end the process. The refresh returns them (`invalid`), writes nothing, and the server keeps the library it has.
- **New nested subdirectories** are merged into their playlists without asking, but **not recorded** in `includedSubdirectories`. A playlist options file the refresh creates lists none either. The next time the folder is opened, the Initializer therefore still asks about them and records the answer (§3.3 step 5).
- **Orphaned files** only get the usual warnings (§3.1 step 4).

On success the server replaces its library and settings store with the new ones (§5.2), and the change watcher takes a new baseline (§5.3).

### 3.7 Failures, Back and Try again

- **Validation errors** (§2.3) put the Initializer on `failed`, listing each file relative to the folder with its problems (`failures`). `canDelete` is set when every one of them is the app's own file inside the folder: an options file (`.json`) or `.soundboard`, never an audio file.
- **Anything else that goes wrong**, such as a folder that can't be read, is logged to stderr and also puts it on `failed`, with the message as `error` and nothing to delete.
- **Back** (`back()`) answers No to a waiting question, which returns to the Selector as a No does, or leaves a failure for the Selector. While the folder loads it is refused.
- **Try again** (`retry()`) loads the same folder again after a failure, for instance once the files were fixed by hand.
- **Delete and retry** (`deleteAndRetry()`) deletes exactly the listed files and loads the folder again. Without `.soundboard` that is a first run, with its questions. A file that can't be deleted shows `Could not delete a file: …` and stays on `failed`.
- A question is answered by its id (`answer(id, yes)`), so an answer to a question that is no longer asked, from another tab for example, is refused.

---

## 4. Metadata extraction

`readTitle(filePath) → Promise<string | null>`, `readSourceLink(filePath) → Promise<string | null>` and `readDuration(filePath) → Promise<number | null>` in `src/metadata/` pick the parser by extension (`.mp3`, `.ogg`, `.opus`, case-insensitive; the last two both go to `ogg.js`). They return `null` for missing or malformed data and only throw for file system errors. They read through a file handle with bounded reads and never load the whole file. No third-party code is involved.

### 4.1 MP3: ID3v2, falling back to ID3v1

- **ID3v2.2, 2.3 and 2.4.** Read the 10-byte header (`"ID3"`, version, flags, syncsafe size). Skip the extended header if present (a v2.2 tag with that flag set is treated as unreadable). Walk frame headers one at a time, reading only headers and skipping over frame bodies, until the title frame (`TIT2`, or `TT2` in v2.2) is found, padding begins, or the tag ends.
  - Frame sizes are syncsafe in v2.4 and plain 32-bit in v2.3.
  - Text encodings: `0` ISO-8859-1, `1` UTF-16 with BOM, `2` UTF-16BE, `3` UTF-8. The first of several null-separated values is used, trimmed. An empty title counts as missing.
  - If tag-wide unsynchronization is set (v2.2/2.3), read the whole tag (giving up beyond **2 MB**), reverse the unsynchronization, then parse. In v2.4, the title frame's own flags are honored: unsynchronization, data length indicator and group byte.
  - Compressed or encrypted title frames count as missing. A title frame over 64 KB is ignored.
- **ID3v1.** If there is no ID3v2 title, read the last 128 bytes. If they start with `TAG`, bytes 3–32 hold the title in ISO-8859-1, trimmed.
- **Source links.** The same walk reads the frames where `yt-dlp --embed-metadata` and taggers keep a file's page, and takes the first `http(s)` link from them, in this order: a user link (`WXXX`; its URL is always ISO-8859-1, after a description in the frame's encoding), a user text frame described "purl" (`TXXX`), the official source link (`WOAS`), then a comment (`COMM`, after its language and description). ID3v2.2 uses `WXX`, `TXX`, `WAS` and `COM`. Each frame is read only when wanted, with the title frame's limits and flags; a frame over 64 KB, compressed or encrypted is skipped. ID3v1 has no links.

### 4.2 OGG: Vorbis comments

- Read Ogg pages (`"OggS"` capture pattern, segment table) of the first logical stream, ignoring pages of other multiplexed streams, and reassemble the first two packets. The second is the comment header. Reading stops after **1 MB**, because comment packets can hold embedded cover art; whatever part of the comments arrived is still searched.
- Recognize Vorbis (`\x01vorbis` / `\x03vorbis`) and Opus (`OpusHead` / `OpusTags`). Parse the vendor string, then the comment list. The value of the first non-empty `TITLE=` entry (key matched case-insensitively) is the title, decoded as UTF-8.
- The source link is the first `http(s)` link in a `PURL` entry, else in `COMMENT`, else in `DESCRIPTION`.
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
Playlist  { id, title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode, tracks: AudioFile[], includedSubdirectories: string[] }
AudioFile { id /* root-relative POSIX path */, title, format: 'mp3'|'ogg'|'opus', size, gain, duration /* seconds or null */,
            startAt, endAt /* seconds or null */, fadeIn, fadeOut, source /* §2.3, origin filled in, or null */, absolutePath }
Settings  { volumes: { master, music, sfx } }   // held by SettingsStore, saved to .soundboard
```

- `playlists` contains only non-empty playlists, sorted by title; `sounds` are sorted by title; tracks keep path order (§2.2).
- `files` indexes every sound and track by id. It is the only list of files the server may stream.
- `LibraryEditor` changes the library while the app runs. `updateSound(id, { title?, gain?, startAt?, endAt?, fadeIn?, fadeOut? })` validates the change with the options file rules (§2.3), rejects unknown keys, trims the title, and rounds the numbers. The points are checked again after merging with the sound's current ones, so a change to one point must still fit the other. It then merges the change into the sound's options file (read, merge, atomic write, unknown keys kept), and only once that succeeded updates the `AudioFile` in place and sorts `sounds` again. Writes to one options file run one after another in the order they were requested, so the file always ends with the newest values; a failed write doesn't block later ones. An id that isn't a sound (including a track id) is an `UnknownSoundError`.
- `updatePlaylist(id, { title?, gain?, crossfade?, fadeIn?, fadeOut?, order?, playlistLooping?, trackLooping?, stopMode? })` does the same for a playlist's options file (`<directory>.json` in the root), leaving its `includedSubdirectories` alone, and sorts `playlists` again after a rename. The crossfade, the order, track looping and the stop mode are accepted only here, and the points only for sounds. An unknown id is an `UnknownPlaylistError`.
- `updateTrack(id, { title?, gain?, startAt?, endAt? })` does the same for a track's options file (`<file>.json` next to it), with the same checks and rounding as for sounds. Only those four are accepted. Tracks keep their path order (§2.2), so nothing is sorted again. An id that isn't a track (including a sound id) is an `UnknownTrackError`.
- **Additions** (§5.4). `addSound(from, name, { title, source })`, `addTrack(playlistId, from, name, options)` and `createPlaylist(title, from, name, options)` take a finished download, which sits on the same file system as the root.
  - Each one moves the file into place, in the root or the playlist's directory, under `name`. When that name, or its options file's name, is taken, ` (2)`, ` (3)`… is added before the extension, so nothing is overwritten and no old options file is taken over.
  - It measures the duration (§3.5) and writes the options file with `title`, `source`, `duration` and `measuredFrom`. Then it adds the file to `Library.files` and to `sounds` or the playlist's `tracks`, sorted as at startup (§2.2): sounds by title, tracks by path, so an added track takes its place by name.
  - `createPlaylist` names the directory after the title (unsafe characters removed, ` (2)` when the directory or `<name>.json` exists), writes `<directory>.json` with the title and an empty `includedSubdirectories`, and adds the first track, so an empty playlist never exists.
  - Each returns the item plus `written`, every file it created, for the change watcher (§5.3). `playlist(id)` looks a playlist up.
- **Deletions and moves** (§2.5). `deleteSound(id)`, `deleteTrack(id)`, `deletePlaylist(id)`, `moveSound(id, playlistId)` and `moveTrack(id, playlistId | null)`, where `null` means the sounds. `file-moves.js` does the renaming: `moveAudioFile` (an audio file with its companions, under a free name) and `mergeDirectory`.
  - Each takes the item out of the library first, so a save requested afterwards fails as unknown. It then waits for the writes already queued on the item's options files, and on the playlist's for a playlist or a last track, so none can recreate a file at its old path. It waits before the work goes to the change watcher, which runs saves and these tasks in turn.
  - The files are then moved through an injected `writeFiles`, the watcher's (§5.3). If that fails, the item is put back.
  - A move puts the file into `sounds` (sorted by title) or the target's `tracks` (sorted by path) under its new id, and both update `Library.files`.
  - Each returns `{ changes, removed, renamed }`. `changes` lists what happened, in order, as `library.removed` (`{ soundId }`, `{ trackId, playlistId }` or `{ playlistId }`) and `library.added` (`{ sound }` or the receiving `{ playlist }`). A playlist's last track is reported as the playlist's removal. `removed` lists the files that left the root and `renamed` the `[from, to]` pairs within it, for the watcher.
- **The trash** (§2.5). `restoreFromTrash(item | 'all')` and `purgeFromTrash(item | 'all')`, where `item` is `{ kind: 'sound' | 'track' | 'playlist', id }` and the id is the item's path inside the trash, the id it had in the library.
  - Both run as one task through `writeFiles`, so they take their turn with saves, additions and refreshes. Each reads the trash afresh and looks the item up in that listing (`findInTrash`), so only what the trash holds can be named, never another path; anything else is an `UnknownTrashItemError`. A broken options file is a `ValidationError`.
  - A restore adds what came back to the library as additions do, sounds by title and tracks by path, and returns `{ changes, written }`: one `library.added` per sound or receiving playlist (sent whole), and for the watcher each restored audio file and its options file. Waveforms are left out of `written`, since the watcher never follows them and one in its baseline would count as gone.
  - `trash.js` holds the reading (`readTrash`, with sizes), the purging helpers and `Trash`, which keeps the summary `{ size, count }` for the event streams: `count` is the listed playlists plus sounds. `reload()` reads it again and tells its listeners when the summary changed.
  - Moving a track into its own playlist is a `ValidationError`; unknown ids and target playlists are the `Unknown…Error`s.
- `WaveformStore` (`waveform-store.js`) keeps one waveform file, `<audio file>.wf`, next to each sound and track, beside its `.json` options file. The browser makes the waveforms (§6.6); the store only holds them. A file is a 16-byte header, then 2048 signed bytes:
  - The header is the magic `SBW1`, the bucket count (u16, always 1024), two reserved bytes, the audio file's size (u32) and its modified time in whole seconds (u32). The server fills the last two in from the audio file when it stores a waveform.
  - The bytes are 1024 pairs: the lowest and the highest sample of each of 1024 equal slices of the audio, across all channels, scaled to −127..127.
  - A waveform is **stale** when the audio file's size or modified time no longer matches its header, and a file with a bad magic, count or length is unusable. Both count as missing and are overwritten when made again. Writes go through a temporary file and a rename.
  - `missing()` lists the ids that have no current waveform: sounds in library order, then tracks in playlist order. `read(id)` returns the peaks or `null`; `write(id, peaks)` takes exactly 2048 bytes (`InvalidWaveformError` otherwise). An id that is not a sound or track is an `UnknownWaveformFileError`. Deleting a `.wf` file is harmless: it is made again.
- **Problems** (`problems.js`). `startupProblems(warnings, library)` turns what bootstrap found into a list of `{ id, kind, severity, path, message }`: the scan's warnings (§3.1 step 4: `unsupported-audio`, `orphan-options`, `symlink`, `empty-playlist`) as `warning`s, and every sound or track whose `duration` is `null` (§3.5, kind `unknown-duration`) as an `error`. The `id` is `<kind>:<path>`, so the same problem keeps its id. A `ready` outcome of bootstrap and of a refresh carries the list (`problems`); the terminal output is unchanged.
  - A failed yt-dlp update (§3.4, §5.4) is a `warning` of kind `ytdlp-outdated` with the path `yt-dlp` and the terminal's message. It is added with `addLasting`, since it isn't about the library.
  - `Problems` holds the list in the server, replaced by every refresh except for its lasting problems, which stay first. `dismiss(id)` reports whether it knew the problem, `dismissAll()` empties it, `removeFor(path)` forgets a deleted or moved file's problems, and a directory's with everything in it. `onChange` fires only when the list really changed. Nothing is saved to disk: dismissed problems come back at the next start or refresh if the files are still wrong.
  - Invalid options files are not problems: they stop a start (§3.1 step 3) or a refresh (§3.6), which has its own dialog (§9.1).
- `SettingsStore` keeps the settings in memory and writes them back to `.soundboard` with the same read-merge-write and atomic rename as the options files (§2.3). Writes are **serialized**: one in flight at a time, and changes made meanwhile are written together by one follow-up write, so the file always ends with the newest values.

### 5.2 HTTP API (`src/http/`, built on `node:http`)

The server knows nothing about playback state.

**The app server** (`app-server.js`, `startApp`) owns the port and answers by the startup phase (§3). It runs the request guard (below) first, then:
- `GET /api/startup/ready` answers `{ ready }` to anyone, in any phase: what the waiting page polls.
- **Another device** (with `--lan`, a request not from a loopback address) goes to the board once the phase is `ready`. Before that it gets the waiting page, unless `--UNSAFE-lan-manager` is set, in which case it is treated like this machine. The waiting page is `public/waiting.html` for every page path (`/`, a path ending in `.html`, or one without an extension), plus `/favicon.svg` and the Tailwind file; every `/api/…` path answers `503 { "error": "No soundboard is open." }` with `Retry-After: 2`, and anything else `403`. The page reads "No soundboard is open", polls the ready route every 2 s and reloads once one is, which brings the connect page (§9.16).
- On this machine, `GET /api/info` and the startup routes below are answered by the app server in every phase.
- Once `ready`, everything else goes to the board's handler. Before that, every other `/api/…` path answers `503 { "error": "No soundboard is loaded." }`, and every page path gets `public/selector.html` in `selecting` or `public/initializer.html` in `initializing`; other static files are served as usual.
- When the port is taken, the next ones are tried, up to `PORT_ATTEMPTS` (10) in all; it rejects with the last error. Its `url` is `http://localhost:<port>`.

**The board** (`server.js`, `createBoard`) is everything that serves one open soundboard: its services and the router below, with no listening socket of its own. It takes the app's `AccessControl`, so bans outlive it, and the shared `AppInfo`. `close()` ends every event stream with `startup.closed` (each stream registers itself in the board's `streams`, and writes nothing once it has ended), cancels a running download and calls `revokeAll()` (§5.6). It is safe to call twice. `startServer` wraps a board in a server of its own, on `127.0.0.1`, for the tests.

| Method | Path | Response |
|---|---|---|
| GET, HEAD | `/` and other paths | Files from `public/` (`/` serves `index.html`, or the page of the startup phase, above), with a MIME map and `Cache-Control: no-cache`. 404 for anything missing or outside `public/`. |
| GET | `/api/info` | `{ app, checking, ytDlp: { version, update }, ffmpeg }`: `package.json`'s version, whether the tools are still being looked for and updated (§3.4), and each tool's version, `null` when it is missing or not known yet. `update` is what `yt-dlp -U` did at startup (§5.4), `null` when it didn't run. |
| GET | `/api/startup` | `{ phase, paths, recent, initializer, tools }`. `paths` is `null`, or the folders given on the command line, each `{ path, name, allowed, reason }` (§5.7). `recent` is `[{ path, name, exists }]` (§5.8), empty when paths were given. `initializer` is `null` outside `initializing`, else `{ root, step, question, progress, failures, error, canDelete }` (§3, §3.7): `step` is `scanning`, `question`, `measuring`, `waitingForTools`, `starting` or `failed`; `question` is `{ id, kind: 'largeFolder', count }`, `{ id, kind: 'nestedDirectories', paths }` or `{ id, kind: 'metadataTitles', titles: [{ path, title }] }`; `progress` is `{ done, total }`; `failures` is `[{ path, problems }]`. `tools` is the `/api/info` answer. |
| GET | `/api/startup/folders` | Without `path`, `{ places: [{ name, path }] }` (§5.7). With `?path=<absolute path>`, the folder's listing: `{ path, parent, folders: [{ name, path, soundboard, refused }], audioFiles, soundboard, allowed, reason }`, with `path` resolved and `refused` judged by each subfolder's path alone. `403` with the reason for a folder outside the roots or hidden, and for any listing when paths were given on the command line; `404` for a folder that can't be read. |
| POST | `/api/startup/select` | Body `{ path }`: starts loading it (§3). `204`; `400` with the reason for a refused folder or a missing `path`; `409` unless `selecting`. |
| POST | `/api/startup/answer` | Body `{ id, yes }`. `204`; `400` for another body; `409` when that question isn't asked. |
| POST | `/api/startup/back`, `/api/startup/retry`, `/api/startup/delete-and-retry` | §3.7. `204`; `409` when not possible in this phase or step. |
| DELETE | `/api/startup/recent` | Body `{ path }`: forgets a recent folder. `204`. |
| POST | `/api/startup/close` | Closes the soundboard (§3). `204`; `409` unless `ready`. |
| GET | `/api/library` | JSON (below) |
| GET | `/api/settings` | `{ "volumes": { "master": 1, "music": 0.8, "sfx": 1 } }` |
| PUT | `/api/settings/volumes` | Body `{ master?, music?, sfx? }` (numbers in `0..1`). Merged into the settings and saved; returns the full settings. `400` for invalid JSON, a non-object, an out-of-range value or an unknown key. `413` for bodies over 16 KB. |
| PATCH | `/api/sounds/<encoded id>` | Body `{ title?, gain?, startAt?, endAt?, fadeIn?, fadeOut? }`. Saved through `LibraryEditor` (§5.1); returns the updated sound in the `/api/library` format. `400` for invalid JSON, a non-object, an unknown key, an empty title, an out-of-range value, or points less than 10 ms apart. `404` when the id isn't a sound. `413` for bodies over 16 KB. |
| DELETE | `/api/sounds/<encoded id>`, `/api/tracks/<encoded id>`, `/api/playlists/<encoded id>` | Moves the item into the trash (§2.5) and answers `200 { changes }`: the `library.removed` messages below, which every event stream gets too, so the page that asked can apply them at once. `404` for an unknown id. |
| POST | `/api/move` | Body `{ id, to }`: a sound or track id, and a playlist id or `null` for the sounds. Moves it (§2.5) and answers `200 { changes }`, a `library.removed` and a `library.added` message, as for deletions. `400` for a body without them, a sound moved to the sounds or a track to its own playlist; `404` for an unknown id or playlist. The id is in the body because a track id takes up the rest of a path. |
| DELETE | `/api/problems/<encoded id>`, `/api/problems` | Dismisses one startup problem (§5.1), or all of them; `204`. The first answers `404` for an unknown id. Every event stream gets the new list (`problems` below). |
| GET | `/api/trash` | `{ size, playlists: [{ id, title, size, tracks: [{ id, title, size }] }], sounds: [{ id, title, size }] }`: what the trash holds (§2.5), playlists and sounds by title, tracks by path, sizes in bytes. |
| POST | `/api/trash/restore` | Body `{ kind: "sound" \| "track" \| "playlist", id }` or `{ all: true }`. Restores it (§2.5) and answers `200 { changes }`, the `library.added` messages, which every event stream gets too. `400` for another body or a broken options file, `404` for what the trash doesn't hold. |
| POST | `/api/trash/delete` | The same body. Deletes it for good and answers `200 { changes: [] }`, with the same errors. |
| PATCH | `/api/playlists/<encoded id>` | The same for a playlist, with body `{ title?, gain?, crossfade?, fadeIn?, fadeOut?, order?, playlistLooping?, trackLooping?, stopMode? }` (`LibraryEditor.updatePlaylist`); returns the playlist with its tracks in the `/api/library` format. |
| PATCH | `/api/tracks/<encoded id>` | The same for a track, with body `{ title?, gain?, startAt?, endAt? }` (`LibraryEditor.updateTrack`); returns the track. The id contains `/`: the rest of the path is decoded as a whole, which keeps literal slashes, so `Combat%2F1.mp3` and `Combat/1.mp3` both work. The browser sends the first. |
| GET | `/api/waveforms` | `{ "missing": ["Boom.mp3", "Combat/1.mp3", …] }`: the ids with no current waveform, sounds first (`WaveformStore.missing`) |
| GET | `/api/waveforms/<encoded id>` | The 2048 peak bytes as `application/octet-stream` (the header stays on the server). `404` when there is no current waveform or the id is not a sound or track. |
| PUT | `/api/waveforms/<encoded id>` | Body: exactly 2048 bytes of peaks. Stored next to the audio file; `204`. `400` for another length, `404` for an unknown id, `413` for bodies over 4 KB. `415` unless the type is `application/octet-stream`. Ids are decoded as for tracks. |
| GET | `/api/events` | Server-sent events (`text/event-stream`, `Cache-Control: no-store`), each a JSON object with a `type` (below). A `: keep-alive` comment every 30 s keeps the connection open. The stream stays open until the page goes away or the server stops. A page that plays adds `?page=<id>` (its page id, §5.5); a remote adds `?role=remote` and gets only the remote messages below. |
| GET | `/api/download` | `{ "tools": { "ytDlp": "2026.08.19", "ffmpeg": "7.1.1" }, "job": null }`: the tools found at startup (`null` for a missing one) and the current download (§5.4) with its whole `log`, or `null`. Without downloads at all (tests), both tools are `null`. |
| POST | `/api/download/probe` | Body `{ url, playlist? }`. Looks the link up and returns it with a `probeId` (§5.4). `400` without a `url`, `422 { error }` for a link that can't be used (the message is meant for the user), `503` when the tools are missing. |
| POST | `/api/download` | Body `{ probeId, target, chapters?, entries? }`: `target` is `{ kind: "sound" }`, `{ kind: "newPlaylist", title }` or `{ kind: "playlist", playlistId }`; `chapters` lists chapter indices to cut (null or missing keeps the video whole); `entries` lists the playlist entry ids to download. Starts the job and answers `202` with it. `400` for a request that doesn't fit the lookup (an unknown or forgotten `probeId`, no chapter or entry chosen, an empty title, a playlist that is gone), `409` while another job runs, `503` without the tools. |
| DELETE | `/api/download` | Cancels the running job, or dismisses a finished one; `204`. |
| POST | `/api/changes/check` | A quick check of the directory, by size and modified time only (§5.3). Returns `{ "externalChanges": true }` or `false`. |
| POST | `/api/refresh` | Rebuilds the library from the files (§3.6) and answers once it has finished: `200 {}`. `422 { "error": "Some options files are invalid", "errors": [{ "path": "Combat/1.mp3.json", "message": "…" }] }` with one entry per problem, the path relative to the root using `/`; the old library stays. `503` when `.soundboard` is gone ("Restart the app"), or when the server was started without a refresh (tests). |
| GET, HEAD | `/media/<encoded id>` | The audio file, streamed |
| GET | `/api/remote` | `{ "host": true }` or `false`: whether a page is the host (§5.5) |
| PUT | `/api/remote/host` | Body `{ pageId, replace? }`. Makes that page the host and answers `200 {}`. `409` when another page is the host and `replace` is not `true`, `400` for a body without a page id or for a page with no event stream. |
| DELETE | `/api/remote/host?page=<id>` | The host gives up the role; `200 {}`. |
| PUT | `/api/remote/state` | Body `{ pageId, state }`, the host's `RemoteState` (§6.10); `200 {}`. `409` unless that page is the host, `413` over 512 KB. |
| POST | `/api/remote/commands` | Body: a command (§6) for the host; `200 {}`. `400` unless it is one a remote may send, `409` when there is no host. |
| POST | `/api/access/requests` | With `--lan` only (`404` without). Starts pairing for the caller's address, or finds the request it already has, and answers `{ status: 'pending', code }`, or `{ status: 'banned' }` when this request was one too many (§5.6). The only route that counts toward the limit. |
| GET | `/api/access/requests/mine` | With `--lan` only. Polled by the connect page: `{ status: 'none' \| 'pending' \| 'allowed' \| 'denied' \| 'banned', code? }`. The first answer that reports `allowed` also sets the device cookie. Not counted. |
| POST | `/api/access/requests/answer` | With `--lan` only, and for this machine only. Body `{ address, decision: 'allow' \| 'deny' }`; `200 {}`. `400` for anything else, `404` when that address has no pending request. |
| GET | `/api/access/links` | With `--lan` only, and for this machine only. `{ links: ['http://192.168.1.20:13872/'] }`: the addresses that open the app from another device, for the QR code (§9.16). |

- API responses are JSON with `Cache-Control: no-store`. Errors are `{ "error": "message" }`.
- A known path with the wrong method gets `405` with an `Allow` header. Unknown `/api/…` paths get a JSON `404`.
- Every route that reads a JSON body (`PUT`, `PATCH` and `POST` above) answers `415 { "error": "Send application/json" }` for any other `Content-Type` (parameters and case are ignored). The waveform `PUT` needs `application/octet-stream` the same way.

**Request guard** (`request-guard.js`). Any web page open in the same browser can send requests to `127.0.0.1`, and a page that rebinds its DNS name to it can even read the answers. `checkRequest` runs first for every request, whatever its path (API, media and static files alike), and answers `403 { "error": "Request not allowed" }` when:
- **`Host`** is missing or is not `127.0.0.1`, `localhost` or `[::1]` with the server's own port. This stops DNS rebinding, because the rebound page still sends its own name. The names come from one list (`LOOPBACK_HOSTS`, passed to the router in its context), so LAN access can extend it.
- **`Origin`** is present and is not `http://` plus one of those same names. Browsers send it on every cross-site request and on every request that is not a `GET`, so this stops cross-site `POST`s, including the ones with no body (`/api/refresh`, `/api/changes/check`) that a content-type rule can't cover. A request without `Origin` (the page's own `GET`s, `curl`, the tests) passes.

The `415` rule above is the second line of defense: a page on another site can't send `application/json` or `application/octet-stream` without a preflight request, and the server sends no CORS headers and gives `OPTIONS` a `405`. The 403 body doesn't repeat the header that was refused.

**LAN access** (`lan-access.js`). Without `--lan` the server listens on loopback and none of this applies. With it, the `Host` names above also include the addresses and the host name of this machine, and `checkAccess` runs after the guard for every request that does not come from a loopback address:
- A **banned** address (§5.6) gets `403 { "error": "This address is blocked" }` for everything. The connect page tells this refusal from the others by its text.
- A device needs the cookie **`soundboard-device`** (`HttpOnly`, `SameSite=Lax`) that it got when it was allowed (§5.6). `Lax` and not `Strict`, because a link opened from another app, such as a camera scanning a QR code, is a cross-site navigation, and the cookie would be left out of it.
- A device **with** the cookie may only reach: `GET` and `HEAD` of the static files, `/api/remote…`, and `/api/events?role=remote`. Everything else (the library, settings, media, deletions, downloads, the pairing routes, a page's own event stream) answers `403`, so a phone can see titles and send play commands, and never touches the files or hears the audio.
- A device **without** it may only reach the connect page, which is what `GET /` and `GET /index.html` answer instead of the app (`public/connect.html`), the files the connect page loads (`/favicon.svg`, the Tailwind file, `/app/connect.js`, `/app/browser-clock.js`, `/app/logic/access-requester.js` and `/app/ui/dom.js`), `POST /api/access/requests` and `GET /api/access/requests/mine`. Everything else answers `403`.
- The remote page learns the titles from the host's state (§6.10), so it needs no `/api/library`.

`/api/library`
```json
{
	"version": 1,
	"playlists": [
		{ "id": "Combat", "title": "Combat", "gain": 0.8, "crossfade": 2.5, "fadeIn": 1, "fadeOut": 3, "order": "shuffle", "playlistLooping": true, "trackLooping": false, "stopMode": "resetPlaylist", "tracks": [
			{ "id": "Combat/01 Battle.mp3", "title": "Battle", "format": "mp3", "size": 4194304, "gain": 1, "duration": 213.47,
			  "startAt": 0, "endAt": null, "fadeIn": 0, "fadeOut": 0, "url": "/media/Combat/01%20Battle.mp3",
			  "source": { "origin": "fileName", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "extractor": "Youtube", "videoId": "dQw4w9WgXcQ" } }
		] }
	],
	"sounds": [
		{ "id": "Explosion.mp3", "title": "Big Explosion", "format": "mp3", "size": 48213, "gain": 0.5957, "duration": 4.21,
		  "startAt": 0.25, "endAt": 3.8, "fadeIn": 0.05, "fadeOut": 0.5, "url": "/media/Explosion.mp3", "source": { "origin": "unknown" } }
	]
}
```
Each path segment of a media URL is percent-encoded separately. `source` is the stored one (§2.3) with `origin` filled in, or `null` for a file bootstrap hasn't given one. The library reflects changes made through `PATCH`, downloads, deletions and moves, so a reload shows them.

**Event stream messages** (`src/http/events.js`). Every connection from a page starts with `externalChanges`, `problems`, `trash` and, when downloads are available, a `download` message carrying the whole log, so a page that was away misses nothing.

| `type` | Payload | Sent |
|---|---|---|
| `externalChanges` | `{ pending }` | on connect, then whenever the value changes (§5.3) |
| `download` | `{ job }`, with `log` (every line) on connect | whenever the job starts, moves to another item or step, or ends; `job` is `null` once dismissed |
| `download.log` | `{ lines, replaceLast }` | new log lines, batched at most every 250 ms; with `replaceLast`, the first line replaces the last one already sent (§5.4) |
| `library.added` | `{ sound }` or `{ playlist }`, in the `/api/library` format, a playlist with all its tracks | once a download has added a file, a move has put one in its new place, or a restore has brought one back |
| `trash` | `{ size, count }`: bytes, and the listed playlists plus sounds | on connect, then whenever a deletion, move, restore or purge changed it; each of those routes reloads `Trash` (§5.1) before it answers |
| `problems` | `{ problems }`: the whole list (§5.1) | on connect, then whenever a dismissal, a deletion, a move or a refresh changed it |
| `library.removed` | `{ soundId }`, `{ trackId, playlistId }` or `{ playlistId }` | once a deletion or a move has taken an item away; `LibraryChanges` (`library-changes.js`) hands them from the routes to every stream |
| `access.requests` | `{ requests: [{ address, code }] }`: all the pairing requests waiting for an answer (§5.6) | with `--lan`, to a page stream on connect and whenever the list changes; never to a remote |
| `remote.role` | `{ host, reason? }` | to a page stream on connect, then whenever it becomes the host or stops being it; `reason: 'replaced'` when another page took the role (§5.5) |
| `command` | `{ command }` | to the host's stream: a command a remote sent (§5.5) |
| `remote.host` | `{ connected }` | to a remote's stream on connect and whenever a host appears or goes |
| `remote.state` | `{ state }` | to a remote's stream: the host's last `RemoteState`, on connect and whenever the host sends a new one |
| `startup.closed` | `{}` | to every stream, page or remote, as its last message when the soundboard closes (§3); the stream ends right after |

**Static files.** The path guard works on the raw request path, before any URL normalization: the path is percent-decoded, resolved against `public/`, and rejected unless it is still inside. Null bytes and malformed encoding are rejected too.

**Media streaming.** Safari refuses to play media unless the server answers Range requests correctly, so this is exact.
- Each path segment is percent-decoded and the result is looked up in `Library.files`. Only indexed files can be served; anything else is a 404. The file system is never accessed with a path from the URL.
- Headers: `Accept-Ranges: bytes`, `Content-Type` (`audio/mpeg`, `audio/ogg` or `audio/ogg; codecs=opus`), `Content-Length`, `Last-Modified`, `ETag` (built from size and mtime).
- `Range: bytes=a-b`, `a-` or `-n` gets a `206` with `Content-Range`. A range starting past the end gets a `416` with `Content-Range: bytes */size`. A malformed `Range` header is ignored and the whole file is sent. Only the first of several ranges is served.
- The body is a file read stream piped with `stream.pipeline`. A client disconnecting mid-stream (seeking, skipping tracks) is normal: the stream is closed and nothing is logged as an error.
- `HEAD` returns the same headers with no body.

**Refreshing.** The library, its `LibraryEditor` and `WaveformStore`, and the `SettingsStore` sit in the router's context, and each request reads them when it starts, so a successful refresh swaps all four at once. Refresh requests that arrive while one runs share its result. Every other `/api/…` request (except `/api/events`) that arrives during a refresh waits for it to finish, so a save always reaches the library that is served afterwards.

**Other server behavior:**
- Unexpected errors (500s, failed streams) are always printed to stderr with their stack trace.
- With `--verbose`, each request is logged to stdout when its response finishes or the client disconnects: `GET /media/Combat/01%20Battle.mp3 206 bytes=0-1023 12ms`. That is the method, the raw path, the status, the `Range` header if there was one, and the duration. A request whose client disconnected first ends with `(aborted)`.
- If the port and the nine after it are in use (`Ports 13872 to 13881 are all in use. Choose another port with --port.`), or the port is not allowed, print a clear message and exit `1`.
- On SIGINT, SIGTERM or a typed `exit` (§3), close the soundboard if one is open (which stops the change watcher), close the server, including open media streams and event streams, print `Stopped.` and exit `0`.

### 5.3 Change watcher (`ChangeWatcher`)

`src/library/change-watcher.js` tells whether the directory still holds what the app last loaded. It never loads anything itself; a refresh does (§3.6). `src/cli/main.js` creates it before bootstrap and starts it once bootstrap has finished writing.

- **Baseline.** `takeBaseline` in `tree-snapshot.js` records every file the app reads (§2.1): audio files, their options files, playlist options files and `.soundboard`, each with its size, modified time and SHA-1. Options files and `.soundboard` are hashed; audio files take the SHA-1 their options file recorded with the duration (§3.5) when its size and time still match, so no audio is read. The snapshot comes from the scanner, so it skips exactly what the scanner skips: dot files, waveforms (`.wf`), `.tmp` files, unsupported audio, orphan `.json` files and symlinks.
- **While bootstrap ran.** The baseline is taken after bootstrap, and its audio files are compared with the scan bootstrap used. Any difference means files changed meanwhile, and counts as an external change straight away.
- **Watching.** `fs.watch(root, { recursive: true })` only says that something changed. After 1 s without further events (`QUIET_MS`), so a copy in progress is looked at once it stops, the watcher snapshots the directory and compares it with the baseline:
  - a file that is new or gone is a **change**;
  - a file with the same size and modified time is unchanged;
  - otherwise the file is hashed. A different SHA-1, or one the baseline doesn't know, is a **change**; the same one only updates the baseline's size and time, because the file was merely touched or copied.
- **Quick checks** compare sizes and modified times only and never hash, so there a touched file counts as a change. The page asks for one whenever it gets the focus back (`POST /api/changes/check`). If `fs.watch` throws or reports an error (for example when Linux runs out of inotify watches), the watcher prints `Can't watch the audio directory (…); checking it every 30 seconds instead.` and runs a quick check every 30 s (`POLL_MS`).
- **Once a change is found**, `externalChanges` becomes `true`, every listener hears about it (the event streams, §5.2), and no more comparisons run until the next refresh. A directory that can no longer be read also counts as changed, with the reason printed; the refresh then says what is wrong.
- **Own writes.** `LibraryEditor` and `SettingsStore` save through `watcher.updateFile`, which writes the file as `updateJsonFile` does (§2.3) and then records its new size, time and SHA-1 in the baseline. Downloads add their files, and `LibraryEditor` deletes, moves, restores and purges them, through `watcher.writeFiles(task)`, which runs the task in turn and then follows the lists it returns (§5.1): files in `removed` leave the baseline, `renamed` pairs keep their entry under the new path (a rename changes neither content nor dates), and files in `written` are recorded afresh. Files in the trash are never in the baseline, so a restore lists what it brought back in `written`, and a purge lists nothing. Bootstrap writes before the baseline is taken. The app's own saves and additions therefore never count as external changes.
- **Taking turns.** Comparisons, own writes, additions and refreshes run one at a time, in the order they were asked for. A comparison never sees a file the app is halfway through saving, none runs while a refresh rewrites files, and an addition never lands in a library a refresh is replacing. `watcher.refresh(rebuild)` runs the rebuild that way and, when it succeeded, takes a new baseline and sets `externalChanges` back to `false`.
- The timers (`setTimeout`, `setInterval`) and `fs.watch` are injected, so tests run the delays on a fake clock.

### 5.4 Downloads (`src/downloads/`)

`DownloadService` looks links up and downloads them into the library. `startServer` creates it when it is given the tools found at startup (§3.4).

**Ports**, each with a test fake:
- `ProcessRunner` (`process-runner.js`) starts a program with an argument list, never through a shell, in a process group of its own, so killing it also stops the `ffmpeg` that `yt-dlp` starts. It passes stdout (unless captured whole) and stderr on as lines. `LineSplitter` cuts them the way a terminal shows them: a line ended by a carriage return alone is *transient* progress that the next line replaces. A program that isn't installed is a `ToolMissingError`.
- `YtDlp` (`yt-dlp.js`) and `Ffmpeg` (`ffmpeg.js`) build their command lines on it. Every link follows `--`, so it can never be read as an option.
- `LinkFetcher` (`link-fetcher.js`) fetches direct links with Node's `fetch`.
- The service gets the current `LibraryEditor` from the router's context each time it adds a file, so an addition after a refresh lands in the new library, and adds through `watcher.writeFiles` (§5.3).

**Lookup** (`probe(text, { playlist })`). Only `http:` and `https:` links are accepted.
1. Unless `playlist` is set, the server sends a `GET` and drops it once the headers arrive. A successful `audio/*` or `video/*` response is a **direct file**: `{ kind: 'file', url, name, size, contentType }`.
   - The name comes from `Content-Disposition` (the encoded `filename*` first), else the last part of the final URL's path, else `download`. `audio/mpeg`, `audio/ogg` and `audio/opus` add `.mp3`, `.ogg` or `.opus` to a name without an extension.
   - The size is `Content-Length`, or `null` when it is missing or the response is compressed, since then it counts the compressed bytes.
2. Anything else goes to `yt-dlp -J --flat-playlist --playlist-end 500 -f bestaudio/best --no-playlist -- <url>` (`--yes-playlist` when `playlist` is set). `toProbe` reduces its JSON:
   - A video becomes `{ kind: 'video', url, id, title, duration, size, extractor, chapters: [{ title, start, end }], playlistAvailable }`. The page URL is yt-dlp's `webpage_url`, and the size is the chosen format's `filesize` or `filesize_approx`. A chapter without an end ends at the video's end. `playlistAvailable` is set when the link has both `v` and `list` in its query, as YouTube's `watch?v=…&list=…` does.
   - A playlist, album or channel becomes `{ kind: 'playlist', url, id, title, entries: [{ id, title, duration, url, extractor }], truncated }`, with at most 500 entries (`MAX_ENTRIES`). Entries that are lists themselves, such as a channel's tabs, are left out. `truncated` comes from `playlist_count`, or from hitting the limit when it is missing.
   - Live and upcoming streams are refused.
   - A failed run reports yt-dlp's last `ERROR:` line without its prefix.
3. The result is remembered under a random `probeId`, the newest 10 only, and the download refers to it.

**Jobs.** At most one runs; starting another meanwhile is a `DownloadBusyError`. A job is JSON-safe: `{ id, title, target, targetTitle, state, items, current, added, failed }`.
- `targetTitle` is "Sound effects" or the playlist's title.
- `state` is `running`, then `done`, `failed` (when any item failed) or `cancelled`.
- `items` has one entry per file it adds, `{ title, state, error }`. An item's state is `waiting`, `downloading`, `converting`, `done`, `failed` or `cancelled`. `current` is the index of the item being worked on.
- What it downloads:
  - a direct file or a whole video: one download, one item;
  - chosen chapters: one download, then one item per chapter, in chapter order;
  - chosen playlist entries: one download and one item each.
- An item that fails is logged with its error and the rest carry on. Nothing is retried.
- A finished job stays until it is dismissed, so its summary survives a page reload. Jobs live only in memory.

**Each download** works in a folder of its own, `.soundboard-downloads/<job id>/<n>/`, on the same file system as the root, so the finished file can be renamed into place.
- `yt-dlp -f bestaudio/best --no-playlist --newline --no-mtime -P <folder> -o '%(title)s [%(id)s].%(ext)s' -- <url>` saves it under yt-dlp's default name; the one file left in the folder, without `.part` and the like, is the result. A direct link is streamed there under its safe name (below), with a progress line per percent, or per megabyte without a size. It stops with an error when more bytes arrive than the lookup announced.
- **Conversion.** An `.mp3`, `.ogg` or `.opus` file that isn't cut is kept as it is. A whole `.webm` or `.weba` (what `bestaudio` usually gives on YouTube) is first copied with `ffmpeg -hide_banner -nostdin -y -i <file> -map 0:a:0 -c:a copy <out>.opus`: no re-encoding, so it is fast and loses nothing. If the copy fails because the audio is not Opus, the log says so and the file is converted as below. Anything else, and every chapter, goes through `ffmpeg -hide_banner -nostdin -y [-ss <start>] -i <file> [-t <length>] -map 0:a:0 -c:a libvorbis -q:a 5 <out>.ogg`: the first audio stream as Ogg Vorbis at about 160 kbps, and for a chapter only that part. Seeking before the input is fast, and re-encoding keeps the cut exact.
- **Names** (`file-names.js`). A converted file keeps its name with `.ogg` instead of its extension. A chapter is named as `yt-dlp --split-chapters` would: `<title> - 003 <chapter title> [<id>].ogg`. A direct file's name has the characters `/ \ : * ? " < > |` and control characters removed and its leading dots and spaces stripped, since a leading dot would hide it (§2.1), and its stem is cut to 120 characters. `LibraryEditor` adds ` (2)` when a name is taken (§5.1).
- **Adding.** The title is the name without extension and id tag (§2.4), and `source` is set as in §2.3. A `newPlaylist` job creates its playlist with the first file that finishes and adds the rest to it. Every addition is announced as `library.added`.
- The job's folder is deleted when it ends, however it ends.

**The log.** Each step starts with its command line, quoted as a shell would need it (`$ yt-dlp -f bestaudio/best …`), followed by everything the program prints. Then come lines of the service's own: `Added "Battle Theme" to Combat (Combat/Battle Theme [id].ogg)`, `Failed: …`, and finally `Finished: 6 added, 1 failed.` or `Cancelled.`. A transient line is replaced by the next one, as a terminal shows progress, so yt-dlp's and ffmpeg's progress updates in place. The job keeps the last 1000 lines (`MAX_LOG_LINES`). Lines are sent in batches at most every 250 ms (`download.log`), and the batch waiting is always sent before the next `download` message, so the page sees them in order.

**Cancelling** aborts the running step: the program is killed, or the fetch is aborted. The items not finished are marked `cancelled`, and files already added stay. **Dismissing** a running job cancels it; dismissing a finished one forgets it (`download` with `job: null`).

**Updating yt-dlp** (`yt-dlp-update.js`). `updateYtDlp(run)` runs `yt-dlp -U` once at startup (§3.4), before any download can start. yt-dlp updates itself when it may write its own file; installed by a package manager or with `pip`, it can't, and says so. It never rejects, and resolves with `{ state, current, latest, error }`, read from every line yt-dlp printed except transient ones (`readUpdateOutput`):
- `current`: a line contains `is up to date`.
- `updated`: a line starts with `Updated yt-dlp to`.
- `outdated`: there are `Current version:` and `Latest version:` lines but no update, as when the permissions are missing. `error` is the last `ERROR:` line without its prefix.
- `failed`: anything else, such as being offline, with the last `ERROR:` line (or the last line) as `error`. yt-dlp is killed after 60 s (`UPDATE_TIMEOUT_MS`), which also counts as `failed`.

Versions are read from labels such as `stable@2026.10.26 from yt-dlp/yt-dlp`, without the channel, so a nightly build keeps its full version (`2026.10.21.232853`). `describeUpdate` gives the terminal line and `updateProblem` the problem an `outdated` result leaves (§5.1).

### 5.5 Remote relay (`src/remote/`)

`RemoteRelay` connects the pages that play with the remotes. It holds no audio and no library, only who is the host and the last state it sent.

- **Pages.** A page opens `/api/events?page=<id>` with an id it made up (§6.10); the relay knows the stream by that id (`attachPage`) and sends `remote.role` on connect. A page is `standalone` until `PUT /api/remote/host` makes it the host.
- **One host.** `claimHost` fails with `HostTakenError` when another page holds the role, unless `replace` is set: then the old host gets `remote.role { host: false, reason: 'replaced' }` and the new page takes over. The first host keeps the role; nothing is handed down when it goes.
- **Grace.** If the host's stream closes (a reload, a lost connection), it stays the host for `HOST_GRACE_MS` (10 s). A stream with the same id inside that time keeps the role; otherwise the host is gone and the remotes are told. `releaseHost` ends the role at once, which a closing page does with `keepalive`.
- **Remotes** open `?role=remote` and get the host's state and whether there is a host. Any number may connect.
- **Commands.** `sendCommand` forwards a remote's command to the host's stream and answers `NoHostError` without one. Only these may pass, anything else is a `NotRelayableError`: `panic.stop`, `sound.play`, `sound.stop`, `playlist.toggle`, `playlist.stop`, `playlist.pause`, `playlist.resume`, `playlist.next`, `playlist.previous`. Customizing, volumes, deleting and everything else stay on the host's page. The host runs a command as if its own UI had sent it (§6.1), so the relay needs no rules of its own.
- Timers are injected so tests use `FakeClock`.

### 5.6 Access control (`src/http/access-control.js`)

With `--lan`, a device on the network must be allowed from this machine before it can use the remote. `AccessControl` holds who asked, who was allowed and who is banned. Time and randomness are injected. Everything lives in memory: a restart forgets approvals and bans, and a phone with an old cookie simply asks again.

- **Pairing.** The device's address is its identity (`::ffff:a.b.c.d` is read as `a.b.c.d`). `request(address)` gives it a pending request with a code of three digits that no other pending request uses. Asking again while a request is pending, for example from a second tab, returns the same request and code. A request that was answered or has expired is replaced by a new one. A request, and an answer nobody collected, are forgotten after 2 minutes (`REQUEST_LIFETIME_MS`).
- **Answering.** `answer(address, 'allow' | 'deny')` works on a pending request only. Allowing makes up a secret (128 random bits) for the device, keeps only its SHA-256 hash, and hands the secret out once, with the first `status(address)` after the answer; the route puts it in the cookie (§5.2). A denied request stays "denied" until it expires or the device asks again.
- **The limit.** `request(address)` and `strike(address)` count one request for the address. More than 5 within 60 s (`MAX_REQUESTS`, `RATE_WINDOW_MS`) bans it at once, with no prompt, and drops its request. A banned address stays banned until the server restarts. Polling the answer (`status`) does not count. The address is the only identity there is, so a ban also hits other devices behind the same address, which on a home IPv4 network is the same device.
- **Events.** `onChange` fires whenever the list of pending requests changes, and the event streams send it to the pages (`access.requests`, §5.2). `onRequest` fires for every request that is new, not for a repeat, and the CLI prints it (§1).
- **Who answers.** Requests from this machine are never checked (§5.2), so only the pages here can reach the answer route. A device cannot allow itself or another.
- **Closing the soundboard.** `revokeAll()` forgets every allowed device and every request, and announces the change when requests were waiting. The bans and the rate counts stay. The board calls it when it closes (§3), so each device pairs again for the next soundboard.

### 5.7 Folder rules (`src/startup/folder-rules.js`, `src/startup/folders.js`)

The server checks every folder the Selector browses or chooses, whether it was browsed, recent or given on the command line. The rules take a `Platform`: the system, the home folder, the system drive on Windows, the allowed roots and `allowHidden`, so every system's rules are tested anywhere. Each path is checked **after resolving symbolic links** (`resolvedPath`), so a link can't lead out of the roots, and a folder that passes is opened by that resolved path. `main` resolves the home folder and the roots the same way at startup.

- **Allowed roots.** Only a root and what is inside it may be browsed or opened. By default the only root is the home folder. Each `--whitelisted-root <path>` adds one, and giving any replaces the home folder; `%home%` (any case) in the path stands for the home folder, so `--whitelisted-root %home% --whitelisted-root /mnt/sfx` keeps it. A root that doesn't exist is left out with a yellow line, and the terminal prints the roots (`Folders the app may open: …`). Otherwise: "This folder is outside the folders the app may open."
- **Hidden folders.** A path with any part below its root starting with a dot can't be browsed or opened, unless `--allow-hidden` is given: "Hidden folders can't be used." A root that is hidden itself is allowed, since it was named on purpose. These two rules are `browseRefusalOf`.
- **System folders**, refused with everything inside them, even within a root (`refusalOf`): `/bin`, `/boot`, `/dev`, `/etc`, `/lib`, `/lib32`, `/lib64`, `/opt`, `/proc`, `/root`, `/run`, `/sbin`, `/snap`, `/srv`, `/sys`, `/usr`, `/var`, and on macOS `/System`, `/Library`, `/Applications`, `/private`, `/cores`; on Windows `Windows`, `Program Files`, `Program Files (x86)`, `ProgramData`, `$Recycle.Bin` and `System Volume Information` on any drive, and `AppData` in the home folder: "System folders can't be used." Drives under `/run/media` are not system folders, and neither is anything inside the home folder, since some systems keep it in one (`/var/home` on Fedora Silverblue).
- **Folders that only hold other places**, refused as themselves only: `/`, `/home`, `/Users`, `/Volumes`, `/media`, `/mnt`, `/run/media`, the system drive's root and its `Users` on Windows, and the home folder: "Choose a folder inside this one." Another drive's root, such as `D:\`, is allowed.
- **Not a soundboard** (`checkFolder` only): a folder without `.soundboard` and without a supported audio file in it or in a direct subfolder (hidden ones skipped): "No audio files found here." Also "This folder doesn't exist.", "This is not a folder." and "This folder can't be read."
- Paths are compared without regard to case on Windows and macOS, whose disks usually ignore it.

**Listing** (`listFolder`) refuses with `FolderNotAllowedError` what `browseRefusalOf` refuses, and with `FolderUnreadableError` what doesn't exist or can't be read. It lists the subfolders (and symbolic links to folders) by name, numbers in order, without hidden ones unless they are allowed. Each gets `soundboard` (it holds `.soundboard`, one `stat` each) and `refused` (`refusalOf` on its path alone). The listing also counts the supported audio files directly inside, says whether the folder itself is a soundboard, and has `checkFolder`'s answer. `parent` is `null` only at the top of a disk; it may be outside the roots, and listing it is then refused, which the Selector shows as a notice (§9.18).

**Starting places** (`startingPlaces`): each root (the home folder named "Home", another by its name), then the home folder's `Music`, `Desktop`, `Documents` and `Downloads` when they exist, are allowed and aren't roots already. Drives and mounts show only when they are roots.

The soundboard itself ignores every file and folder whose name starts with a dot (§2.1), apart from its own `.trash` and `.soundboard-downloads`.

### 5.8 Recent folders (`src/startup/recent-folders.js`)

`RecentFolders` keeps the last 5 folders (`MAX_RECENT`) that reached `ready`, newest first, without repeats, as `{ "recent": [paths] }` in `recent.json` in the app's config folder (`configFolder`): `%APPDATA%\Soundboard` on Windows, `~/Library/Application Support/Soundboard` on macOS, `$XDG_CONFIG_HOME/soundboard` or `~/.config/soundboard` elsewhere. It is the only file the app writes outside a soundboard; the folder is created on the first write, which is atomic (§2.3). `list()` says for each whether it still exists. A missing or broken file, or entries that aren't strings, count as nothing. `forget(path)` removes one.

---

## 6. Frontend architecture

```
UI layer (DOM)  ──commands──▶  Soundboard (logic facade)  ──▶  AudioEngine port
     ▲                              │                              ▲
     └──────────events──────────────┘                ┌─────────────┴────────────┐
                                                WebAudioEngine            FakeAudioEngine
                                                (browser)                 (tests, fake clock)
```

- `public/app/main.js` is the composition root. It creates the page id, the `RemoteController` (§6.10), the `WebAudioEngine`, the `WebAudioWaveformDecoder`, the `HttpBackendApi`, the `EventSourceServerEvents`, the browser clock and the `console` logger, passes them to `Soundboard`, and mounts the UI.
- `public/app/logic/**` **never touches** `window`, `document`, audio APIs or Node APIs. Everything it needs is injected through ports, whose types live in `public/app/logic/ports.js`:
  - the `AudioEngine` (§6.3);
  - a `Clock` (`now`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`); `now()` is a monotonic time in milliseconds, which the voice monitor (§6.5) uses to follow fades;
  - a `BackendApi` (`fetchLibrary()`, `fetchSettings()`, `saveVolumes(volumes, { keepalive })`, `saveSoundOptions(soundId, { title, gain, startAt, endAt, fadeIn, fadeOut }, { keepalive })`, `savePlaylistOptions(playlistId, { title, gain, crossfade, fadeIn, fadeOut, order, playlistLooping, trackLooping, stopMode }, { keepalive })`, `saveTrackOptions(trackId, { title, gain, startAt, endAt }, { keepalive })`);
  - a `WaveformDecoder` (§6.6), and the `BackendApi` methods `fetchMissingWaveforms()`, `fetchWaveform(id)` and `saveWaveform(id, peaks)`;
  - for external changes (§6.7), the `BackendApi` methods `checkExternalChanges() → Promise<boolean>` and `refresh() → Promise<RefreshResult>`, and optionally `ServerEvents` (`connect(onMessage) → disconnect`), the server's pushed messages (§5.2). `api/server-events.js` implements it with `EventSource` on `/api/events`, which reconnects by itself; the server sends its current state on every connection;
  - for downloads (§6.8), the `BackendApi` methods `fetchDownload()` (the tools and the job with its log), `probeLink(url, { playlist })`, `startDownload(request) → Promise<DownloadJob>` and `dismissDownload()`. The two that can fail because of the user's link reject with the server's message alone, ready to show;
  - for deletions and moves (§6.8), `deleteItem({ kind, id })` and `moveItem(id, to)`, which resolve with the server's `changes` and reject with its message alone;
  - for the trash (§6.8), `fetchTrash()`, `restoreFromTrash(target)`, which resolves with the `changes` like the two above, and `deleteFromTrash(target)`, where `target` is `{ kind, id }` or `'all'`;
  - for problems (§6.9), `dismissProblem(id)` and `dismissAllProblems()`;
  - for the Info dialog (§9.17), `fetchInfo()`, the answer of `GET /api/info`, which the facade passes on as `fetchInfo()`;
  - for Change soundboard (§9.3), `closeSoundboard()`, `POST /api/startup/close`, rejecting with the server's message;
  - for the host role (§6.10), the `BackendApi` methods `fetchHostStatus()`, `claimHost(pageId, { replace })` ("ok" or "taken"), `releaseHost(pageId, { keepalive })`, `sendRemoteState(pageId, state)` and `sendRemoteCommand(command)`;
  - for pairing devices (§5.6, §9.16), the `BackendApi` methods `answerAccessRequest(address, decision)` and `fetchConnectLinks()` (empty without `--lan`). The facade gives the pages `accessRequests()`, the list of the last `access.requests` message, announced as `access.requestsChanged { requests }`; `answerAccessRequest(address, decision)`, which only sends the answer, since the new list comes from the server; and `fetchConnectLinks()`. A failed answer is logged as a warning;
  - `ServerEvents.connect(onMessage, params)` takes the query of the stream (`page` or `role`);
  - a `Logger` (`warn`, `error`);
  - optionally a `random` function for the random playback orders (§8.1), `Math.random` unless tests pass a seeded one.

  Node imports and tests this code directly; the type-checker and ESLint enforce the boundary (§10.1).
- The UI calls only the facade's methods and listens to its events. It never reads logic internals. The one exception is stateless helpers with no state of their own: the UI imports `MAX_GAIN`, `gainToDb`, `dbToGain` and `sliderToGain` from `logic/volume.js`, `MAX_CROSSFADE` from `logic/playback-rules.js`, `MIN_CLIP_MS` from `logic/clip.js`, and `PLAYBACK_ORDERS` from `logic/order-strategies.js`, so the ranges, the list of orders and the volume math exist only once.
- **Commands and events are plain, serializable objects.** Each facade method builds a command (`{ type: 'playlist.next', playlistId, transition: 'instant' }`) and passes it to `dispatch(command)`, which validates it first. Events are `{ type, ...payload }` and contain only JSON-safe values: an unknown duration is `null`, never `NaN`. A remote control forwards a few of them to the host unchanged (§5.5, §6.10).
- A UI event handler that throws never stops other handlers or leaves playback half-updated; the error is passed to the logger.

### 6.1 Facade API (`Soundboard`)

```js
// lifecycle
start() → Promise<void>                   // from the splash click (§9.0): unlock audio synchronously, then fetch
                                          // library + settings once, apply volumes, emit 'app.ready' or 'app.startFailed'
unlockAudio()                             // resume audio if the browser suspended it; must run inside a user gesture
flushSettings()                           // save pending volume, sound and playlist changes now, with keepalive (on 'pagehide')
closeSoundboard() → Promise<void>         // Change soundboard (§9.3): flushSettings, then POST /api/startup/close; emits
                                          // 'app.closed' once done, and rejects with the server's message

// sounds (no transitions; sounds have no rules)
playSound(soundId)
stopSound(soundId)                        // stops all instances of that sound, instantly

// Panic Stop (§9.1)
panicStop()                               // in 'fade': stop every playlist (a default stop) and fade out every sound instance
                                          // over its sound's fadeOut (§7); if anything is left fading, move to 'now'.
                                          // In 'now': stop everything instantly, voices still fading included, and move to 'fade'
panicState() → 'fade' | 'now'

// live volume of a playlist (§6.4); sound effects have none
setPlaylistLevel(playlistId, level)       // level: slider position 0..1; never saved
getPlaylistLevel(playlistId) → number     // 1 until changed
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
customizePlaylist(playlistId, { title?, gain?, crossfade?, fadeIn?, fadeOut?, order?, playlistLooping?, trackLooping?, stopMode? })  // applies at once;
                                          // saves 500 ms later; a new order refills the history around the current
                                          // track, track looping reaches the current track at once, and a new stop
                                          // mode trims what a stopped playlist remembers (§8.1)
forgetPlaylist(playlistId)                // a stopped playlist forgets where it would resume; the next play starts afresh
flushPlaylistOptions(playlistId)          // save that playlist's pending change now (its dialog closed)
customizeTrack(trackId, { title?, gain?, startAt?, endAt? })  // renames a track or changes its volume or points (endAt null: the
                                          // end of the file) at once, announced as playlist.changed; saves 500 ms later. The
                                          // points are checked like a sound's (§7). They reach only tracks that start later
                                          // (§8.1); a new gain reaches the playing track at once (§6.4)
flushTrackOptions(trackId)                // save that track's pending change now

// waveforms (§6.6): not commands, because they are not playback
startWaveforms()                          // ask the server what is missing and make it; also runs by itself after 'app.ready'
stopWaveforms()                           // stop after the file being decoded; its result is dropped
regenerateWaveforms()                     // make every sound's and track's waveform again, replacing the stored ones (§6.6)

// external changes (§6.7): not commands, because they are not playback
checkExternalChanges()                    // ask the server for a quick check; the UI calls it when the window gets the focus back
refreshLibrary() → Promise<void>          // save everything pending, then have the server rebuild its library

// downloads (§6.8): not commands, because they are not playback
probeLink(url, { playlist? }) → Promise<LinkProbe>  // rejects with a message for the user
startDownload({ probeId, target, chapters?, entries? }) → Promise<void>  // rejects with a message for the user
cancelDownload()                          // stop the running download; what it added stays
dismissDownload()                         // cancel the running download, or forget a finished one

// deleting and moving (§2.5, §6.8): not commands, because they are not playback. Each saves everything pending
// first and rejects with a message for the user.
deleteSound(soundId) → Promise<void>
deleteTrack(trackId) → Promise<void>      // a playlist's only track takes the playlist with it
deletePlaylist(playlistId) → Promise<void>
moveSound(soundId, playlistId) → Promise<void>
moveTrack(trackId, playlistId | null) → Promise<void>   // null: out to the sounds

// the trash (§2.5, §6.8): not commands either; target is { kind, id } or 'all', and each rejects with a message for the user
trashSummary()                            // { size, count }, from the server's `trash` messages
loadTrash() → Promise<TrashListing>       // what GET /api/trash answers
restoreFromTrash(target) → Promise<void>  // saves everything pending first, then applies what came back
deleteFromTrash(target) → Promise<void>   // for good

// host mode (§6.10): not commands either
becomeHost({ replace }) → Promise<'hosting' | 'taken' | 'failed'>   // asks the server for the role; 'taken' only when replace is false
stopHosting({ keepalive })                // gives the role up; the page is standalone again
isHosting()
// problems (§6.9): not commands either
getProblems()                             // [{ id, kind, severity, path, message, count }], errors and warnings
dismissProblem(id)                        // forgets one; the server forgets its own for good until the next start
dismissAllProblems()

// volume (value is the slider position, 0..1, clamped)
setVolume(bus, value)                     // bus: 'master' | 'music' | 'sfx'

// queries (read-only snapshots)
getLibrary(), getPlaylistSnapshot(id), getActivePlaylists() /* in start order */, getVolumes(), isSoundActive(id)
isAnythingPlaying()                       // a playlist playing or paused, or any sound with a live instance
getWaveformStatus()                       // { running, done, total, failed }
hasExternalChanges()                      // whether the server reported files changed outside the app
getDownloadTools()                        // { ytDlp, ffmpeg }: versions found by the server, null when missing
getDownload()                             // { job, log } of the server's download, or null
getWaveform(id) → Promise<Int8Array | null>  // min/max byte pairs of a sound or track, cached; null while there is none
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
| `app.closed` | `{}`, once: the soundboard was closed, by `closeSoundboard` or from another page (the `startup.closed` message, §5.2). The page then loads `/`, which is the Selector. |
| `audio.suspended` | `{}`, sent when the audio context stops running without being asked (Safari interruption, Mac wake from sleep) |
| `audio.resumed` | `{}`, sent when it runs again after a suspension |
| `panic.changed` | `{ state }`, `'fade'` or `'now'`: what the next press of Panic Stop does (§6.1) |
| `playlist.levelChanged` | `{ playlistId, level }`, sent only when the live volume (§6.4) really changes |
| `sound.activeChanged` | `{ soundId, active }`, sent when the instance count goes from 0 to ≥1 or back |
| `sound.error` | `{ soundId, message }`: decoding or playback failed, or the browser cannot play the format |
| `sound.changed` | `{ sound }`, the sound with its new title, gain, points or fades, right after `customizeSound` |
| `sound.saved` | `{ soundId }`, once every change to that sound has been saved |
| `sound.saveFailed` | `{ soundId, message }`; the change stays in effect and is saved again with the next one |
| `playlist.changed` | `{ playlist }`, the playlist (with its tracks) with its new title, gain, timings, order, track looping or stop mode, right after `customizePlaylist`, or with a renamed or retrimmed track, right after `customizeTrack` |
| `playlist.saved` | `{ playlistId }`, once every change to that playlist has been saved |
| `playlist.saveFailed` | `{ playlistId, message }`, as for sounds |
| `track.saved` | `{ trackId }`, once every change to that track has been saved. A rename itself is announced as `playlist.changed`, with the playlist holding the renamed track, so every view of the playlist follows from one event. |
| `track.saveFailed` | `{ trackId, message }`, as for sounds |
| `playlist.stateChanged` | `{ playlistId, state, trackIndex, track, duration, crossfadeFrom, resume }`, where `resume` is `{ trackIndex, track, position }` while a stopped playlist remembers where it will resume (`position` is `null` when the track starts over), otherwise `null`. It is sent again when `forgetPlaylist` or a new stop mode changes it. |
| `playlist.progress` | `{ playlistId, position, duration, crossfadeFrom }`, every 250 ms while playing, right after a seek, and when the rules change |
| `playlist.error` | `{ playlistId, trackId, message }` |
| `volume.changed` | `{ bus, value }` |
| `waveforms.progress` | `{ status: { running, done, total, failed } }`, whenever generation starts, stops, finishes a file or fails one |
| `waveform.ready` | `{ id }`, once a waveform has been made and stored; `getWaveform(id)` has it |
| `voices.changed` | `{}`, sent when a voice appears, changes status or is removed from the voice monitor's list (§6.5). Volumes move continuously and are not announced; read them with `getVoices()`. |
| `library.externalChanges` | `{ pending }`, whenever the server's answer about external changes differs from the last one (§6.7) |
| `library.refreshing` | `{}`, when `refreshLibrary` starts |
| `library.refreshed` | `{}`, once the server has rebuilt its library; the page should reload |
| `library.refreshFailed` | `{ message, errors, restartNeeded }`: `errors` lists `{ path, message }` for invalid options files; `restartNeeded` is `true` when `.soundboard` is gone |
| `download.changed` | `{ job, logReset }`: the server's download changed (§6.8); `job` is `null` once dismissed. With `logReset`, read the whole log again with `getDownload()`; otherwise `download.log` brings what is new. |
| `download.log` | `{ lines, replaceLast }`: new log lines; with `replaceLast`, the first replaces the last line |
| `sound.added` | `{ sound }`, a sound a download added, a move made or a restore brought back |
| `playlist.added` | `{ playlist }`, a playlist a download created or a restore brought back. Tracks added to an existing playlist are announced as `playlist.changed`, as renames are. |
| `sound.removed` | `{ soundId }`, a sound deleted or moved into a playlist |
| `playlist.removed` | `{ playlistId }`, a playlist deleted, or left by its last track. A track that leaves a playlist that stays is announced as `playlist.changed`. |
| `trash.changed` | `{ size, count }`, whenever the server's trash summary differs from the last one (§6.8) |
| `problems.changed` | `{ count }`: the list from `getProblems()` changed (§6.9) |
| `host.changed` | `{ hosting }`: the page became the host, or stopped being it (§6.10) |

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
- `canPlay` uses `canPlayType` and caches the answer per format (`audio/mpeg`, `audio/ogg`, `audio/ogg; codecs=opus`).
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
- **Playlists.** Every playlist voice plays at `playlist gain × track gain × live volume`, through the voice's own gain stage (§6.3), so no extra node per playlist is needed.
- **Applying.** `customizeSound`, `customizePlaylist` and `customizeTrack` change the browser's library at once (`LibraryModel.updateSound` / `updatePlaylist` / `updateTrack`, which keep the items sorted with the same order as the server, §2.2). `SoundPlayer.setGain` applies a sound's gain to every playing instance and to later ones; `PlaylistPlayer.setGain` applies a playlist's gain to its current voice, to voices still fading out, and to later ones. A track's new gain reaches the playlist through `PlaylistPlayer.setPlaylist` (§8.1), which applies it to the same voices at once. An empty title, a gain out of range or an unknown order is an `InvalidCommandError`.
- **Saving.** `OptionsSync` saves per item like the volume save: 500 ms after the last change, one request per item in flight, always the item's full editable options, so a failed save is repaired by the next one. Its queues are keyed by kind (`sound`, `playlist`, `track`) and id, so items of different kinds with the same id never share one. `flushSoundOptions`, `flushPlaylistOptions` and `flushTrackOptions` send one item's pending change now (after any save of it in flight); `flushSettings` sends everything pending with `keepalive`. `SettingsSync.settle()` and `OptionsSync.settleAll()` send everything pending without `keepalive` and resolve once nothing is waiting or in flight, follow-up saves included; a failed save is reported as usual and doesn't reject. A refresh waits for them (§6.7).

**Live volume.** Each playlist also has a temporary volume for the session, set from its player bar (§9.2). Sound effects have none.
- **A slider position.** It runs from `0` to `1` on the same scale as the header volumes (gain = `level ** 2`, no boost) and starts at `1`. It multiplies with the saved gain and is separate from it.
- **Never stored.** Not in `.soundboard`, not in the options files, not debounced and not part of `flushSettings`. A reload gives full volume. It stays across stops, track changes and Panic Stop, and only the bar or a reload resets it.
- **Applying.** `PlaylistPlayer.setLevel` goes through the same path as `setGain`, so it reaches the current voice, voices still fading out and later ones, and never disturbs a fade. `setPlaylistLevel` is the command `{ type: 'playlist.setLevel', playlistId, level }`, validated by `dispatch()`. The level is clamped to `0..1`, and a level that is not a number or an unknown playlist is an `InvalidCommandError`. `playlist.levelChanged` (§6.2) is sent only when the value changes, so the player bar and the tile follow it.

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

### 6.6 Waveforms (`WaveformService`)

`logic/waveform-service.js` makes the waveforms the server lacks and serves the stored ones. It knows nothing about playback: it never looks at what plays, and playback never waits for it.

- **Generation.** `Soundboard` starts it once the library has loaded, and `startWaveforms()` / `stopWaveforms()` control it. A run asks the backend for the missing ids, then handles them one at a time: `decoder.decode(url)`, `saveWaveform(id, peaks)`, a `waveform.ready` event, a `waveforms.progress` event, and a 250 ms rest on the clock before the next file. Only one file is ever being decoded.
- **Failures.** A file that fails to decode or upload is logged, counted in `failed` and skipped, and not retried until generation is started again.
- **Stopping.** Every start and stop bumps a run number. A stopped run ends at its next check, and the result of the file being decoded is dropped. Starting again asks the server afresh, so it continues with what is still missing. Nothing is remembered across a page load: F5 starts a new run.
- **Reading.** `get(id)` fetches a waveform once and caches it (about 2 KB each); a `404` is not cached, so a waveform made later is found. A waveform just made is cached as it is stored.
- **The decoder** (`WaveformDecoder`, `audio/web-audio-waveform-decoder.js`) fetches `/media/<id>`, decodes it with an `OfflineAudioContext` at 8000 Hz (22050 or 44100 Hz if the browser refuses), and reduces the samples to 1024 min/max pairs with `logic/peaks.js`. The decoder resamples while decoding, so a 5-minute stereo track takes about 10 MB instead of 100 MB, and only the 2 KB of peaks leave the method. It is the one part not covered by unit tests (TESTING.md).
- **Regenerating.** `regenerateWaveforms()` (the header menu, §9.1) has the service make every sound's and track's waveform again, sounds first and then tracks in playlist order, whether or not one is stored. It replaces the stored files and the cached peaks as each is made. A run in progress gives way to it, as to a stop.
- **Drawing** (§9.7, §9.2, `ui/waveform-draw.js`) scales each waveform to its own loudest peak, then shapes the levels so both loud and quiet stretches show detail. A linear scale hides the quiet parts of a loud track, and a track that is loud throughout reaches the top everywhere. Each level is therefore drawn as the average of two measures:
  - **its decibels** above a floor 42 dB below the peak (`FLOOR_DB`, about one step of the 8-bit peaks), which lifts quiet stretches;
  - **its rank** among all the track's levels (`RANK_WEIGHT` 0.5; equal levels share the middle of their ranks), which spreads crowded levels over the whole height, so spikes stand out.

  Silence stays a flat line, the loudest level reaches about the top, and the order of levels is kept.

### 6.7 External changes

The page changes its library while it runs only for the app's own downloads, deletions, moves and restores (§6.8). When files change outside the app, it only learns that they did, and the user decides when to load them, by a full reload.

- **Learning about changes.** Once the library has loaded, the facade connects to `ServerEvents` and keeps `hasExternalChanges()` in step with the server's messages, announcing every change of it as `library.externalChanges`. `checkExternalChanges()` asks the server for a quick check (§5.3) and announces its answer the same way. It does nothing before the library has loaded, or while a check is still running; a failed check is logged as a warning.
- **Refreshing.** `refreshLibrary()` emits `library.refreshing`, then waits for `SettingsSync.settle()` and `OptionsSync.settleAll()` (§6.4), so the rebuild reads the user's latest edits, and calls `BackendApi.refresh()`. It ends with `library.refreshed`, or with `library.refreshFailed` for invalid options files (with their problems), a missing `.soundboard` (`restartNeeded`) or a request that failed (logged as an error). A call while one runs is ignored.
- **Reloading.** Logic never touches `window`, so the UI reloads the page on `library.refreshed` (§9.1). The new page starts from the splash like any other (§9.0) and loads the new library; nothing about playback survives, which is how every reload already behaves.
- **No prompt on that reload.** The reload guard (§9.1) asks before any unload while `isAnythingPlaying()` is true. Pressing Refresh already told the user that playback stops, so the App sets a flag on `library.refreshed` that turns the guard off before it reloads.

### 6.8 Downloads, deletions, moves and the trash

The facade follows the server's download (§5.4) and takes in what it adds, so playback goes on undisturbed. Deletions, moves and restores from the trash (§2.5) change the library the same way.

- **Loading.** `start()` fetches the download state together with the library and settings. If that request fails, it logs a warning and carries on without it: both tools count as missing.
- **The job.** `download` messages from `ServerEvents` replace the job. The log starts afresh whenever the job's id changes, and is replaced when a message brings `log`, as on every new connection. Both are announced as `download.changed` with `logReset`. `download.log` messages append lines, replacing the last one first with `replaceLast`, and keep the last 1000. `startDownload` takes the job the server answers with, unless the event stream announced it first, in which case its log has already begun.
- **Additions.** Every tab hears every `library.added`, and again after reconnecting, so anything already known is skipped.
  - A new sound goes into `LibraryModel` (sorted by title, checked with `canPlay`) and is announced as `sound.added`.
  - A new playlist gets its own `PlaylistPlayer` and is announced as `playlist.added`.
  - For a playlist the page has, `LibraryModel.addTracks` takes only the tracks it doesn't know, in path order, and keeps everything else as it is here, so a change not saved yet isn't undone. Then `PlaylistPlayer.replaceTracks` takes the new list (§8.1) and `playlist.changed` follows.
  - Waveform generation is started again, so the new files get theirs (§6.6).
- **Deleting and moving.** Each method first waits for `OptionsSync.settleAll()`, so no save can reach a file after it has moved, then calls `deleteItem` or `moveItem`. It applies the `changes` in the answer itself, as if they had come from `ServerEvents`, so the page follows at once; the same messages arrive on the event stream too, in every tab.
- **Removals.** `library.removed` messages are skipped when the item is already gone here.
  - A sound stops instantly, all its instances (§7), and leaves `LibraryModel`, announced as `sound.removed`.
  - A track leaves its playlist's copy in `LibraryModel` (`removeTrack`). `PlaylistPlayer.replaceTracks` takes the shorter list, which stops the playlist instantly if that was its current track (§8.1), and `playlist.changed` follows.
  - A playlist stops instantly, its player is dropped, and it is announced as `playlist.removed`.
  - Whatever is cached for a removed file is forgotten: its decoded buffer (`BufferCache.forget`), its waveform (`WaveformService.forget`) and its URL. A new file may later take the same id and URL, and must never play or show the old one.
- **A move** is a removal followed by an addition, handled as above.
- **The trash.** `trash` messages set `trashSummary()` and are announced as `trash.changed` when the size or count differs; before the first, it is `{ size: 0, count: 0 }`. `restoreFromTrash` settles pending saves and applies the answer's `library.added` messages, as deleting and moving do. `loadTrash` and `deleteFromTrash` only pass the request on, since a purge changes nothing in the library.

### 6.9 Problems

`getProblems()` joins two lists (`ProblemList`, `logic/problem-list.js`), and `problems.changed { count }` announces every change of either.

- **The server's.** `problems` messages (§5.2) replace its list. Each has `count: 1`. `dismissProblem` takes a problem of this list out at once and tells the server (a failure is logged as a warning); `dismissAllProblems` does so for the whole list.
- **The page's own**, recorded from the events the facade announces anyway (§6.2), one row per kind and path, errors all:
  - `play-failed`: `sound.error`, and `playlist.error` (by track, else playlist);
  - `save-failed`: `sound.saveFailed`, `playlist.saveFailed` and `track.saveFailed`. The next successful save of that item removes the row (`*.saved`);
  - `download-failed`: a failed download, one row for each of its failed items, by title, once per job (`download.changed` repeats).
  - `host-failed` (a warning): the server did not make this page the host; the page stays standalone. `host-lost` (an error): another page took the role. Both have the path `host`, are removed when the page becomes the host, and have no item to forget (§6.10).
  - A repeat of the same kind and path raises `count` and replaces the message. `sound.removed` and `playlist.removed` forget the rows of the item, and of everything inside a playlist. These rows live only in the page and are gone after a reload.
- **Order.** The server's problems come first, in its order, then the page's in the order they began.

### 6.10 Host and remote

A page runs in one of three modes, chosen on the splash (§9.0): **standalone** (the plain player), **host** (a player that remotes can control) and **remote** (§9.15). A standalone page can become the host later from the ☰ menu, and a host can stop being one.

**Host mode** is part of `Soundboard`, because a host is a player.
- `becomeHost({ replace })` calls `claimHost` and then waits up to 5 s for the first `remote.role` message of its stream. It resolves `'hosting'`, `'taken'` (another host and `replace` false; nothing was changed) or `'failed`' (the server did not answer or refused). On `'failed'` the page stays standalone and records `host-failed` (§6.9).
- While hosting, the facade sends a `RemoteState` after every change that matters: `panic.changed`, `playlist.stateChanged`, `sound.activeChanged` and library changes (`playlist.changed`, `sound.changed`, `sound.added`, `playlist.added`, `sound.removed`, `playlist.removed`). Several changes in one tick are sent as one, and only one request is in flight at a time: if more changed meanwhile, the newest state follows as soon as it ends, so a slow answer never leaves a remote with an old state.
- `RemoteState` (`remote-state.js`, `buildRemoteState`) is `{ panic, playlists: [{ id, title, playable }], sounds: [{ id, title, playable }], players: [{ id, title, state, trackTitle }], activeSounds }`: the titles and ids of the board, the playlists that load, play or are paused in start order, and what Panic Stop would do. It has no progress, volumes or audio details, so it changes only when someone does something.
- A `command` message from the server (§5.5) goes to `dispatch` like any command from the UI. It is never run when the page is not the host.
- `remote.role { host: false }` while hosting ends the role: the page is standalone, `host.changed { hosting: false }` is announced and `host-lost` is recorded if the reason was `replaced`. `stopHosting` does the same by request and tells the server; on `pagehide` the page calls it with `keepalive`, so a reload does not leave the next load facing a host that is already gone.

**Remote mode** is not a `Soundboard`. `RemoteController` (`logic/remote-controller.js`) has the same kind of interface: `checkHost()` (`GET /api/remote`, used by the splash), `start()`, `stop()`, `state()`, `hostConnected()`, `panicState()`, command methods (`panicStop`, `playSound`, `stopSound`, `togglePlaylist`, `stopPlaylist`, `pausePlaylist`, `resumePlaylist`, `nextTrack`, `previousTrack`) and `on`. `start()` opens `?role=remote`. It emits `remote.hostChanged { connected }`, `remote.stateChanged { state }` and `panic.changed { state }`, and `remote.closed` when the stream brings `startup.closed`: it stops following, and the remote page loads `/`, which is the waiting page until a soundboard is open again (§5.2). A command is sent with `POST /api/remote/commands`; a failure is only logged, since the next state shows what happened. It creates no `AudioEngine` and never calls `unlockAudio`.

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
- **Stopping everything** (for Panic Stop, §6.1).
  - `fadeStopAll()` ramps every instance to silence over its sound's `fadeOut`, cut to the time the sound has left, and removes it a second after the fade (as a playlist's retiring voices are, §8). An instance whose sound has no fade-out, or whose length is not known yet, is removed at once, and one that is already fading out is left to finish. It also drops presses still waiting for a decode.
  - `stopAll()` removes every instance at once and drops pending presses. Both bump an epoch that counts toward every sound's own, so they cancel starts for sounds that have no instance yet.
  - `count()` returns how many live instances are fading (`fading` is true from the moment a ramp to silence starts, a natural fade-out included) and how many are not.
- **Changes only reach later presses.** An instance keeps the points and fades it started with, so dragging a handle never makes a playing sound jump or cut off. Volume is the exception, as it can't make anything jump.
- When a voice ends or fails, its instance is removed and its resources released, and `sound.activeChanged` is sent when the count reaches 0.
- A sound that is deleted or moved away is stopped like `stopSound`, which also cancels a press still decoding (§6.8).
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
- **Start and end points.** A track plays the part of its file between its `startAt` and `endAt` (§2.3), and that part *is* the track as far as the facade is concerned. Voices work in file time (§6.3); the player works in time **from the start point**, so `position`, `duration`, `crossfadeFrom`, `seek`, the 3 s rule of `previous` and the remembered position all count from 0 at the start point to the length of the part at its end.
  - **Fixed at start.** `planTrack` returns the track's points, and the player gives them to the voice and keeps them with the voice when the track starts. Editing the points never moves or cuts a track that is playing. The end is capped at the length the voice reports, and a start at or past the real end ends the track at once, as for sounds (§7), without an error. The voice ends the track at the end point (§6.3), so no timer of the player is needed.
  - **Crossfades and looping** use the length of the part: a crossfade lasts at most half of either track's part (§8.4), and a looping track repeats between its points (§6.3).
  - **Edited while not playing.** `setPlaylist` compares the points of the new copy with the old. If the changed track is the paused current track, the playlist stops instantly (as `stop('instant')`), and a resume point on a changed track keeps the track but drops the position, so it starts at the new start point. A playing track is never edited from the UI (§9.7).
- `seek` works in `loading`, `playing` and `paused`, clamped to the track, and with a crossfade coming, to the crossfade point (§8.4). While loading it is applied, and clamped, once the track has loaded.
- Which track plays is decided by the **play history** (below). Starting a playlist starts a fresh history. `next` moves forward in it and `previous` back; `jumpTo(index)` starts a fresh history at that track.
- `previous`: past **3 s** into the track, or at the first entry of the history, it restarts the current track (seek to 0, and resume if paused). Otherwise it goes back one entry. It never wraps from the first track to the last.
- `next` with nothing more in the history (only without `playlistLooping`) stops the playlist. The same happens when the last track ends by itself: the playlist goes idle and forgets its resume point (below). Without `playlistLooping`, Random's first fill is a round of every track in random order, as for Shuffle, so it too plays each track once and stops. Track looping wins over it, since a looping track never ends by itself.
- Track ends naturally: advance to the next entry. With a crossfade the next track has usually started already (§8.4); `ended` is the fallback.
- **Track looping.** With `trackLooping`, every new voice gets `setLooping(true)` (§6.3), so the current track starts over at its end, without a gap, and never ends by itself. The position, and with it the progress bar, jumps back at each loop. There is no crossfade timer and no crossfade marker while it loops (§8.4). Next, Previous and `jumpTo` move on as usual, and the new track loops in turn. `setRules` applies a change to the current voice at once: turned off, the track plays to its end and the playlist moves on. During a crossfade that is the incoming track; the outgoing one just finishes its fade.
- Track error (404, decode failure, rejected `play()`), or a track in a format this browser cannot play: send `playlist.error` and skip to the next entry. Unplayable tracks get no voice at all. After `tracks.length` errors in a row (reset whenever a track loads), the playlist stops instead of looping over broken files.
- `setRules` with a different order refills the history around the current track, which keeps playing (below), a different `playlistLooping` changes whether the history is extended from then on (entries already queued still play, and turning it back on extends again), and a different `trackLooping` is applied to the current voice.
- **What stopping remembers.** Stopping keeps the play history, and the `stopMode` rule decides what else the next `play` picks up. Whatever is kept is the *resume point*: a track and, for `pause`, its position.
  - `pause`: play again starts the same track and seeks to where it was. `resetTrack`: the same track, from its start point. `resetPlaylist` (the default): nothing is kept, and play starts as the order's first entry, as for a fresh playlist.
  - `'default'` and `'instant'` stops both remember. The position is the one at the moment of the stop, not where a fade-out ended, and a stop while a track is still loading remembers the position it was going to seek to. Stopping during a crossfade remembers the incoming track.
  - Resuming is an ordinary start: a `'default'` play fades in from the remembered position, `'instant'` doesn't, and a remembered position past the crossfade point lands on it, like any seek (§8.4).
  - **Forgetting.** Everything is forgotten when a track is chosen with `jumpTo` (which starts a fresh history), when the playlist stops by itself (no more tracks without playlist looping, or every track failing), and on `forget()` while idle. `forget()` only clears the resume point; the history stays, so the next play starts a fresh one anyway.
  - `setRules` with a different `stopMode` trims the resume point at once (`resetTrack` drops the position, `resetPlaylist` drops everything), so what the tile shows always matches the dialog. It never brings back what was dropped. A different order refills the history around the remembered track, as while playing.
  - Snapshots and `playlist.stateChanged` carry `resume` (§6.2) while idle.
- **Added and removed tracks.** `replaceTracks(playlist)` takes a copy with tracks added by a download or a move, or removed by a deletion or a move (§6.8), in path order, so tracks that stay may move.
  - A removed current track stops the playlist instantly, as `stop('instant')` does. Voices still fading out on a removed track end at once, and a resume point on one is forgotten.
  - The current voice, the retiring ones and the resume point are given their tracks' new indices. The play history is refilled around the current track, as for a new order, so Shuffle and Random reach new tracks too; without a current track it starts afresh at the next play.
  - The crossfade is planned again, since the next track may have changed. The current track keeps playing, and while active, or remembering a resume point, `playlist.stateChanged` is sent again with the new index.
- `setPlaylist(playlist)` takes a changed copy of the playlist with the same tracks in the same order (after a rename, new points or a new track gain), applies the tracks' gains to the current voice and the retiring ones at once, and, while active, sends `playlist.stateChanged` again so the current track's new title shows.
- Volume: each voice starts at `playlist gain × track gain`. `setGain(gain)` applies a new playlist gain to the current voice and to the retiring ones, each with its own track's gain. Fades use a separate gain stage (§6.3), so this never disturbs one.

**Play history** (`logic/play-history.js`). Each player keeps a list of track indices and a cursor at the current one. Upcoming tracks are entries too, so the crossfade timer, the crossfade marker and the natural end of a track all agree on one next track, even in Random.
- `start(at?)` fills a fresh history by the order (below) and returns the track to play; `at` is a track to start at, chosen in the track list or playing when the order changed.
- `setLoop(loop)` turns the extending on or off for the rest of the session; entries already in the history stay.
- `next()` moves the cursor forward. Past the last entry it first extends the history by the order, unless `playlistLooping` is off; then there is nothing more and the playlist stops. `upcoming()` returns the entry `next()` would move to, extending in the same way, so it can be asked for any number of times without picking again.
- `previous()` moves the cursor back, but never before the first entry (`canGoBack`). Going back and then forward replays the same tracks.
- `setOrder(order)` switches the order and, once started, refills the history as `start(current)` would; the current track keeps playing. While idle, the new order is simply used at the next start.
- `setTracks(trackCount, remap)` follows tracks being added or removed: `remap` gives a track's new index, or `null` for a removed one. Once started, the history is refilled as `start(current)` would around the current track's new index; if the current track was removed, the history is emptied, as before the first start.
- It keeps at most `MAX_HISTORY` = 2¹⁶ entries. Beyond that it drops the oldest entries, but only ones before the cursor, so the current track and the round ahead are never cut.

**Orders** (`logic/order-strategies.js`). Each fills the history with `start(trackCount, random, at, loop)` → `{ entries, cursor }` and `extend(trackCount, random, last)` → entries to append. They are pure apart from the injected `random`, so tests use a seeded generator.

| Order | Starting | Extending |
|---|---|---|
| `ordered` (default) | The whole playlist in order, with the cursor at `at` (or the first track), so Previous goes to the tracks listed before it. | The whole playlist in order again, so it wraps to the first track. |
| `random` | Just `at`, or a random track; without `loop`, a shuffled round like `shuffle`. | One random track that isn't `last`. |
| `shuffle` | A shuffled round of every track (Fisher–Yates), with `at` moved to the front. | A new shuffled round; if it would start with `last`, its first track is swapped with a random other one. |

Random picks among the tracks other than `last` directly instead of retrying, and with a single track both Random and Shuffle simply repeat it, so they can never loop forever.

### 8.2 Extension points

Each is a single seam that the planned features in the [roadmap](ROADMAP.md) fill in. `crossfade`, `fadeIn`, `fadeOut`, `order`, `playlistLooping`, `trackLooping` and `stopMode` are read from the playlist.

```js
// Resolved per playlist by resolvePlaybackRules(playlist); PlaylistPlayer.setRules replaces them while playing.
PlaybackRules {
	order: 'ordered',      // 'ordered' | 'random' | 'shuffle' (§8.1)
	playlistLooping: true, // false: the history is not extended, so the playlist stops after its first fill (§8.1)
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

// Per-track plan, in file time: the track's own points (§8.1).
planTrack(track, rules) → { startAt, endAt }
```

- A non-zero `fadeIn` ramps the new voice's gain from 0; a non-zero fade-out ramps the old voice to 0 in the retiring set. Both are covered by tests with non-zero rules.
- The plan's `startAt` and `endAt` are passed to the voice, which starts there and ends at the end point (§6.3).

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
- **For Panic Stop** (§6.1). `fadingOut` is true while the playlist is idle with voices still fading out. `silence()` is an `'instant'` stop that also cuts those voices, which `stop('instant')` does not do for an idle playlist. It remembers a place as any stop does.
- **Short tracks.** The fade-in has no extra limit; a crossfade or the track's end takes over from wherever it had got to.

---

## 9. UI

Dark theme, plain and functional. Icons appear only on controls (play, pause, stop, previous, next, volume, and the track list chevron) and as the saving spinner and checkmark (§9.7), drawn as inline SVG. Sound tiles have no icons, and playlist tiles only the turned-down volume bubble (§9.1).

### 9.0 Splash screen

Browsers only allow audio to start inside a user gesture, so the app starts behind a full-screen splash.

- On page load the app does **nothing** except show the splash: the app name and **"Choose how to start"** with three buttons, **Standalone**, **Host** and **Remote** (each with a line saying what it is). No audio context, and the only request is `GET /api/remote` (§5.2), which sets a note: under Host "Another page is the host. You will be asked before it is replaced." when there is one, under Remote "No host is running yet. It will work once one starts." when there is none.
- **Standalone** and **Host** call `soundboard.start()`, which creates and resumes the `AudioContext` **synchronously** inside the click. **Host** then calls `becomeHost` (§6.10); when it answers `'taken'` the replace dialog (§9.15) opens over the board, because a held button is not a gesture that may start audio. **Remote** opens the remote page (§9.15) and never touches audio. The splash shows "Loading…" while the library and settings are fetched.
- On `app.ready` the splash is hidden and the board is rendered. On `app.startFailed` the splash shows "Could not start the soundboard. Click to retry." with the error; clicking starts again.
- **Restart needed.** When a refresh fails because `.soundboard` is gone (§6.7), the splash comes back for good as "The audio folder needs a restart. Restart the app, then reload this page.", with the server's message under it. Clicks do nothing.
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

- The page is a full-height column: header (green-tinted with a green border while the page is the host) (the ☰ app menu button and the title, §9.3, then the role label "Host" while the page is the host (§9.15), then the Problems button while there are any (§9.14), the external changes button while there are any, the waveform progress while there is any, the Trash button while the trash holds anything, volume controls and the debug button, §9.8), a scrolling main area, then the footer.
- The main area has a "Playlists" section above a "Sound Effects" section. Both are always shown, even empty, because their titles carry the add buttons: **+ Add playlist** in blue and **+ Add sound** in amber (`tileGrid`, §9.9). With no playlists and no sounds, a line above them says none were found in this folder, until a download adds one.
- Tiles for sounds and playlists added by a download or a move (`sound.added`, `playlist.added`) appear at once in their sorted place. Tiles of sounds and playlists deleted or moved away (`sound.removed`, `playlist.removed`), in this tab or another, disappear at once, and a Customize dialog open for that item closes.
- Tiles are `<button>`s in a grid of columns at least 10rem (160 px) wide, with titles clamped to 3 lines. The full title shows as a tooltip.
- Playlist tiles have a blue accent and sound tiles an amber one.
- A playlist tile shows its track count when idle, following tracks added by a download, and "Loading…", "Playing" or "Paused" when active, and is highlighted while active.
- **Turned-down volume.** While a playlist's live volume (§6.4) is below full, its tile shows a small orange (`bg-boost`) bubble with a gray speaker icon at the bottom right, level with the status text, which is cut with an ellipsis (`truncate`) before it reaches the bubble. The tooltip gives the percentage. Double-clicking the bubble sets the volume back to full, and it disappears. The bubble is a sibling of the tile button, so it never toggles the playlist; the tile follows `playlist.levelChanged`. The volume itself is set only from the player bar (§9.2).
- A stopped playlist that remembers where it will resume (§8.1) keeps its normal idle look, except that its left border is dashed and its status, in the playlist accent, reads "Resumes at 1:23" (`pause`) or "Resumes track 3" (`resetTrack`). The tooltip names the track ("Combat: resumes "Boss Theme" at 1:23" or "… from its start").
- A **sound with live instances** is highlighted and shows a small ■ stop button in its top-right corner. That button is a sibling of the tile, not inside it, so pressing it calls `stopSound` and never also plays the sound.
- Tiles that can't play (an unsupported format, or a playlist with no playable track) are disabled, with a tooltip explaining why.
- A playlist or sound error flashes a red ring on its tile for 2 seconds.
- Sound and playlist tiles show a new title as soon as `sound.changed` or `playlist.changed` arrives, but tiles are only moved into the new sorted order when the Customize dialog closes, so a tile never jumps around while it is being renamed. Player bars show a new playlist title at once, too, and keep their start order.
- The footer shows **playlists only**. Sound effects never create a player bar.
- The footer is **always visible**, so the layout doesn't shift when music starts or stops. It is at least one row of player bars tall; while no playlist is active, that row shows a muted "No playlist playing". Player bars sit in a three-column grid, in the order the playlists were started. The footer grows to at most two rows of bars; beyond that it scrolls vertically.
- **Panic Stop** (`ui/panic-button.js`) has a fixed slot at the footer's right, as tall as one bar, so it never moves. It shows "Stop All" or "STOP NOW!", following `panicState()` and `panic.changed` through a `data-state` attribute (`fade` or `now`). It is yellow (`notice`) in `fade` and a filled red in `now`, and always enabled.
  - *Fade:* a press stops every playlist the normal way and fades each sound out over its own fade-out (§7), so the players need no panic rules of their own. If anything is left fading, the state becomes `now`. If nothing is (no fade-outs), everything has stopped and the state stays `fade`.
  - *Now:* the facade checks every 100 ms. It goes back to `fade` when nothing is fading out any more, or when anything plays that is not fading out, such as a sound just started. A press stops everything at once and goes back to `fade`.
- **Problems button** (`ui/problems-button.js`) sits left of the external changes button: an alert icon and "3 problems" ("1 problem"), outlined and colored red (`danger`) while any problem is an error and yellow (`notice`) while all are warnings, through `data-severity`. It is shown only while `getProblems()` is not empty, follows `problems.changed`, and opens the Problems dialog (§9.14).
- **Waveform progress** (`ui/waveform-indicator.js`) sits in the header left of the volume controls: "Waveforms 12 / 87" (with ", 2 failed" and ", stopped" when they apply), a thin bar and a ■ button that stops generation, or a ▶ button that starts it again. It is shown only while generation runs, or when some waveforms are missing or failed, and follows `waveforms.progress` through text and an inline width (§6.6). Until the server has said which waveforms are missing (`total` is still `0`), it stays hidden, so a page with nothing to make never flashes it.
- **Trash button** (`ui/trash-button.js`) sits right of the waveform progress: a trash icon and "Trash · 340 MB". The size is `formatMegabytes`: decimal megabytes, gigabytes from 1 GB on, one decimal below 10, and never less than `0.1 MB`. It is shown only while `trashSummary().count` is above `0`, follows `trash.changed`, and opens the trash dialog (§9.12).
- **Reload guard** (`ui/app.js`). The App listens to `beforeunload` and calls `preventDefault()` while `isAnythingPlaying()` is true, so reloading or closing the page makes the browser ask for confirmation with its own generic text. A paused playlist counts, since a reload would lose its position; a stopped playlist that only remembers a resume point does not. Nothing is asked while the board is silent, and the reload after an external-changes refresh is exempt (§6.7).
- **External changes** (`ui/external-changes-button.js`, §6.7). A yellow (`bg-notice`) **External Changes – Refresh** button sits in the header left of the waveform progress, shown only while `hasExternalChanges()` is true. Its tooltip says the page will reload and playback stop. Clicking it calls `refreshLibrary()`; meanwhile it is disabled and reads "Refreshing…". On `library.refreshed` the App reloads the page. When the refresh fails, the button comes back, and a dialog titled "Could not load the changes" lists each problem with its file ("Nothing was loaded. Fix or delete these files, then refresh again:"); a missing `.soundboard` brings back the splash instead (§9.0). The App also calls `checkExternalChanges()` whenever the window gets the focus back, so a change made in another window shows up at once.
- Color tokens are defined once, in Tailwind's `@theme` (§9.6).

### 9.2 Player bar

Each bar shows:
- The playlist title and `m:ss / m:ss` (`h:mm:ss` from an hour on), with `--:--` while the duration is unknown. Between them, at the right of the title, sits the **live volume bar** (`ui/level-bar.js`, §6.4): a `GainControl` with the `mini` option on `BUS_SCALE`, which is only a thin line, 5rem wide and 1rem tall, without the bars or the dB readout. Dragging or pressing it sets the level, double-clicking resets it to full, and the keyboard works as on the header volumes. The tooltip gives the percentage.
- The track title with a ▾ chevron. Clicking it opens the **track list popover**.
- ⏮ previous, ⏯ pause/resume, ⏭ next, and ⏹ stop. Previous, next and stop use the `'default'` transition; the instant versions are in the context menu.
- A progress bar over the waveform of the part of the track that plays (the stored waveform cut at the track's start and end points, §6.6; drawn on a canvas in `text-music/35`, redrawn on a track or points change, a resize or when the waveform is made). The bar is a thin line (`h-0.5`) in the middle of the waveform, in a row 2 rem tall. Pressing anywhere on that row seeks to that point. When a crossfade is coming (`crossfadeFrom`, §8.4), the stretch from that point to the end is drawn in a lighter blue (`bg-music/40`) under the playback fill, so it is clear where the next track will take over. Its width is set with an inline style, like the fill's. A looping track has no such stretch, and its fill and time go back to the start at each loop.

The track list popover lists every track, numbered, with the current one marked and scrolled into view. The bar keeps the newest playlist from `playlist.changed`, so the popover shows renamed tracks. Tracks this browser can't play are disabled. Clicking a track calls `jumpToTrack` with `'default'`.

### 9.3 Overlay and context menus

One shared `Overlay` shows the context menus and the track list popover; opening one closes any other.

- A full-screen backdrop (`black/35`) sits above the page. Presses on it are swallowed. A `click` or right-click on the backdrop **closes the popup**, so nothing on the page reacts. **Esc** also closes it. Closing on `click` rather than `pointerdown` keeps the whole press on the backdrop, so the element underneath never receives a stray click.
- A popup opens at the cursor (the track list at its chevron button). Where it would overflow the window, it flips to the other side of that point, and as a last resort it is clamped inside an 8 px margin. It is placed again whenever its size changes, because Tailwind may only style a newly used class after the popup has been measured.
- Right-clicking a tile suppresses the browser's own context menu. Choosing a menu item closes the menu first, then runs the action. Disabled items are greyed out.
- The ☰ app menu has **Become host** while the page is standalone and **Stop hosting** while it hosts. Become host calls `becomeHost`; on `'taken'` the replace dialog opens (§9.15).
- The ☰ app menu ends with **Change soundboard**, in a group of its own. It calls `closeSoundboard` (§6.1), and on `app.closed` the page loads `/`, which is now the Selector (§9.18); leaving the page stops its audio. Every other page of the soundboard follows through `startup.closed`. A failure is only logged to the console.

**Sound menu**

| Item | Behavior |
|---|---|
| Play | `playSound` |
| Stop All | `stopSound`; enabled only while instances are playing |
| Customize | opens the sound's Customize dialog (§9.7) |
| Metadata | opens the metadata dialog for the sound (§9.13) |

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
| Metadata | opens the metadata dialog for every track of the playlist (§9.13) |

Tracks are added from the Tracks tab of the playlist dialog (§9.9), so the menu doesn't offer it.

**App menu**, opened by the ☰ button at the left of the header (§9.1), below it:

| Item | Behavior |
|---|---|
| Regenerate waveforms | `regenerateWaveforms` (§6.6) |
| Become host / Stop hosting | `becomeHost` / `stopHosting` (§6.10) |
| Connect a phone | opens the QR code dialog (§9.16) |
| Info | opens the Info dialog (§9.17) |

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
- Safari is assumed to play Ogg (§12). Formats are still checked with `canPlayType` when the library loads, as a safety net: unsupported tiles are disabled rather than failing silently.
- Before closing, the page flushes any pending volume save (`pagehide`).
- These points are confirmed by hand ([`TESTING.md`](TESTING.md)).

### 9.6 Styling with Tailwind

- `public/vendor/tailwindcss-browser-<version>.js` is the unmodified `dist/index.global.js` from the npm package `@tailwindcss/browser`, with its MIT license next to it. `index.html` loads it with a plain `<script>`. It makes no network requests and uses no `eval`.
  - **Updating** means replacing the file, renaming it to the new version, and updating `index.html`.
- Components style themselves with utility classes. App-wide tokens (colors, fonts) and base styles live in one `<style type="text/tailwindcss">` block in `index.html`, using `@theme`. A small plain `<style>` sets the page background before Tailwind runs, so the page never flashes white.
  - `raised-dim` and `line-dim` are opaque colors halfway between `raised` / `line` and the dialog's `panel`, for cards at rest (§9.7). They are opaque so a pill drawn over a border never lets the border show through.
  - `animate-warn` pulses a background between the app's red and a darker red twice a second, for settings that can't play out as set (§9.7).
  - `notice` is the yellow of the external changes button (§9.1), kept apart from the sound effects' amber so it doesn't read as a tile.
  - `host` (green) and `remote` (purple) color the header of a host and of a remote page (§9.15).
- Colors that a component picks at runtime (a dialog's accent) are looked up in small maps of complete class names (`ACCENTS`), because the browser build only generates classes it sees written out.
- The browser build watches the DOM and generates CSS for class names as they first appear. Keeping that cheap:
  - Anything that changes several times a second (progress bars, time readouts) is updated through inline `style` or text, **never** by swapping classes.
  - State (active, playing, error) is a `data-*` attribute styled with Tailwind's `data-*` variants, so the full set of classes is already present when an element is created.
- Because CSS for a class is generated only after the class first appears, code that measures a newly built element must allow for its size changing afterwards (§9.3).

### 9.7 Customize dialog

**Dialog** (`ui/dialog.js`) is a centered modal shared by the Customize dialogs.
- It has a title, a body and a × button. Every change inside applies at once, so nothing can be lost by closing: the × button, Esc, and a click that both starts and ends on the backdrop all close it. Esc is left to a popup when one is open on top.
- It sits above the board and the footer, but below popups (§9.3) and the splash (§9.0).
- It is at most 90 % of the window high; its body scrolls under the fixed header. An optional `footer` stays below the body, as the trash dialog's buttons do (§9.12).
- A second `Dialog` opened while one shows stacks on top of it, as the move dialog does over a Customize dialog (§9.11). Esc closes only the top one.
- When a Customize dialog closes, the board saves its pending changes at once (`flushSoundOptions`, or the playlist dialog's `flushEdits`, which covers the playlist and every track renamed in it) and moves that kind of tile into sorted order.

**Accent.** Each dialog has one accent color for everything that lights up: amber (`sfx`) in the sound dialog, blue (`music`) in the playlist dialog. The parts below take it as an `accent` option.

**Shared parts** (`ui/customize-parts.js`), from which both dialogs are built:
- **Card** (`card(title, accent, ...children)`). Settings are grouped in raised cards with rounded corners, a soft shadow and the title as a small uppercase pill on the top border. At rest the card is dimmed (`bg-raised-dim`, `border-line-dim`) and the pill is drawn in the border's color, so it reads as part of the border. While the card is hovered or anything in it has focus, it lights up (`bg-raised`, `border-line`) and the pill takes the accent color, so it is clear which part of the dialog is being worked with. Pills stick out above their cards, so cards are spaced `space-y-8`. A pill stays on one line within its card, ending in "…" with the full title as a tooltip.
- **Labeled row** (`labeledRow`). Several settings in one card: a fixed-width label on the left, the control on the right.
- **Radio group** (`radioGroup({ name, choices, value, accent, onChange })`). Native radio buttons in the accent color (`role="radiogroup"`), each with its name and a one-line description below it. Choosing one reports it at once; `update(value)` follows changes made elsewhere.
- **Checkbox** (`checkbox({ name, label, description, checked, accent, onChange })`). One on/off setting, laid out like a radio choice: a native checkbox in the accent color, its name, and a description below. `update(checked)` follows changes made elsewhere.
- **Title.** A filled field (below), focused on open, with the floating label "Title" and a hint below it. The hint, usually a file or folder name, stays on one line, ending in "…" when too long, with the full text as its tooltip. Every edit is sent at once. While the field is empty or only spaces, it is marked invalid (`aria-invalid` and `data-invalid`), nothing is sent, the hint explains that the last title is kept, and the tile keeps it.
- **Volume.** The gain widget on `ITEM_SCALE`.
- **Play / Stop.** A button showing whether the item is playing, filled in the dialog's accent with dark text.
- **Status.** Without text: a spinner after a change, a checkmark once saved. A failure is shown as a red message.
- **Footer** (`playFooter`). Both dialogs hand Play / Stop and the status to the `Dialog` as its footer, so they stay in view below the scrolling body, on every tab: Play in the middle, the status at the right.
- **Move or delete** (`moveOrDeleteCard`), the last card of the sound dialog, of an open track row ("Move or delete") and of the playlist's first tab ("Delete", without Move, with the note "The folder and everything in it go to the trash."). **Move…** on the left opens the move dialog (§9.11); **Hold to delete** on the right deletes (§2.5). A failure shows as a red message in the card. On success the item leaves the library, and the board closes the dialog or the accordion drops the row.
- **Hold-to-delete button** (`ui/hold-button.js`). A red-outlined button that acts only after being held down for 0.5 s (`HOLD_MS`, or its `holdMs` option), by the pointer or by holding Enter or Space, so a slip never deletes anything. While held, a red fill sweeps across it from the left: a CSS width transition started by `data-holding`, so nothing updates during the hold (§9.6); its duration is an inline style, since Tailwind can't build a class from a variable. The `neutral` tone draws it grey instead, for actions that aren't deletions, such as Restore (§9.12). Releasing early, leaving the button, losing the focus or `pointercancel` cancels it, and the fill snaps back; key repeats are ignored. While the request runs it is disabled and reads "Deleting…".
- **Tabs.** A tab bar over panels (`role="tablist"`, `tab`, `tabpanel`), the first selected unless another is asked for. The left and right arrow keys move between tabs, and only the selected panel is shown. The bar stays at the top while the dialog scrolls.

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
- **Move or delete** (above).

In the footer: Play / Stop (`playSound`, or stopping all instances; it follows `sound.activeChanged`, so it also reflects presses on the tile) and the status (`sound.saved`, `sound.saveFailed`).

**Start and end section** (`ui/range-control.js`). It works in whole milliseconds and shows them as seconds with three decimals. Every change sends both points with `customizeSound`, and `sound.changed` updates the control unless a handle is being dragged.
- **Slider.** It spans the sound's stored duration. Two handles (`role="slider"`, "Start point" and "End point") never cross and stay at least `MIN_CLIP_MS` apart. Dragging a handle moves it; pressing the bar moves the nearer handle there (the start on a tie) and keeps dragging it. The part between the handles is amber (`bg-sfx`) on a dim bar. Handle and bar positions are inline styles (§9.6).
- **Waveform.** When the file's waveform is available (§6.6), it is drawn on a canvas above the slider, in the accent color, `h-14`, with the slider's width and margins so a handle stands over the sound it cuts at. The part outside the handles is dimmed by two shades whose widths are inline styles. Dialogs ask for it when they open a sound or when a track's row opens, and again on `waveform.ready`; without one, the control looks as it did. `ui/waveform-draw.js` holds the pure column and drawing code (unit-tested), `ui/waveform-canvas.js` the pixel-density handling. It is shown in seek mode too.
- **Fades on the slider.** Inside the amber part, the fade-in is drawn in blue (`bg-music`) from the start handle and the fade-out up to the end handle, as shares of the part that plays (`fadeBands`). Where they overlap, that stretch pulses red (`animate-warn`, §9.6); when either fade is longer than the whole part, all of it does. The dialog passes the fades in with `showFades` whenever the sound changes.
- **Keyboard.** On a handle, the arrow keys step 0.010 s and Shift + arrow 0.100 s; Home and End go to the handle's limits.
- **Fields.** "Start" on the left and "End" on the right are filled fields with the unit `s`, showing three decimals (`1.250`). They take seconds (`1.25`, `1,25`, `1.25 s`), rounded to whole milliseconds, and apply on Enter or when the field loses focus; values out of range are clamped. On Enter, text that can't be read marks the field red; leaving the field drops it. Esc restores the field without closing the dialog. A field being typed in isn't overwritten by updates.
- **Reset.** A bar in the fields' underline color joins the two fields, with a small Reset pill in its middle that goes back to the whole file.
- **Readout.** Centered below, in small text: "Plays 0.670 s of 1.670 s".
- **The end of the file is stored as `null`.** An end point at the duration is sent as `endAt: null`, so a longer replacement file still plays to its end. Stored points are fitted into the duration for display.
- The clamping, mapping, key steps, fade bands, formatting and parsing are pure functions in `ui/range-scale.js`, with unit tests.

**The playlist dialog** (`ui/playlist-editor.js`), opened from the playlist menu, in blue, always on its first tab:
- **"Playlist" tab:** cards for the **Playlist** (the title, hint: `Folder: <directory>`), the **Volume**, the **Playback order**, **When stopped**, the **Fades**: Fade in, Crossfade and Fade out as labeled rows of seconds controls (below), and **Delete** (above). Later playlist settings add their cards before Delete.
  - **Playback order** is a radio group, sent with `customizePlaylist({ order })` and following `playlist.changed`: **Ordered** "First to last, as listed.", **Random** "Any track next, never the same one twice in a row." and **Shuffle** "Every track once in a shuffled order, then shuffled again." Below the radio buttons, after a divider, come two checkboxes: **Repeat the playlist** "When off, it stops after the last track.", sent with `customizePlaylist({ playlistLooping })`, and **Repeat the current track** "It plays again until you move to another track.", sent with `customizePlaylist({ trackLooping })`.
  - **When stopped** is a radio group, sent with `customizePlaylist({ stopMode })` and following `playlist.changed`: **Pause** "Playing again continues where it stopped.", **Reset track** "Playing again starts the same track from its beginning." and **Reset playlist** "Playing again starts afresh, as if for the first time."
- **"Tracks (N)" tab:** the track accordion (`ui/track-accordion.js`). The count in the tab follows `playlist.changed`.
  - The list runs edge to edge between the tab bar and the footer, with lines between the rows and no outer border. Below it, a blue **+ Add tracks** button opens the add dialog for this playlist (§9.9), in place of this dialog. This dialog comes back, on the Tracks tab, when the add dialog is closed without downloading, or when the download it started is dismissed.
  - One row per track: a play / stop button, then a button with `aria-expanded` showing number and title, and a small blue "Cropped" bubble when the track's points differ from the whole file (no duration is shown). Clicking the button area opens the row and closes any other; clicking the open one closes it. Hovering anywhere on the header tints the whole row blue (`bg-music/15`), and the open row's header has a stronger tint (`bg-music/20`) and a blue title.
  - **Test playback** (`ui/track-playback.js` holds the pure rules, with unit tests). Only the playlist's current track is playing or paused (`trackPlayback`), and a loading track counts as playing. The row's button is a sibling of the toggle, so pressing it doesn't open or close the row. It does what `trackAction` says: on a track that isn't current, `jumpToTrack(…, { transition: 'instant' })`; on the playing track, `stopPlaylist(…, { transition: 'instant' })`, which follows the stop mode (§8.1); on a paused track, `resumePlaylist`. Buttons follow `playlist.stateChanged`, so a track started from the footer shows as playing here too. All tracks are assumed playable.
  - A track whose gain differs from 0.0 dB (as `formatDb` rounds it) shows a small bubble in its header with the change: `+3.5 dB` in orange (`bg-boost/20`) when louder, `−6.0 dB` in cyan when quieter. It follows `playlist.changed` and is hidden at 0.0 dB.
  - **Tracks leaving.** On `playlist.changed`, the row of a track deleted or moved away is removed (and closed, if it was open), the others are numbered again, and each row looks its index up when its button is pressed, since indices shift. The rest of the dialog stays as it was, scrolled where it was.
  - An open track shows four cards (`card`, §9.7): **Start and end**, **Volume**, **Track** and **Move or delete**. The playlist's only track adds the note "This is the only track: deleting or moving it deletes the playlist too."
    - **Start and end** holds one `RangeControl` (as in the sound dialog, below) in the blue accent, over the whole file. It is both the range editor and the seek bar:
      - **Editing.** Unless the track is playing (a loading track counts as playing), it has its handles, fields and Reset. Every change goes to `customizeTrack({ startAt, endAt })`, with the end at the end of the file stored as `null`, and the control follows `playlist.changed` unless a handle is dragged. Editing a paused track stops the playlist (§8.1), so the control then shows its editor anyway.
      - **Seeking.** While the track plays, `showPlayback` switches it to a seek bar: the handles are hidden, the fields and Reset disabled, what has not played yet dimmed (`bg-black/45`) and the stretch a crossfade will take over lightened (`bg-white/30`), hidden while the track loops (§8.4). Pressing anywhere on the bar calls `seek` with the position within the part that plays, clamped to the points. Progress follows `playlist.progress`, and the playhead and crossfade widths are inline styles (§9.6).
      - A track without a measured duration has no such card.
    - **Volume** holds the gain widget on `ITEM_SCALE` for the track's own gain, sent with `customizeTrack({ gain })` and following `playlist.changed`. It does not show the playlist's gain, which is on the first tab. A change reaches the track that is playing at once.
    - **Track** holds the title field (hint: `File: <track id>`), sent with `customizeTrack`. Row headers follow `playlist.changed`, while the open field is left alone, so it keeps its focus while typing. Later track settings get their own cards in the open row.
- **In the footer**, staying in view while either tab scrolls: Play / Stop (`togglePlaylist`, like a tile click; it follows `playlist.stateChanged`) and the status, which follows the playlist's saves (`playlist.saved`, `playlist.saveFailed`) and its tracks' (`track.saved`, `track.saveFailed`).

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

### 9.9 Add dialog

`ui/add-dialog.js`, opened in the shared `Dialog` (§9.7) by **+ Add sound** ("Add sounds", amber), **+ Add playlist** ("Add a playlist", blue) and **+ Add tracks** on the playlist dialog's Tracks tab ("Add tracks to Combat", blue), which it returns to (§9.7).

- **Tools missing.** When `getDownloadTools()` reports a missing tool, every Add button opens a small "Downloads are not available" dialog instead: "Downloads need yt-dlp and ffmpeg. ffmpeg was not found when the app started. Install it, then restart the app."
- **Link.** A filled field "Link", focused on open, and a **Look up** button; Enter looks up too. A hint below says what can be pasted. While the lookup runs, the button is disabled and reads "Looking up…". A failed lookup shows the server's message in red under the field.
- **Choices**, in cards below, depending on what was found:
  - **File:** its name, type and size, or "Size unknown".
  - **Video:** its title, duration and size, or "Size unknown". When the link also names a playlist, a "Show the whole playlist instead" link looks it up again as the playlist.
  - **Chapters**, for a video that has them: a radio group, **One file** "The whole video as one file." or **Split into chapters** "One file per chapter (N).". Splitting shows a checklist of the chapters, with their durations.
  - **Playlist:** its title and number of entries, and a checklist of the entries, with "Only the first 500 entries are listed." when it was cut short.
  - Checklists start with everything ticked and have **Select all**, **Select none** and "5 of 12 chosen". They scroll within 16 rem.
  - **New playlist**, for **+ Add playlist**: a "Playlist title" field filled in with the file's name (without extension), the video's or the playlist's title.
  - For sounds, each chosen chapter or entry becomes its own sound.
- **Download.** The button in the dialog's accent reads "Download 1.4 GB" when the size is known, and is disabled while no chapter or entry is chosen or the new playlist's title is empty. A file or video over 500 MB (`LARGE_DOWNLOAD_BYTES`) gets the yellow warning "This is a large file." beside it, and one of unknown size "The size of this file is unknown.", so a huge file is never fetched by accident. Playlists show no size. Clicking it calls `startDownload`, and the dialog closes once the server has started; an error shows under the link field.

### 9.10 Download dialog

`ui/download-dialog.js` shows the server's download while one exists, in every open tab and again after a reload, since it follows `getDownload()` and `download.changed`.

- **Locked, but not the footer.** The board's header and main area sit in a `relative` box, and the dialog is an `absolute inset-0 z-20` layer over that box only, with a dark backdrop. The board can't be used until the download ends, while the player bars below stay usable, so music can still be paused, skipped or stopped. It has no × button, and neither Esc nor the backdrop closes it.
- **Top:** "Downloading <title>" and "Adding sound effects" or "Adding to <playlist>", then the current item: "Downloading · Item 3 of 7: <title>".
- **Log:** a monospace pane, 20 rem tall, of one row per line, so a progress line is rewritten in place. New lines are only ever appended (§9.6), keeping the last 1000. It follows new lines while scrolled to the bottom, and stays put once the user scrolls up. `logReset` rebuilds it from `getDownload()`.
- **Cancel** asks "Cancel the download? Files already added stay." with the browser's confirm box, then calls `cancelDownload()`.
- **When it ends,** the heading says "Download finished", "Download finished with errors" or "Download cancelled". A summary above the log says "6 added, 1 failed." (", the rest cancelled" when cancelled) and lists each failed item with its error in red. Cancel gives way to **Close**, which calls `dismissDownload()` and closes it in every tab.

### 9.11 Move dialog

`ui/move-dialog.js`, opened by **Move…** in the sound dialog or a track row (§9.7), titled `Move "<title>"`, in a second `Dialog` stacked on top of the Customize dialog.

- **Destinations,** as full-width buttons, each with a colored stripe on its left, its name, and a count below ("4 sounds", "6 tracks"). **Sound effects** always comes first, in amber (`sfx`), then every playlist in title order, in blue (`music`). Hovering tints a button in its color. The first destination that can be picked has the focus.
- **The current place,** the sound effects for a sound and the track's playlist for a track, is greyed out and disabled, its count followed by "· Here now".
- **Picking** one calls `moveSound` or `moveTrack` at once, with every button disabled meanwhile. A failure shows in red below the list, and the buttons come back.
- **Afterwards** the move dialog closes. A moved sound leaves the library, so the board closes its sound dialog too (§9.1). A moved track only leaves its row, so the playlist dialog stays as it was, ready for the next track, unless it was the playlist's only track, which removes the playlist and closes its dialog. Closing the Customize dialog closes a move dialog over it.

### 9.12 Trash dialog

`ui/trash-dialog.js`, opened by the header's Trash button (§9.1), titled "Trash".

- **The list** comes from `loadTrash()` when the dialog opens. **Playlists** come first, as on the board, each a row with a blue stripe, its title, and its track count and size. Its tracks follow, indented beneath it, with a lighter blue stripe. **Sound effects** follow, with an amber stripe. A file's muted line shows its path inside the trash when that differs from its title, and its size; it ends in "…" when too long, with the full text as a tooltip.
- **Each row** has **Restore** (the neutral hold button) and **Delete** (the red one), each held for 0.5 s.
- **The footer** shows the total size, then **Restore all** and **Delete all**, each held for 2 s.
- **One action at a time.** While one runs, every button is disabled and the one pressed reads "Restoring…" or "Deleting…". A failure shows in red in the footer. Afterwards the list is fetched again.
- **Following changes.** Every `trash.changed`, from this tab or another, fetches the list again, and answers to older requests are dropped. The dialog closes once the trash is empty. Restored items appear on the board like any addition (§9.1).

### 9.13 Metadata dialog

`ui/metadata-dialog.js`, opened by **Metadata** in the sound and playlist menus (§9.3), titled `Metadata: "<title>"`, read-only. It reads the files' `source` from `getLibrary()` (§2.3).

- **A sound** shows one raised card (`card`, §9.7), titled "Source", amber. **A playlist** shows one blue card per track, in playlist order, in one scrolling list, each titled with the track's number and title.
- **Rows**, as a label and a value: **File** (the path inside the root), then the source's fields from `sourceRows` (`ui/source-fields.js`): **Origin** ("Downloaded", "Found in the file name", "Found in the file's tags", "Unknown", or "Entered by hand" for `edited`), **Link**, **Site** (the extractor), **Video**, **Playlist** and **Chapter**. The rows come from that one list of fields, each naming its source key, so an editor can later turn them into fields.
- **No value** shows an italic "n/a" at lower opacity.
- **Links** open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`). **Link** links to its `url` when that is `http(s)`. For a YouTube source (an extractor starting with "Youtube"), the ids are linked too, rebuilt so they work whatever link was recorded:
  - **Video:** `https://www.youtube.com/watch?v=<videoId>`.
  - **Playlist:** `https://www.youtube.com/playlist?list=<playlistId>`, followed by an "in playlist" link to `watch?v=<videoId>&list=<playlistId>`.
  - **Chapter:** `watch?v=<videoId>&t=<whole seconds>s` when `chapterStart` is known; otherwise the number is plain text.
- Long values end in "…" with the full value as a tooltip, and everything can be selected and copied.

### 9.14 Problems dialog

`ui/problems-dialog.js`, opened by the Problems button (§9.1), titled "Problems". It lists everything `getProblems()` returns (§6.9), errors first and otherwise in that order.

- **Rows** are cards with a left border in red (error) or yellow (warning), carrying `data-problem` (the id) and `data-severity`. Each shows the kind in small capitals ("Unknown duration", "Unsupported file", "Orphan options file", "Symbolic link", "Empty playlist", "Would not play", "Not saved", "Download failed", "Could not become the host", "Not the host any more", "yt-dlp outdated"), with " ×N" when it happened more than once, then the path (ellipsis, full path as a tooltip), then the message in muted text, and a **Dismiss** button.
- **Footer.** **Dismiss all**, at the right, below the scrolling list.
- **Following changes.** The list is drawn again on every `problems.changed`, and the dialog closes itself once nothing is left.

### 9.15 Host, remote page and replace dialog

**Header.** A host's header is tinted green and carries a green "Host" label next to the title. A standalone page's header is as before.

**Replace dialog** (`ui/replace-host-dialog.js`). Opened when a page asks to become the host and another already is. It says the other page will become standalone and stop being controllable, and has **Cancel** and a `holdButton` (§9.7) "Hold to take over" that must be held for one second. Holding it calls `becomeHost({ replace: true })`; a failure there is recorded as `host-failed`.

**The remote page** (`ui/remote-view.js`, `data-remote-view`) is what a phone shows. It has no volumes, ☰ menu, context menus, Customize, errors, Debug, trash, downloads or progress, and creates no audio.

```
┌──────────────────────────────────────────┐
│ REMOTE ●                      [Stop All] │  header (purple), host status dot, Panic Stop
├──────────────────────────────────────────┤
│ Combat · Battle theme            [■] [⏭] │  one row per playing playlist
│ Tavern · Drinking song           [■] [⏭] │
├──────────────────────────────────────────┤
│ PLAYLISTS                                │
│ [Combat] [Tavern] [Ambient]              │  main (scrolls)
│ SOUND EFFECTS                            │
│ [Explosion] [Door creak] [Sword]         │
│            [−] [+] [A−] [A+]             │  at the end of main, at the bottom of a short page
└──────────────────────────────────────────┘
```

- **Header.** The label "Remote" on a purple background, then a small round status dot, green while a host is connected and red otherwise (`data-host-status`; the `title` says "Host connected" or "No host"), and Panic Stop (`PanicButton` with a `PanicSource`, which `RemoteController` also implements) in the corner. There is no title.
- **Players.** A row for each playing playlist (the `players` of the state, §6.10): the playlist title above the track title, both with an ellipsis, and two buttons on the same row: **Stop** (`playlist.stop`) and **Next**. Rows that did not change are not rebuilt, so a press is never lost to an update.
- **Buttons.** Playlist and sound buttons fill a grid of equal columns; each is a 4:3 box, so its height follows its width. A playlist button toggles its playlist (`playlist.toggle`) and shows only a color for playing; a sound button plays the sound, and stops it when pressed again while it plays (`sound.play` or `sound.stop`). Buttons of what cannot play are disabled. They are built again only when the titles or the lists change.
- **Size.** At the end of the scrolling area, so they take no room while the page scrolls and sit at the bottom of the screen when the page is short: **−** and **+** set the number of columns (1 to 8, 3 at first), **A−** and **A+** set the text size (10 to 28 px, 14 at first). Both are remembered in `localStorage`. After each press the page scrolls to the end, so the buttons stay under the finger. Clicks less than 60 ms apart count once, because Firefox's touch emulation sends a double tap as three.
- **No host.** A notice says no host is connected and every button is disabled; the page follows when one appears. It shows nothing from before the host left.
- Everything changes only through the host's `remote.state` messages (§5.2), never by guessing.

### 9.16 Connecting devices

With `--lan` (§5.6) a phone pairs with the server by approval. Nothing here is shown or changes without `--lan`, except the menu item.

**The requests banner** (`ui/access-requests-banner.js`, `data-access-requests`) sits under the header of the board, in every standalone or host page on the server. It is part of the page, not a layer over it, so the sounds stay usable while a request waits. It is hidden when there are no requests, and shows one card per request (`data-access-request="<address>"`): "A device asks to connect: <address>", the code (`data-access-code`) and two buttons, **Allow** (green) and **Deny** (`data-access-decision`). A button calls `answerAccessRequest` (§6.1); the card goes when the server's next `access.requests` message no longer lists it, so with two pages open, the first answer removes the card in both.

**The connect page** (`public/connect.html`, `public/app/connect.js`) is what a device that is not allowed gets for `GET /` (§5.2). It shows the app name, then:
- the code in large digits (`data-pairing-code`) and "Waiting for approval…" with a line telling the person to allow the device on the server, where the same code shows;
- "Allowed", then a reload that opens the app, once the server allowed it;
- "Denied" and "The request expired", each with **Try again**, which pairs afresh;
- "Blocked" when the address was banned.

`AccessRequester` (`logic/access-requester.js`) is its state machine, with a `ConnectApi` (`request()`, `poll()`) and a `Clock`: it asks to be paired with `POST /api/access/requests`, polls `GET /api/access/requests/mine` once a second (`POLL_MS`) and stops at the first answer that is final. `none` after the request means it expired. A failed request or poll is tried again. `connect.js` reads a `403` with the text "This address is blocked" as a ban. Any other `403` means the device was allowed in another tab while this page was open, so it reloads once per tab (`sessionStorage`), and an unexpected refusal never loops.

**Connect a phone** (☰ menu, `ui/connect-phone-dialog.js`, `data-connect-phone`) is a dialog with a QR code (`canvas[data-qr-code]`) of the first address from `GET /api/access/links`, followed by every address as selectable text (`data-connect-link`). Without `--lan` it says to start the app with `--lan`. The code is drawn by `logic/qr-code.js` (`encodeQr(text) → boolean[][]`), a small encoder of its own, since the app has no runtime dependencies: byte mode, the lowest error correction (L), versions 1 to 6 (up to 134 bytes; a longer text throws `QrTooLongError`), and the mask with the fewest long runs. It is drawn with a four-module white border.

### 9.17 Info dialog

`ui/info-dialog.js`, opened from the ☰ menu (§9.3), titled "Info" (`data-info`). It loads `fetchInfo()` (§6.1) each time it opens, showing "Loading…" meanwhile and an error line if that fails. Then a two-column list has one row per program (`data-info-row` = `app`, `yt-dlp`, `ffmpeg`): the name in muted text, then the version, or "Not installed" in muted text.

Under yt-dlp's version, a small line (`data-update-state`) says what `yt-dlp -U` did at startup (§5.4): "Up to date", "Updated at startup from 2026.10.21", "2026.10.26 available, but the update failed" in yellow, or "Could not check for updates"; the last two have the error as a tooltip. There is no such line when yt-dlp is missing.

### 9.18 Selector

`public/selector.html` with `public/app/selector.js`, what `/` shows in the `selecting` phase (§5.2). Its logic is `StartupFlow` (`logic/startup-flow.js`, tested with a fake `StartupApi` and the fake clock, like `AccessRequester`, §9.16), over `HttpStartupApi` (`api/startup-api.js`), whose actions reject with the server's message.

- **`StartupFlow`** polls `GET /api/startup` at once and every 500 ms (`STARTUP_POLL_MS`). A page belongs to one phase: once the server is in another, it stops polling and calls `onLeave`, and the page loads `/`. It keeps a `StartupView`: the state, `connected` (false while the server doesn't answer), the starting places, the folder shown, `error` (the last action's failure, until the next action), `browseError` with a `browseFailures` count, and `busy` while an action runs; a second action meanwhile is ignored. Each action is followed by a poll. A folder that can't be shown leaves the one shown in place; the answer to an older browse is dropped when a newer one was asked.
- **Layout**, centered, at most `max-w-3xl`: "Soundboard" and "Choose a soundboard", a notice while the app doesn't answer ("The app doesn't answer. If it was stopped, start it again; this page carries on by itself."), the error line in red, then the sections, and a footer.
- **With folders from the command line**: a "Soundboards" section with one card per folder (`data-folder-card`, the name over the full path); a refused one is greyed out with its reason under the path and as the card's `title` (`data-refused`). The browser and the recent folders are hidden.
- **Otherwise**: "Recent" cards, each with a × (`data-forget`) that forgets it, and one that no longer exists greyed out as "This folder doesn't exist any more."; then "Browse", loaded once the first state says no folders were given:
  - the starting places as buttons (`data-place`, `data-current` on the one shown);
  - a path field (`data-path-input`) you can paste into, with Go (or Enter);
  - a row with **↑ Up** (`data-folder-up`, disabled at the top of a disk), a summary (`data-folder-summary`: "Soundboard folder", "No soundboard here yet: 3 folders, 12 audio files", or the reason it can't be opened, in yellow), and the action button (`data-folder-open`): **Open** for a soundboard, **Create soundboard here** otherwise, disabled when refused, with the reason as a tooltip;
  - the subfolders (`data-folder-list`, at most half the window high, scrolling): each name opens it in the browser; a refused one is muted with its reason as the `title`; a soundboard has a "Soundboard" badge and its own **Open** button.
- **A folder that can't be shown**, typed in or reached with Up, shows its reason in a small red notice in the bottom-right corner (`data-toast`, `role="status"`). It fades in, stays a second, and fades out (`data-visible`, an opacity transition); the path field goes back to the folder shown, even when the same path is refused twice.
- **Footer** (`ui/startup-parts.js`): yt-dlp and ffmpeg (`data-tool`), each "checking…", its version, or "not installed, so downloads are off" in yellow; yt-dlp's adds "up to date", "updated", "update failed" or "could not check for updates", with the error as its tooltip.
- Parts are drawn again only when what they show changed, so polling never resets a hover or a typed path.
- **Extension point**: startup settings, such as LAN access, would go into a section of their own here.

### 9.19 Initializer

`public/initializer.html` with `public/app/initializer.js`, what `/` shows in the `initializing` phase, over the same `StartupFlow`. It shows "Opening a soundboard", the folder's name over its path, then one panel (`data-initializer-step` = the step):

- **`scanning`**, **`starting`**, **`waitingForTools`**: a line, "Reading the folder…", "Opening the soundboard…", "Waiting for the yt-dlp update to finish…".
- **`measuring`**: "Measuring the duration of each audio file: 120 of 450" over a progress bar (`data-progress`), both updated in place (§9.6), and a note that this happens once per file.
- **`question`**, with the two answers as buttons (`data-answer` = `no` / `yes`):
  - large folder: "This folder holds 6,123 audio files and isn't a soundboard yet.", what opening it writes, **Back** / **Create the options files**;
  - nested folders: the paths in red in a list, **Back** / **Merge them**;
  - metadata titles: `path → "Title"` rows, **Use the file names** / **Use these titles**.
  Lists show the first 200 and count the rest.
- **`failed`**: in red, "Some of the soundboard's own files can't be read, so it can't open." or "The soundboard could not be opened.", then the error, the failing files (`data-startup-failure`) with their problems, and **Back**, **Try again** (`data-startup-action`) and, when they may be deleted, a `holdButton` (§9.7) held for 1 s, **Hold to delete these files and start**, with a line saying the settings in them are lost.
- When the session reaches `ready` the page loads `/`, which is the board's splash (§9.0); after a No or Back it is the Selector.

**Remote devices** get `public/waiting.html` instead before a soundboard is open (§5.2).

---

## 10. Project structure

```
index.js                         entry point: wires process streams and signals into src/cli/main.js
package.json  package-lock.json  type: module, engines, scripts (§10.2), dev dependencies only
eslint.config.js  .editorconfig  tsconfig.json  tsconfig.*.json (§10.1)
scripts/        mutate.js                checks that tests fail when code is broken (TESTING.md)
src/
	cli/        main.js  args.js  open-browser.js  colors.js
	startup/    startup-session.js  folder-rules.js  folders.js  recent-folders.js  errors.js
	library/    bootstrap-service.js  scanner.js  classify.js  sort.js  validate.js  errors.js
	            options-store.js  settings-store.js  library.js  library-editor.js  durations.js  waveform-store.js
	            change-watcher.js  tree-snapshot.js  file-moves.js  trash.js  sources.js  problems.js
	downloads/  download-service.js  probe.js  yt-dlp.js  ffmpeg.js  link-fetcher.js  process-runner.js  line-splitter.js
	            tools.js  yt-dlp-update.js  file-names.js  workspace.js  errors.js
	metadata/   index.js  id3.js  ogg.js  mpeg.js  binary-reader.js
	remote/     remote-relay.js
	http/       app-server.js  server.js  router.js  responses.js  static-files.js  media.js  range.js  mime.js  request-log.js  events.js
	            library-json.js  library-changes.js  lan-access.js  remote-routes.js  access-control.js  access-routes.js
public/
	index.html  selector.html  initializer.html  waiting.html  connect.html  favicon.svg
	vendor/     tailwindcss-browser-<version>.js  tailwindcss-browser.LICENSE   (excluded from lint and type-checking)
	app/
		main.js  browser-clock.js       composition root and the browser Clock
		connect.js                      the connect page's script (§9.16)
		selector.js  initializer.js     the startup pages' scripts (§9.18, §9.19)
		logic/                          no DOM, audio or Node APIs
			ports.js  soundboard.js  commands.js  errors.js  event-emitter.js  library-model.js
			playlist-player.js  playback-rules.js  transitions.js  order-strategies.js  play-history.js  problem-list.js
			sound-player.js  buffer-cache.js  clip.js  volume.js  settings-sync.js  options-sync.js  sort.js
			voice-monitor.js  fade-ramp.js  peaks.js  waveform-service.js  remote-state.js  remote-controller.js
			access-requester.js  qr-code.js  startup-flow.js
		audio/      web-audio-engine.js  web-audio-waveform-decoder.js
		api/        backend-api.js  server-events.js  startup-api.js
		ui/         app.js  component.js  dom.js  icons.js  format.js  menus.js  position.js  external-changes-button.js
		            splash.js  overlay.js  context-menu.js  track-list.js  tile-grid.js
		            playlist-tile.js  sound-tile.js  player-dock.js  player-bar.js  level-bar.js  panic-button.js  volume-controls.js
		            dialog.js  customize-parts.js  filled-field.js  sound-editor.js  playlist-editor.js  track-accordion.js
		            gain-control.js  gain-scale.js  debug-view.js  waveform-indicator.js  waveform-draw.js  waveform-canvas.js
		            seconds-control.js  seconds-scale.js  range-control.js  range-scale.js  add-dialog.js  download-dialog.js
		            hold-button.js  replace-host-dialog.js  remote-view.js  move-dialog.js  trash-button.js  trash-dialog.js  metadata-dialog.js  source-fields.js  problems-button.js  problems-dialog.js
		            access-requests-banner.js  connect-phone-dialog.js  info-dialog.js  startup-parts.js
test/
	backend/    cli/  downloads/  http/  library/  metadata/  remote/  startup/
	frontend/   logic tests, backend-api.test.js, ui/ (pure UI helpers)
	browser/    Playwright suite (§11): playwright.config.js, support/ (fixtures, server, test-main, audio, disk, app), pages/, specs/
	helpers/    fake-audio-engine.js  fake-clock.js  fake-backend-api.js  fake-prompter.js  fake-reporter.js  fake-process-runner.js
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
| Browser tests (`tsconfig.browser-tests.json`) | `test/browser/**` except `support/test-main.js` | Node and DOM (the callbacks given to `page.evaluate` run in the page). `test-main.js` runs only in the browser, where its imports resolve, and is left out. |

ESLint backs this up with `no-restricted-globals` in `public/app/logic/**`.

### 10.2 Scripts

| Script | Runs |
|---|---|
| `npm start -- <dir>` | `node index.js <dir>` |
| `npm run dev -- <dir>` | `node --watch index.js <dir>` |
| `npm test` | `node --test` over `test/backend`, `test/frontend` and `test/helpers` |
| `npm run test:browser` | `playwright test -c test/browser/playwright.config.js`; needs the Playwright browsers and is not part of `check` |
| `npm run typecheck` | `tsc -p` for every project in §10.1 |
| `npm run lint` / `npm run lint:fix` | `eslint .` / `eslint . --fix` |
| `npm run check` | typecheck + lint + test; must pass before every commit (the browser tests are run separately) |

---

## 11. Testing

Logic and backend code are developed test-first and covered by automated tests that run in Node, against fakes for the audio engine, clock, backend and terminal. The DOM layer is covered by Playwright specs (`test/browser/`) that drive the real page against the real server in Chromium. They replace only sound and time: `support/test-main.js`, served in place of `public/app/main.js`, is the composition root of §6 with `FakeAudioEngine`, `FakeClock` and a fake waveform decoder from `test/helpers/`, so a test moves time with `audio.advance(ms)` and never waits for real audio. The app code itself has no test hooks. Specs are written against page objects (`splash`, `playlists`, `sounds`, `footer`, `header`, the dialogs) and a few fixtures (`soundboard`, `library`, `audio`, `disk`), so they read as a list of what a person does and sees. `WebAudioEngine` stays thin and is checked by hand in real browsers. What each suite covers, how the fakes and fixtures work, and the manual checklist are in [`TESTING.md`](TESTING.md).

---

## 12. Target machine: MacBook Neo, 8 GB RAM

The streaming design keeps resource use well within what this machine can handle.

**Memory (expected total under about 200 MB for the browser tab, a few tens of MB for Node):**
- Node holds only the file index and settings. Files are streamed from disk in chunks.
- A download needs disk space in the root: the downloaded file, plus its converted copy while `ffmpeg` runs. Both go to disk, never into memory, and the work folder is emptied after each job (§5.4).
- Each streamed track (a media element) buffers only a few MB ahead. With, say, 6 playlists, the 24 streamed-sound cap and a few retiring voices, that is well under 200 MB in the worst case.
- Decoded sound effects are capped at 64 MB (§7).
- Waveform generation decodes one file at a time at 8 kHz (about 10 MB for a 5-minute stereo track) and drops it before the next (§6.6). Stored waveforms are 2 KB each.
- The real goal is that the tab never grows over a 4-hour session. That is why voices release their resources on `stop()` (§6.3) and retiring voices have deadlines (§8).

**CPU and battery:**
- Decoding is done by the browser's native code. Mixing a handful of streams through Web Audio costs very little.
- No `requestAnimationFrame` loops. Progress updates run at 4 Hz, only while a playlist is playing, and only change inline styles and text (§9.6).

**Safari specifics:**
- Range requests (§5.2), the splash unlock (§9.0) and same-origin media are covered above.
- **Safari is assumed to play Ogg and Ogg Opus.** The Safari version that matters (on the MacBook) supports both, so `.ogg` and `.opus` are first-class formats, and downloads are stored as `.opus` (copied) or `.ogg` (converted). An older Safari without Ogg support still gets disabled tiles rather than silent failures (§9.5).
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
