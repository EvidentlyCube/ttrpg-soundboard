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

### Rescanning while running

**Goal.** While the app runs, the server watches the audio directory. When files are added, removed or changed from outside the app, a yellow **External Changes – Refresh** button appears in the header. Clicking it makes the server rebuild everything as if it had just been started, then reloads the page, which shows the new library. The user decides when; nothing changes under a running session by itself. The page holds no state worth keeping across a reload (§1, §9.0), so a full reload is the simplest correct way to pick up any change.

**Design changes.**
- **§3 Bootstrap, new §3.6 "Refresh".** Replace the §3.4 extension point note. A refresh runs `BootstrapService` again in later-run mode (§3.3), with the same `Reporter` (its output goes to the terminal, as at startup) and no questions. Differences from a start:
  - *Validation errors* (§2.3) don't exit. The refresh fails, nothing is replaced, and the errors go back to the page.
  - *No `.soundboard`* would make it a first run, which asks questions; the refresh fails with "Restart the app" instead.
  - *New nested subdirectories* are merged into their playlists without asking, but **not recorded** in `includedSubdirectories`, and a playlist options file created by the refresh doesn't list them either. The next start from the terminal therefore still asks about them and records the answer (§3.3 step 5).
  - *Orphaned files* get the usual warnings in the terminal and nothing else.
  - On success the new `Library` and `SettingsStore` replace the old ones (below), and a new file baseline is taken.
- **§5.1, new "Change watcher" (`src/library/change-watcher.js`).** Decides whether the directory differs from what the app last loaded.
  - *Baseline.* At the end of bootstrap: every file the scanner uses (§2.1: audio files, options files, `.soundboard`) with its size, modified time and SHA-1. Audio files take the SHA-1 already stored in `measuredFrom` (§3.5), so building the baseline reads no audio; the small `.json` files are hashed.
  - *Watching.* `fs.watch(root, { recursive: true })` (built in, works on Linux and macOS in Node 24) only says that something changed. After 1 s without further events, the watcher scans the tree again (listings and dates only, as the scanner always does) and compares it with the baseline:
    - a file the scanner would use (§2.1) that is not in the baseline: **change**;
    - a baseline file that is gone: **change**;
    - a baseline file with the same size and modified time: no change; otherwise hash it, and a different SHA-1 is a **change** (a merely touched or copied file is not).
    - Everything the scanner ignores is ignored here too: dot files (except `.soundboard`), `.wf` and `.tmp` files, unsupported audio, orphan `.json` files, empty directories, symlinks.
  - *Quick checks.* The page asks for a check whenever it gets the focus back (another window or tab was in front), and the watcher checks every 30 s if `fs.watch` fails or reports an error (for example the Linux inotify limit). These checks compare **size and modified time only** and never hash, so a merely touched file counts as a change there.
  - *Once a change is found* the watcher sets `externalChanges = true`, announces it, and stops checking until the next refresh. A half-copied file therefore costs at most one hash; whatever it looks like at refresh time is what bootstrap reads, and if it is still growing the next check after the refresh finds it changed again.
  - *Own writes.* `LibraryEditor` and `SettingsStore` save through the watcher, which records the new size, modified time and SHA-1 of the file once it is written. Checks and own writes take turns, so the app's own saves are never external changes. Bootstrap's writes happen before the baseline is taken.
  - *Missed events.* The baseline is taken after bootstrap, and its audio files are compared with the ones bootstrap scanned, which covers changes made while bootstrap ran.
- **§5.1, replacing the library.** The router, `LibraryEditor` and `WaveformStore` hold the `Library` and `SettingsStore` today. They get them from a holder (`AppState`) that a refresh swaps. The refresh and the writing requests (`PATCH`, `PUT`) take turns through one lock, so a save is never lost between the rebuild reading a file and the swap. A second refresh request while one runs waits for it and gets its result.
- **§5.2 HTTP API.**
  - `GET /api/events`: a server-sent event stream (`text/event-stream`, plain `node:http`). On connect it sends the current state, `{ "externalChanges": false }` or `true`, and again whenever changes are found. A comment line every 30 s keeps the connection open. The server closes the streams on shutdown, like media streams (§5.2).
  - `POST /api/changes/check`: no body. Runs a quick check (size and modified time) and returns `200 { externalChanges }`.
  - `POST /api/refresh`: no body. `200 {}` once the rebuild has finished. `422 { error, errors: [{ path, message }] }` for validation errors. `503 { error }` when `.soundboard` is gone.
- **§6, §6.1, §6.2.** A new port, `ServerEvents` (`api/server-events.js` over `EventSource`, which reconnects by itself; a fake for tests), and `BackendApi.checkExternalChanges()` and `refresh()`. The facade:
  - emits `library.externalChanges { pending }` when the server reports changes;
  - `checkExternalChanges()` asks the server for a quick check; the UI calls it when the window gets the focus back or the tab becomes visible again;
  - `refreshLibrary()` flushes every pending save and **waits for them to finish** first, so the rebuild reads the user's latest edits, then calls the server. It emits `library.refreshing {}`, then `library.refreshed {}` or `library.refreshFailed { message, errors }`.
  - The UI reloads the page on `library.refreshed` (logic never touches `window`). After the reload the splash asks for a click again, because the browser needs a gesture to start audio (§9.0).
- **§9.1 Layout, new §9.x.** The yellow **External Changes – Refresh** button sits in the header, left of the waveform indicator, and is shown only while the server reports changes. While refreshing it is disabled and reads "Refreshing…". Validation errors open a dialog listing each file and problem; the button stays so the user can retry after fixing them. A missing `.soundboard` shows a blocking message: "The audio directory was reset. Restart the app."
- **TESTING.md.** Manual checks: copy a large file in and click Refresh during and after the copy; replace a file with the same content (no button); delete a file; change a file while another window has the focus, then come back (the button appears without waiting); edit an options file by hand; save options in the dialog (no button); add a nested directory, refresh, then restart (the terminal asks); delete `.soundboard`.

**Decided.**
- Server-sent events for the push channel; Node's built-in `fs.watch` for watching, with no vendored watcher.
- Deleted files count as changes.
- New nested directories are merged by a refresh without asking and without being recorded; the next terminal start asks and records.
- Only one tab is ever used, so other tabs get no special handling.
- A refresh ignores orphaned files beyond the usual warnings; a normal start treats them as it does today.

**Plan.**
Implemented in one go (lean flow): the code first, then the owner checks it in the browser, then tests and `DESIGN.md` in one sweep.
1. Tree snapshot and baseline: compare with and without hashing (new, gone, same size and time, same or different hash).
2. `ChangeWatcher`: watcher and timers injected, 1 s quiet period, quick checks, 30 s fallback, own writes, the startup comparison.
3. The refresh through `BootstrapService`, the swap in the server and the waiting requests.
4. `GET /api/events`, `POST /api/changes/check`, `POST /api/refresh`.
5. Frontend: `ServerEvents` port, `BackendApi`, the facade's check, flush-then-refresh and events.
6. UI: the header button, the focus check, the error dialog, the blocking message, the reload.
7. Tests for 1–5, manual checks in `TESTING.md`, `DESIGN.md`, and removing this proposal and its backlog entry.

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

### Planned, in the owner's order

No planned features are left. The next step is the section "Finally: design the remaining features" below.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

### Later, unordered

#### Rescanning while running

Pick up added or removed files without restarting, by a button or by watching the directory.

- **Seam:** `BootstrapService` and the scanner are reusable; the page reloads the library through `/api/library`.
- **Notes:** the nested-directory and metadata questions currently happen in the terminal; while running they would need an answer from the UI or a non-interactive rule.

#### LAN access and phone remote control

Open the app on a phone on the same network to choose what plays, while the PC does the playing.

- **Seam:** commands and events are plain serializable objects and every command goes through `dispatch()`, which validates it (DESIGN.md §6). The server holds no playback state.
- **Notes:** would add a `--host` option, a `GET /api/events` stream (server-sent events) and a `POST /api/commands` relay, plus a "player" and "remote" role for pages.

#### Search, filter and keyboard shortcuts

- **Seam:** UI only, built on the existing facade.

#### More saved preferences

- **Seam:** `.soundboard` settings, `SettingsStore` and the `/api/settings` endpoints (DESIGN.md §2.3, §5.2).

#### Context menus on touch screens

Long press to open a tile's menu.

- **Seam:** the shared `Overlay` and `openContextMenu()` (DESIGN.md §9.3).

#### Preloading the next track

Load the next track shortly before the current one ends, for gapless changes.
- **Seam:** `PlaylistPlayer` (DESIGN.md §8); crossfades already start the next voice early (§8.4).

#### Committed browser smoke tests

The UI and `WebAudioEngine` have been checked by driving the real page in headless Chromium over the DevTools protocol, using only Node's built-in `WebSocket`. That script lives outside the repository.

- **Notes:** commit it (for example as `scripts/browser-smoke/` with an `npm run smoke` script) so the checks can be repeated. It needs a local Chromium and stays out of `npm run check`. See [`TESTING.md`](TESTING.md). It becomes more valuable as the dialogs add UI.

#### Media element reuse for Safari (only if needed)

New media elements are assumed to play in Safari once the audio context has been unlocked (DESIGN.md §12). If manual testing shows otherwise, `WebAudioEngine` could create a small pool of elements during a click and reuse them.

### Finally: design the remaining features

All the planned features are done. Next, write proposals for everything still open: the three items below and the "Later, unordered" entries above.

#### Mobile design

Make the page usable on a phone or tablet.

- **Changes:** DESIGN.md §1.1 currently targets desktop browsers only, with "no special handling" for touch, and §9 lays the page out for a laptop screen.
- **Notes:**
  - The header's three volume controls collapse into a hamburger menu on narrow screens. Today they have a fixed width and make the page scroll sideways below about 1030 px.
  - The footer's three bars per row, the tile grid and the dialogs need narrow layouts.
  - Context menus need a touch gesture (see "Context menus on touch screens" above).
  - Audio unlocking and playback in Safari on iOS need checking.

#### Remote control

A version of the app that controls another instance running elsewhere: a phone chooses what plays, while the PC does the playing. This expands "LAN access and phone remote control" above.

- **Notes:**
  - It is likely to be used mostly on a phone, so it builds on the mobile design.
  - Open: whether the remote is a separate page or a role of the same page. Today every open tab is an independent player, so the proposal must say which tab is the player and what happens when a second player connects.

#### Loose ends from earlier discussions

- **Customizable playlist looping.** `PlaybackRules.playlistLooping` is always on "for now" (DESIGN.md §8.2). An option could let a playlist stop after its last track instead.
- **Files whose duration can't be measured.** Bootstrap stores `"duration": null` for them (DESIGN.md §3.5), but the UI assumes every sound has a duration: the sound dialog leaves out its Start and end section for such a sound, and crossfades skip such tracks. Decide how they should be handled, for example by reading the duration in the browser on first play, or by reporting them at startup like unsupported files.
