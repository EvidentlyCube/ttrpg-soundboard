# Soundboard — Roadmap

Planned features and feature proposals. [`DESIGN.md`](DESIGN.md) describes the app as it is; this file describes where it is going.

## How a feature goes from idea to code

1. **Proposal.** The feature gets a section under [Proposals](#proposals): what it does, how it changes the design (naming the `DESIGN.md` sections affected), open questions, and a step-by-step implementation plan.
2. **Review.** The project owner reviews the proposal and answers its open questions. Work starts only once it is approved.
3. **Implementation.** One step at a time, test-first, one commit per step, each passing `npm run check`.
4. **Design update.** `DESIGN.md` is updated to describe the new behavior, in its own commit, reviewed like any design change. The proposal is then removed from this file, and its backlog entry too, if it had one.

### Proposal template

```markdown
### <Feature name>

**Goal.** What the user can do afterwards, in a few sentences.

**Design changes.** What changes, section by section of DESIGN.md (§n.n).

**Open questions.** Decisions the owner needs to make, each with a recommended answer.

**Plan.**
1. <step> — <what is tested>
2. …
```

---

## Proposals

### Starting from the browser: Selector, Initializer, Soundboard

**Goal.** The terminal no longer asks anything. Everything about choosing and loading a soundboard happens in the browser, in three phases:
1. **Selector.** Choose the folder: from the last 5 used, by clicking through the folders, or, when the app was started with paths, from those paths only. The footer shows the state of yt-dlp and ffmpeg.
2. **Initializer.** Loads the chosen folder and asks the startup questions (nested folders, metadata titles, a very large folder) with Yes and No. Files it can't load are shown, with a held button that deletes them and starts anyway. When nothing is left to decide, it moves on by itself.
3. **Soundboard.** The app as it is today.

The app always starts in the Selector, even with a single path given, because the Selector is where startup settings (such as turning on LAN access) can go later. Someone who doesn't use a terminal can double-click a launcher: the app opens the browser itself.

Browsers never tell a page the real path of a folder the user picks (`showDirectoryPicker()` and `<input webkitdirectory>` hide it), so the server lists the folders and the page only shows them.

**Design changes.**
- §1: the usage line becomes `node index.js [<audio-directory>…] [--port <number>] [--lan [<address>]] [--UNSAFE-lan-manager] [--whitelisted-root <path>]… [--allow-hidden] [--no-open] [--verbose]`. `--whitelisted-root` (repeatable) and `--allow-hidden` are described in §5.7. `--UNSAFE-lan-manager` implies `--lan` and lets any device on the network use the Selector and the Initializer without pairing (§1.1); the terminal prints a yellow warning saying so. The default port changes from `3000` to `13872`, which is unlikely to clash with development servers; `--port` still sets another. When the port is taken, the app tries the next nine in turn and prints in yellow which one it used. At startup the app prints `Soundboard running at http://localhost:13872` and opens it in the default browser (`open` on macOS, `cmd /c start "" <url>` on Windows, `xdg-open` elsewhere; a failure is ignored, since the line is printed anyway). `--no-open` turns that off. The terminal shows the URL, the tools lines, errors, the LAN lines, `--verbose` request logs and the stop hint; typing `exit` still stops the app. "It is always started by hand from a terminal" goes: double-clicking a launcher opens a terminal window, which stays the window that runs the app and stops it when closed.
- §1.1 Trust: the Selector can list any folder on this machine, and the Initializer can delete files, so both are answered only to this machine, unless `--UNSAFE-lan-manager` is given. Then other devices get them too, with no pairing, and can browse the allowed folders (§5.7), open soundboards and delete broken options files. With `--lan` alone, other devices can do nothing until the phase is `ready`: pages get `waiting.html`, and every route, pairing included, answers `503`. When the phase leaves `ready` (Change soundboard, below), every device is disconnected at once: its event streams are closed, its approval is forgotten (§5.6), and it has to pair again once the next soundboard is ready. Bans stay until the server restarts.
- §1, §5.2 the URL: the app prints and opens `localhost` rather than `127.0.0.1`. It still listens on `127.0.0.1`; a browser that tries `::1` first falls back to it. `*.localhost` names were tried and don't work in Safari.
- §3 becomes **Startup**. The server has a **phase**, `selecting` → `initializing` → `ready`, held by a `StartupSession` (`src/startup/startup-session.js`).
  - The bootstrap (`BootstrapService`) keeps its decisions. `TerminalPrompter` and `ConsoleReporter` go; the session is the `Prompter` and the `Reporter`, and keeps what they receive as structured state for the page.
  - Information that needs no decision (unsupported files, orphan options files, symbolic links, empty playlists) is not shown in the Initializer. It already becomes problems in the Problems dialog (§5.1, §9.14).
  - A new question, **large folder**: when a folder without `.soundboard` holds more than 5,000 audio files (counting stops at 5,001), the Initializer asks before the first run writes an options file next to each.
  - A new `Reporter` call, `measured(done, total)`, so the Initializer can show "Measuring durations: 120 of 450".
  - **Failures.** Validation errors (§2.3) and a folder that can't be read put the Initializer into `failed`, listing each file and its error. It offers **Back** (to the Selector), **Try again** (after fixing the files by hand) and, for files that fail validation, a `holdButton` (§9.7, 1 s) **Hold to delete these files and start**. That deletes exactly the listed options files and `.soundboard` (never an audio file), then runs the bootstrap again. Without `.soundboard`, that is a first run, with its questions.
  - A **No** goes back to the Selector, writing nothing, as the terminal's No exits today.
  - `ready` is reached once the bootstrap is done **and** the tools are ready (below).
- §3.4: the tools (`findTools`, `yt-dlp -U`) start when the server starts, not after the bootstrap, so they run while the Selector is open. The "initializing" state of the server (§5.2) and `public/initializing.html` go: the Initializer waits for the tools and shows "Waiting for the yt-dlp update…" when the bootstrap finishes first.
- §5.2:
  - **What `/` serves follows the phase:** `selector.html`, `initializer.html` or `index.html` on this machine. Another device gets `waiting.html` ("Waiting for the soundboard to start") until `ready`, polling `GET /api/startup/ready` (the one route it may use) and reloading then.
  - Until `ready`, the app's routes answer `503 { "error": "No soundboard is loaded." }`. `/api/info` is answered in every phase, with each tool as `{ state: 'checking' | 'ready', … }`.
  - New routes, each answered only in its phase (`409` otherwise):
    - `GET /api/startup`: `{ phase, paths, recent, initializer }`. `paths` are the paths given on the command line, each with `allowed` and the reason when it isn't. `initializer` holds the step (`scanning`, `question`, `measuring`, `waitingForTools`, `failed`), the question with its data (the nested folders, the titles, the file count), the progress and the failures.
    - `GET /api/startup/folders?path=<absolute path>`: `{ path, parent, folders: [{ name, path, soundboard, refused }], audioFiles, soundboard, allowed, reason }`. Hidden folders (a leading `.`) are left out unless `--allow-hidden`. `soundboard` is whether a folder holds `.soundboard`, one `stat` per subfolder. A folder outside the allowed roots, or a hidden one, answers `403` with the reason (§5.7), so typing such a path or going Up from a root gets feedback and the browser stays where it was. Without `path`, the starting places: each allowed root, and the home folder's Music, Desktop, Documents and Downloads folders when they exist and are allowed. `403` when paths were given on the command line.
    - `POST /api/startup/select { path }`, `POST /api/startup/answer { id, yes }`, `POST /api/startup/back`, `POST /api/startup/retry`, `POST /api/startup/delete-and-retry`, `DELETE /api/startup/recent { path }`.
    - `POST /api/startup/close`, answered in `ready` only: stops the change watcher, cancels running downloads, drops the library, disconnects the devices (§1.1) and goes back to `selecting`. Every page's event stream gets `startup.closed` before it closes, and the pages load `/` again.
  - Pages poll `GET /api/startup` every 500 ms, like the initializing page today. The event stream stays the board's.
- New §5.7 **Folder rules** (`src/startup/folder-rules.js`), checked by the server for every folder browsed or selected, whether browsed, recent or given on the command line. Each path is checked after resolving symbolic links, so a link can't lead out of the allowed folders; a folder that passes is opened by its resolved path.
  - **Allowed roots.** Only folders inside a root may be browsed or opened. By default the only root is the home folder. Each `--whitelisted-root <path>` adds one, and giving any replaces the home folder; `%home%` (any case) in the path stands for the home folder, so `--whitelisted-root %home% --whitelisted-root /mnt/sounds` keeps it. The terminal prints the roots at startup.
  - **Hidden folders.** A folder whose path, below its root, has any part starting with a dot can't be browsed or opened, unless `--allow-hidden` is given. A root that is hidden itself is allowed, since it was named on purpose.
  - **Refused, with the folder and everything inside it:** the system folders: `/bin`, `/boot`, `/dev`, `/etc`, `/lib`, `/lib32`, `/lib64`, `/proc`, `/root`, `/run`, `/sbin`, `/snap`, `/srv`, `/sys`, `/usr`, `/var`, and on macOS `/System`, `/Library`, `/Applications`, `/private`, `/cores`; on Windows `<drive>:\Windows`, `Program Files`, `Program Files (x86)`, `ProgramData`, and `AppData` in the profile.
  - **Refused, only the folder itself:** `/`, every drive root (`C:\`), the folders that only hold other places (`/home`, `/Users`, `/Volumes`, `/media`, `/mnt`, `<drive>:\Users`), and the home folder.
  - **Refused, doesn't look like a soundboard:** no `.soundboard`, and no audio file within two levels (the folder and its direct subfolders).
  - The system folders stay refused even inside a root, for instance with `--whitelisted-root /`.
  - The reason is shown in the Selector: "This folder is outside the folders the app may open.", "Hidden folders can't be used.", "System folders can't be used.", "Choose a folder inside this one.", "No audio files found here.". A refused path typed into the path field, or reached with Up, shows the reason as an error and puts the field back to the folder being shown.
  - The soundboard itself already ignores every file and folder whose name starts with a dot (§2.1), apart from its own `.trash` and `.soundboard-downloads`.
- New §5.8 **Recent folders** (`src/startup/recent-folders.js`): the last 5 folders that reached `ready`, newest first, in `recent.json` in the user's config folder: `%APPDATA%\Soundboard` on Windows, `~/Library/Application Support/Soundboard` on macOS, `$XDG_CONFIG_HOME/soundboard` or `~/.config/soundboard` elsewhere. It is the first file the app writes outside the audio folder. A folder that no longer exists is shown greyed out, with a × to forget it like any other. A broken file counts as an empty list.
- New §9.18 **Selector** (`public/selector.html`, `ui/` and `logic/selector-flow.js`, tested with fakes like `AccessRequester`, §9.16):
  - **With paths from the command line:** one card per path (name over the full path); the refused ones are greyed out with their reason under the path and as the card's `title`. Nothing else to choose from.
  - **Otherwise: recent folders** as the same cards, each with a ×, and **a folder browser** with a path field you can paste into, **Up**, the starting places as buttons, and the current folder's subfolders, with soundboard folders marked and refused ones greyed out, their reason as the `title`. Under it, a summary line for the current folder: "Soundboard folder", "No soundboard here yet: 3 folders, 12 audio files", or the reason it is refused. The button reads **Open** for a soundboard folder and **Create soundboard here** otherwise.
  - **Footer:** yt-dlp and ffmpeg, each "Checking…", its version, or "Not installed" in yellow, and "Updated" or "Update failed" for yt-dlp, as the Info dialog shows it (§9.17).
  - **Extension point:** a "Start options" area for settings such as LAN access, added by later proposals.
- New §9.19 **Initializer** (`public/initializer.html`, `logic/initializer-flow.js`): the folder's path, then the current step. A question shows its list (the nested folders in red, the `path → "Title"` pairs, the file count) and **Yes** / **No**. Measuring shows a progress bar. `failed` lists the files with their errors and the three buttons. On `ready` it loads `/`.
- §9.3: the ☰ menu gets **Change soundboard**, which stops all playback and calls `POST /api/startup/close`. A remote page shows "The soundboard was closed" instead of reconnecting.
- §5.6: `AccessControl` gets `revokeAll()`, which forgets every approval and pending request but keeps the bans.
- §9.0: "The audio folder needs a restart" stays as it is. Going back to the Initializer instead is left for later.
- §10, §10.1: `src/startup/`, the new pages and their scripts.

**Decided.**
- No `--enable-lan-init`: the Selector and Initializer are never answered to other devices, and devices can connect only once a soundboard is ready (§1.1 above).
- The browser always opens, with `--no-open` to turn it off.
- The URL is `http://localhost:<port>`, default port `13872`.
- A path from the command line that doesn't exist or is refused appears greyed out in the Selector, with its reason under the path and as the `title`, rather than stopping the app. A malformed command line (an unknown option, a bad port) still stops the app in the terminal.

**Plan.**
1. `folder-rules.js`: the refused folders per platform (paths passed in, so every platform is tested anywhere), the two-level audio check, the 5,000-file count.
2. `recent-folders.js` and the folder listing (`folders.js`): config folder per platform, adding, forgetting, missing folders, a broken file; starting places, hidden folders, soundboard marks.
3. Bootstrap: the large-folder question, `measured`, deleting the failed files and running again.
4. `StartupSession`: the phases, the session as `Prompter` and `Reporter`, Back, Try again, delete and retry, No, waiting for the tools, recording the recent folder.
5. Server and CLI: phase-dependent pages and `503`s, devices refused until `ready`, the startup routes, tools at server start, `waiting.html`, closing a soundboard (`revokeAll`, closed streams, cancelled downloads), the arguments, the new default port, the `localhost` URL, `--no-open` and `openBrowser`, the trimmed terminal output; `TerminalPrompter`, `ConsoleReporter` and `initializing.html` removed.
6. Pages: the Selector, the Initializer and their flows, Change soundboard in the ☰ menu, the remote's "closed" state.
7. Tests for the parts above, `TESTING.md` (opening the browser and the starting places on each platform, the handover to the board, a phone being disconnected by Change soundboard), then `DESIGN.md`.

---


## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

In the owner's order: work from the top. Each entry becomes a proposal (above) before any code is written.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

### Basic mobile design

Make the page usable on a phone or tablet.

- **Changes:** DESIGN.md §1.1 currently targets desktop browsers only, with "no special handling" for touch, and §9 lays the page out for a laptop screen.
- **Notes:**
  - The header's three volume controls collapse into a hamburger menu on narrow screens. Today they have a fixed width and make the page scroll sideways below about 1030 px, which also affects a narrow desktop window.
  - The footer's three bars per row, the tile grid and the dialogs need narrow layouts.
  - Audio unlocking and playback in Safari on iOS need checking.
  - Context menus get **no** touch gesture: long press stays unused (see "Decided against").
  - The remote page is described in DESIGN.md §9.15.

### Browser test coverage still to write

What the Playwright suite (`test/browser/`) does not check yet, collected when the first suite was finished. It covers the splash, playing and controlling playlists and sounds, errors, a suspended system, the tile menus (instant items, Reset, Stop All), what a stopped playlist remembers, repeating, Previous, seeking while paused and the time formats, the sound and playlist Customize dialogs, the Tracks tab (opening, renaming, volume, cropping, playing and seeking a track, deleting, moving, failed saves), the Move dialog (sounds and tracks, name clashes, failures), the Metadata dialog (rows, rebuilt YouTube links, n/a, non-http links), regenerating and failing waveforms, a failed refresh and the rest of the external changes, a failed start, the empty library line, the debug view and the context menu closing, the random, shuffle and crossfade playback, the track list, the footer layout and the sound instance limits, the Add and Download dialogs with fake yt-dlp and ffmpeg (lookups, chapters, playlists, progress, cancelling, failures, tracks added to a playlist), the waveform canvases being painted, the whole trash (listing, restoring playlists, tracks and sounds, Restore all, Delete all, errors, deleting what plays) (title, volume, start and end points with their handles and fields, fades, order, repeat, when stopped, crossfade, saving, the volume widget, and a sound that is already playing), external changes, the header volumes, the waveform indicator and the basics of the trash. Everything below is open. Each group is a candidate for its own proposal. The part that only a real browser can check stays in the manual checklist ([`TESTING.md`](TESTING.md)), and so does `WebAudioEngine`.

- **Keyboard seeking.** The progress bar has no keyboard seeking today; decide whether it should get one before testing it.
- **The suite itself.**
  - Firefox and WebKit projects in `playwright.config.js`, at least for layout checks. The browsers installed here are for an older Playwright than `@playwright/test` 1.64.1 (it wants `firefox-1555` and `webkit-2370`), so run `npx playwright install firefox webkit` first; the projects were not added since they could not be run.
  - Narrow-window layouts, once "Basic mobile design" is done.
  - Whether `finishWaveforms()` and the other real-time waits can be made deterministic.

### Switching scenes

Changing the mood in one action instead of stopping one playlist and starting another by hand. For example, starting a playlist fades out the others in its group, or a saved scene stores a set of playlists and volumes.

- **Notes:** write the proposal at the end, once Panic Stop and Live volume exist, since both are building blocks (a fade of everything, a temporary volume per playlist).

### Sound variants

For future consideration: a sound that picks one of several files at random on each press (a sword hit with five takes), and a per-sound choice of what a second press does (overlap, restart, or stop).

- **Seam:** `SoundPlayer` starts a new instance on every press (DESIGN.md §7).

### Preloading the next track

Load the next track shortly before the current one ends, for gapless changes.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8); crossfades already start the next voice early (§8.4). From localhost a track loads in milliseconds, so measure the gap before proposing it.

### Editing where files came from

The metadata dialog (DESIGN.md §9.13) shows each file's `source` read-only. The owner wants to edit it later.

- **Seam:** the dialog's rows come from one list of fields (`ui/source-fields.js`), each naming its source key, so each can become a field. `"edited"` is already reserved as the `origin` of a source typed in by hand (§2.3). The save would go through `LibraryEditor` and a `PATCH`, as the other options do (§5.1, §5.2).

---

## Decided against

Not planned, so a later review doesn't propose them again.

- **Search, filter and keyboard shortcuts.**
- **Context menus on touch screens**, including a long-press gesture.
- **Narration ducking**, a toggle that lowers the music.
- **Sound grouping** into sections.
- **Loudness matching** of files.
- **Importing local files** from the page. Files are added by copying them into the folder, which the external changes button picks up (DESIGN.md §5.3), or by downloading.
- **A warning when two tabs play at once.**
- **Media element reuse for Safari.** New media elements are assumed to play once the audio context has been unlocked (DESIGN.md §12).
- **More saved preferences** as a feature of its own. A preference is proposed together with the feature that needs it.
