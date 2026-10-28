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
- **§3 Bootstrap, new §3.6 "Refresh".** Replace the §3.4 extension point note. A refresh runs `BootstrapService.run` again (later-run mode, §3.3) with the same `Reporter` (its output goes to the terminal, as at startup) and a `Prompter` that answers from the request (open question 4). Differences from a start:
  - *Validation errors* (§2.3) don't exit. The refresh fails, nothing is replaced, and the errors go back to the page.
  - *No `.soundboard`* would make it a first run, which asks questions; the refresh fails with "Restart the app" instead.
  - On success the new `Library` and `SettingsStore` replace the old ones (below), and a new file baseline is taken.
- **§5.1, new "Change watcher" (`src/library/change-watcher.js`).** Decides whether the directory differs from what the app last loaded.
  - *Baseline.* At the end of bootstrap: every file the scanner uses (§2.1: audio files, options files, `.soundboard`) with its size, modified time and SHA-1. Audio files take the SHA-1 already stored in `measuredFrom` (§3.5), so building the baseline reads no audio; the small `.json` files are hashed.
  - *Watching.* `fs.watch(root, { recursive: true })` (open question 2) only says that something under a path changed. For each path, after 1 s without further events, the watcher compares the path with the baseline:
    - a file the scanner would use (§2.1) that is not in the baseline: **change**;
    - a baseline file that is gone, or a baseline directory that is gone: **change**;
    - a baseline file with the same size and modified time: no change; otherwise hash it, and a different SHA-1 is a **change** (a merely touched or copied file is not).
    - Ignored: names starting with `.` (except `.soundboard`), `.wf` and `.tmp` files, unsupported audio, orphan `.json` files, empty directories, symlinks.
  - *Once a change is found* the watcher sets `externalChanges = true`, announces it, and stops checking until the next refresh. A half-copied file therefore costs at most one hash; whatever it looks like at refresh time is what bootstrap reads, and if it is still growing the next check after the refresh finds it changed again.
  - *Own writes.* `LibraryEditor`, `SettingsStore` and bootstrap record the new size, modified time and SHA-1 of each file they write in the baseline right after the rename, so the app's own saves are never external changes.
  - *Missed events.* Right after it starts, the watcher compares the whole tree with the baseline once, which covers changes made between the startup scan and the watcher starting. If `fs.watch` fails or reports an error (for example the Linux inotify limit), it falls back to the same full comparison every 30 s.
- **§5.1, replacing the library.** The router, `LibraryEditor` and `WaveformStore` hold the `Library` and `SettingsStore` today. They get them from a holder (`AppState`) that a refresh swaps. The refresh and the writing requests (`PATCH`, `PUT`) take turns through one lock, so a save is never lost between the rebuild reading a file and the swap. A second refresh request while one runs waits for it and gets its result.
- **§5.2 HTTP API.**
  - `GET /api/events`: a server-sent event stream (open question 1). On connect it sends the current state, then `{ "type": "externalChanges" }` when changes are found and `{ "type": "refreshed", "generation": n }` after each successful refresh.
  - `POST /api/refresh`: body `{ acceptNestedDirectories?: boolean }`. `200 { generation }` once the rebuild has finished. `409 { error, nestedDirectories: [...] }` when new nested directories need an answer (open question 4). `422 { error, errors: [{ path, message }] }` for validation errors. `503 { error }` when `.soundboard` is gone.
  - `/api/library` gains `generation`, a counter starting at 1 and bumped by every refresh, so a page can tell that it shows an old library.
- **§6, §6.1, §6.2.** A new port, `ServerEvents` (`api/server-events.js` over `EventSource`, with a fake for tests), and `BackendApi.refresh({ acceptNestedDirectories })`. The facade:
  - emits `library.externalChanges {}` when the server reports changes, or when a `refreshed` arrives with a newer generation than the page's (another tab refreshed);
  - `refreshLibrary({ acceptNestedDirectories })` flushes every pending save and **waits for them to finish** first, so the rebuild reads the user's latest edits, then calls the server. It emits `library.refreshing {}`, then `library.refreshed {}`, `library.refreshNeedsAnswer { nestedDirectories }` or `library.refreshFailed { message, errors }`.
  - The UI reloads the page on `library.refreshed` (logic never touches `window`). After the reload the splash asks for a click again, because the browser needs a gesture to start audio (§9.0).
- **§9.1 Layout, new §9.x.** The yellow **External Changes – Refresh** button sits in the header, left of the waveform indicator, and is shown only while the page knows of changes. While refreshing it is disabled and reads "Refreshing…". New nested directories open a confirm dialog with the same list and question as the terminal (§3.2 step 5); confirming sends the refresh again with `acceptNestedDirectories: true`. Validation errors open a dialog listing each file and problem; the button stays so the user can retry after fixing them. A missing `.soundboard` shows a blocking message: "The audio directory was reset. Restart the app."
- **TESTING.md.** Manual checks: copy a large file in and click Refresh during and after the copy; replace a file with the same content (no button); edit an options file by hand; save options in the dialog (no button); delete `.soundboard`; two tabs.

**Open questions.**
1. **Push channel.** Server-sent events or WebSockets? *Recommended: server-sent events.* Only the server pushes, `EventSource` reconnects by itself, and it is plain `node:http`. Node has a WebSocket client but no server, so WebSockets would mean writing the protocol by hand.
2. **Watcher.** `fs.watch` with `recursive: true` (built in, works on Linux and macOS in Node 24), or the vendored chokidar? *Recommended: `fs.watch`.* It only has to say "something changed under this path"; the baseline comparison does the rest, and the 30 s comparison covers its failures. The vendored chokidar imports `readdirp`, which is not in the folder, so it would not load as it is, and it would need an exception to the no-dependencies rule. With `fs.watch`, `src/external_libs/` can be deleted.
3. **Deleted files.** The request mentions added and modified files. *Recommended: deletions count too*, as above; otherwise a deleted sound stays on the board and fails with a `404`.
4. **New nested directories at refresh.** At startup they need a yes in the terminal. *Recommended:* the page asks the same question in a dialog (the `409` round trip above). Alternatives: merge them without asking, since the user asked for the refresh; or fail with "Restart the app to answer".
5. **Other tabs.** When one tab refreshes, the others show an old library. *Recommended:* they show the same button (their generation is old), and clicking it only reloads them. They are not reloaded by themselves, since that would cut off whatever they are playing.
6. **Orphaned files at startup.** The question about deleting orphaned files has nothing to do with watching. *Recommended:* a separate small proposal, done after this one.

**Plan.**
1. Backend clock port and `FileBaseline`: built from a scan and the loaded options, compares a path (new, gone, same size and time, different hash) — tests on temp trees.
2. `ChangeWatcher`: watcher port with a fake, the 1 s quiet period per path, ignored names, own writes recorded by `LibraryEditor`, `SettingsStore` and bootstrap, the startup comparison, the 30 s fallback — tests with the fake watcher and fake clock, plus one test with the real `fs.watch` on a temp directory.
3. `AppState` and the lock; the refresh through `BootstrapService` with the request-driven prompter — tests: the swap is seen by the router, editor and waveform store; a `PATCH` during a refresh is not lost; validation errors and a missing `.soundboard` replace nothing; concurrent refreshes share one run.
4. `POST /api/refresh`, `GET /api/events` and `generation` in `/api/library` — HTTP tests for every status code and the event stream.
5. Frontend: `ServerEvents` port, `BackendApi.refresh`, the facade's flush-then-refresh and its events — tests with fakes.
6. UI: the header button, nested-directory and error dialogs, the blocking message, the reload — manual checks, added to `TESTING.md`.
7. Update `DESIGN.md` and remove this proposal and its backlog entry.

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
