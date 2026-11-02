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

### Starting without a folder

**Goal.** Someone who doesn't use a terminal can start the app by double-clicking it. Started without an audio folder, the app opens the browser on a **start page**, where they pick the folder by clicking through their folders or from a list of recent ones. The questions the terminal asks today (nested folders, metadata titles) are asked on that page too. Once the folder is loaded, the page turns into the usual app. Starting with a folder works exactly as today.

Browsers never tell a page the real path of a folder the user picks (`showDirectoryPicker()` and `<input webkitdirectory>` hide it), so the server lists the folders and the page only shows them.

**Design changes.**
- §1: the usage line becomes `node index.js [<audio-directory>] [--port <number>] [--lan [<address>]] [--no-open] [--verbose]`. Without a directory, the app prints `Choose a folder at http://127.0.0.1:3000` and opens that URL in the default browser (`open` on macOS, `cmd /c start "" <url>` on Windows, `xdg-open` elsewhere; a failure is ignored, since the line is printed anyway). `--no-open` turns that off. "It is always started by hand from a terminal" changes: double-clicking a launcher still opens a terminal window, which stays the window that runs the app and stops it when closed.
- §1.1 Trust: the folder list shows the names of any folder on this machine, so the start page and its routes are only ever served on loopback, even with `--lan`, and only until a folder is loaded.
- §3: the bootstrap is unchanged, but the start page provides a second `Prompter` and `Reporter`. The page reporter keeps what the terminal prints as structured entries (warnings, nested folders, titles, counts) instead of text, so the page can show them as lists. The terminal still prints everything as well.
- §3.1 step 1: a missing directory is no longer a usage error.
- New §3.7 **Starting without a folder.** `main.js` starts a small **start server** (`src/http/start-server.js`) on the app's port, with the request guard and static files but none of the app's routes. A `StartSession` (`src/startup/start-session.js`) moves through `choosing` → `loading` (the bootstrap runs, asking its questions through the page) → done. A validation error, a "No" or a folder that can't be read goes back to `choosing` with the log still shown, instead of ending the process. When the bootstrap succeeds, the start server closes and the usual server starts on the same port (§3.4), so the page keeps its URL and origin.
- §5.2, the start server's routes:
  - `GET /api/start`: the session's state, `{ state, log, question, folder }`; `question` is `{ id, text }` while one waits.
  - `GET /api/start/folders?path=<absolute path>`: `{ path, parent, folders: [{ name, path, soundboard }], audioFiles, soundboard }`. Hidden folders (a leading `.`) are left out. `soundboard` is whether the folder has a `.soundboard` (one `stat` per subfolder). Without `path`: the starting places, with the home folder, its Music, Desktop and Documents folders when they exist, the drives on Windows (`C:\` and the others), `/Volumes/*` on macOS, `/media/<user>/*` and `/mnt/*` on Linux, and `/`.
  - `POST /api/start/folder { path }`: starts the bootstrap. `409` unless `choosing`, `400` for a path that isn't an absolute path to a directory.
  - `POST /api/start/answer { id, yes }`: answers the waiting question.
- New §5.7 **Recent folders** (`src/startup/recent-folders.js`): the last 5 folders the app loaded, with or without the start page, newest first, in `recent.json` in the user's config folder: `%APPDATA%\Soundboard` on Windows, `~/Library/Application Support/Soundboard` on macOS, `$XDG_CONFIG_HOME/soundboard` or `~/.config/soundboard` elsewhere. This is the first file the app writes outside the audio folder. A folder that no longer exists is dropped when the list is read. A broken file counts as an empty list.
- New §9.18 **Start page** (`public/start.html`, `public/app/start.js`; logic in `logic/start-flow.js` with a `StartApi` and a `Clock`, like `AccessRequester`, §9.16). It polls `GET /api/start` every 500 ms. It shows:
  - **Recent folders**, as cards with the folder name over the full path, and a × to forget one. A click loads it.
  - **A folder browser:** a path field you can paste into, Up, the starting places as buttons, and the current folder's subfolders, with soundboard folders marked. Under it, a summary line for the current folder: "Soundboard folder", or "No soundboard here yet: 3 folders, 12 audio files". The button reads **Open** for a soundboard folder and **Create soundboard here** otherwise, because a first run writes an options file next to every audio file.
  - **While loading:** the log, plus the waiting question with **Yes** and **No**.
  - **The handover:** once the start server is gone, any answer that isn't a start state (the next server answers `503` while initializing) sends the page to `/`, which shows the initializing page and then the app.
- §10: `src/startup/`, `public/start.html`, the new `public/app/` files.

**Open questions.**

A. **Where the bootstrap questions are asked.** *(Recommended)* On the start page, as described, when the app was started without a folder. With a folder given, they stay in the terminal. The alternative is to keep them in the terminal always, which is less work but makes a double-clicking user look for a terminal window.

B. **Two servers or one.** *(Recommended)* A separate start server, closed before the usual one starts. The usual server keeps its rule that it always has a library, and the folder routes can't leak into it. The cost is a moment when the port is free, which another program could take; then the app prints the usual "port in use" error and exits. The alternative is a `choosing` phase in the usual server, like the initializing one (§5.2). That is also the way to switching folders from the ☰ menu later, which this proposal leaves out.

C. **Opening the browser when a folder is given.** *(Recommended)* No: only without a folder, so a terminal user's habits don't change. `--no-open` only matters in the no-folder case. The alternative is to always open it, with `--no-open` for both.

D. **Recent folders.** *(Recommended)* Remembered as described, never opened by themselves. The page always waits for a click, so a removed drive or a wrong folder never starts a scan.

E. **A first run from the page.** *(Recommended)* No extra question: the **Create soundboard here** label and the summary line say what will happen. The alternative is a confirmation dialog that names the number of files that will get an options file. That would protect against picking a large folder, such as the home folder, by mistake.

F. **A nicer URL.** Chrome, Firefox and Edge send every `*.localhost` name to this machine by themselves, so `http://soundboard.localhost:3000` would work there with only the request guard's names extended (§5.2). Safari is the likely browser on the MacBook (§12), and I'm not sure it does. *(Recommended)* Keep `127.0.0.1` for now, and add `soundboard.localhost` as the printed and opened address only if a quick test in Safari works. Getting rid of `:3000` would need port 80, which needs root on Linux and often clashes with other programs, so I don't suggest it.

**Plan.**
1. Arguments: the optional directory and `--no-open`; `openBrowser(url)` in `src/cli/`, run through an injected function so tests don't open anything.
2. `src/startup/recent-folders.js`: reading, adding, forgetting, the config folder per platform, a broken file.
3. `src/startup/folders.js`: the starting places and a folder's listing, with hidden folders and the soundboard marks.
4. `StartSession`: the states, the page `Prompter` and `Reporter`, going back to `choosing` on a failure or a "No".
5. The start server and its routes, and the wiring in `main.js`: choose, bootstrap, close, start the usual server on the same port, remember the folder.
6. The start page and `logic/start-flow.js`.
7. Tests for the parts above, `TESTING.md` (opening the browser and the drives on each platform, the handover), then `DESIGN.md`.

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
