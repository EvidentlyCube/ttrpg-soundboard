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

### Managing the trash

**Goal.** A header button shows how much is in the trash. It opens a dialog that lists the trashed playlists (with their tracks indented beneath them) and sounds. Each entry can be restored to the board or deleted for good, one at a time or all at once.

**Design changes.**

- **§2.5 Trash and moves.** The trash gets a reading, and two new actions.
  - **Reading the trash.** Root-level audio files in `.trash/` are **sounds**. Each folder there is a **playlist**, and the audio files at any depth inside it are its **tracks**. Titles come from the trashed options files, falling back to the default titles (§2.4). A trashed playlist's title comes from `.trash/<name>.json` if there is one. When only single tracks were deleted, there is none, and the folder name is used. Dot files are skipped. Other files are not listed, but they count toward the size.
  - **Size.** This is the total of every file under `.trash/`.
  - **Restoring a sound** moves it, with its options file and waveform, back to the root. On a clash it gets ` (2)` as other additions do (`moveAudioFile`). Its title stays as it was (B).
  - **Restoring a track**, when its playlist (a root folder of that name) exists, puts it into the playlist's top level, wherever it sits inside the trashed folder (C). Clashes get ` (2)`. When the playlist is gone, a new playlist folder is created, `.trash/<name>.json` is **copied** next to it (so the tracks still in the trash keep it), and the track goes back in as above. Without a trashed options file, the new playlist gets an options file with the folder's name as its title.
  - **Restoring a playlist** whose name is free moves the whole folder and its options file back, with everything in them. If a playlist of that name exists, each track is restored into it as above, and the trashed options file is ignored.
  - **A trashed playlist with no audio files left** leaves the trash completely: its folder, anything else still in it, and its options file. This happens after its last track is restored or deleted (D).
  - **Deleting for good** removes the audio file, its options file and its waveform. For a playlist, it removes the folder and its options file.
  - **Everything.** "Restore all" restores every playlist, then every sound. "Delete all" removes `.trash/` itself.
- **§5.1 `LibraryEditor`.** New `restoreSound(id)`, `restoreTrack(id)`, `restorePlaylist(id)` and `restoreAll()`, where the ids are the trashed paths (the item's old id).
  - Each adds what it restored to the library as additions do, re-reading the options files, and returns `{ changes, written, renamed }`. Here `changes` holds `library.added` messages: the sound, or the receiving playlist with all its tracks.
  - A new `trash.js` holds `listTrash(root)`, `trashSize(root)` and `purgeTrash(root, { kind, id } | 'all')`. The trash never takes part in the change watcher's baseline. Restores still go through `watcher.writeFiles`, so the restored files are recorded afresh. Purges go through it too, so they take their turn.
- **§5.2 HTTP API.**
  - `GET /api/trash` returns `{ size, playlists: [{ id, title, size, tracks: [{ id, title, size }] }], sounds: [{ id, title, size }] }`, sorted as the board sorts (§2.2).
  - `POST /api/trash/restore` and `POST /api/trash/delete` take the body `{ kind: 'sound' | 'track' | 'playlist', id }` or `{ all: true }`. They answer `200 { changes }`, plus `404` for an id that isn't in the trash and `400` for a bad body.
  - A new event stream message, `trash`, carries `{ size, count }`. Here `count` is the number of listed entries: playlists plus sounds, with tracks counted only inside their playlist. It is sent on connect and after anything that changes the trash: deletions, moves that leave a playlist empty, restores and purges. The trash is never watched, and quick checks ignore it (F).
- **§6.1, §6.2, §6.8 facade.**
  - `trashSummary()` returns `{ size, count }`, announced as `trash.changed`.
  - `loadTrash()` fetches the listing.
  - `restoreFromTrash(target)` and `deleteFromTrash(target)` first wait for `OptionsSync.settleAll()`, then apply the `changes` from the answer as deletions and moves do, so restored sounds and tracks appear at once. These are not commands.
  - New `BackendApi` methods: `trash()`, `restoreFromTrash(target)` and `deleteFromTrash(target)`.
- **§9.1 header.** A **Trash** button sits left of the volume controls, after the waveform progress. It shows a trash icon and the size, such as "Trash · 340 MB". It is shown only while `count > 0`.
  - The size uses decimal units, as Finder does: MB below 1 GB, then GB. It has one decimal below 10 (`4.2 MB`, `1.4 GB`) and none above (`340 MB`), and never shows less than `0.1 MB`.
- **New §9.12 Trash dialog** (`ui/trash-dialog.js`), titled "Trash".
  - Playlists come first, as on the board, each as a row with a blue stripe, its title, its track count and size. Its tracks follow in rows indented beneath it, each with its title and its path inside the playlist in muted text when nested, and its size. Sounds follow, with an amber stripe.
  - Each row has **Restore** and **Delete** hold buttons (1 s). Restore uses a neutral style, Delete the red one.
  - The footer has **Restore all** and **Delete all**, each held for **3 s**. The dialog closes when the trash becomes empty.
  - The list is fetched when the dialog opens and again on every `trash.changed`, so another tab's deletions show up. Rows stay disabled while an action runs, and a failure shows in red in the footer.
- **§9.4 `holdButton`.** It gets a `holdMs` option (default 1000) and a `tone` option (`'danger'` or `'neutral'`). The fill's duration becomes an inline `transition-duration`, since Tailwind can't build a class from a variable.
- **TESTING.md.** Manual checks for the button's visibility and size, the indentation, both hold lengths, and restores appearing on the board in two tabs.

**Answers.**

- **A. The hold is the only confirmation.**
- **B. A restored file renamed to ` (2)` keeps its title.** Only the file name changes.
- **C. A restored track always goes to the playlist's top level**, wherever it sits inside the trashed folder, as if the folder were flattened. Only a whole playlist restored under a free name keeps its subdirectories, because it moves back as it is.
- **D. Files left in a trashed playlist folder once its audio is gone are deleted** with the folder and its options file.
- **E. Restore all restores whole playlists first, then sounds.**
- **F. The trash is not watched.** The server reads it at startup and after its own deletions, moves, restores and purges. Changes made by hand show up at the next start. Quick checks don't look at it.

**Plan.** In the lean flow: code first, with the owner checking the UI, then tests and DESIGN.md in one sweep.
1. **Reading the trash** (`trash.js`): the listing, titles and sizes.
2. **Restores in `LibraryEditor`**: sounds, tracks into existing and missing playlists, whole playlists, Restore all, and removing a trashed playlist once its audio is gone.
3. **Purges**: single items and everything.
4. **HTTP and events**: `GET /api/trash`, the restore and delete routes, and the `trash` message (sent on connect, after deletions and moves, and on quick checks).
5. **Facade**: `trashSummary`, `trash.changed`, `loadTrash`, the restore and delete methods, and the `BackendApi` methods.
6. **UI**: `holdButton` options, the header button and the trash dialog.
7. **Tests** for steps 1–5, **TESTING.md** checks, then **DESIGN.md** (its own commit), and removing this proposal and the backlog entry "Managing the trash".

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

#### LAN access and phone remote control

Open the app on a phone on the same network to choose what plays, while the PC does the playing.

- **Seam:** commands and events are plain serializable objects and every command goes through `dispatch()`, which validates it (DESIGN.md §6). The server holds no playback state.
- **Notes:** would add a `--host` option, a `GET /api/events` stream (server-sent events) and a `POST /api/commands` relay, plus a "player" and "remote" role for pages.

#### Managing the trash

Deleted sounds, tracks and playlists sit in `.trash/` (DESIGN.md §2.5) and nothing in the app looks at them yet. The owner wants this as the next feature: for example, list what is in the trash, restore items to where they were, and empty it.

- **Seam:** the trash mirrors root paths, so a restore is a move back (`moveAudioFile`, `mergeDirectory` in `src/library/file-moves.js`) announced as `library.added`, through `writeFiles` so the change watcher follows (§5.3).

#### Where files came from

Downloads record their origin in the options file's `source` (DESIGN.md §2.3).

- **Recognizing existing files:** bootstrap could look in each file name for a YouTube video id in square brackets, as `yt-dlp` names files (`Title [dQw4w9WgXcQ].mp3`, matching `\[([A-Za-z0-9_-]{11})\]`), and store `source: { extractor: 'Youtube', videoId }` when the options file has no `source` yet.
- **Showing it:** expose `source` in `/api/library` and in the Customize dialogs, for example as a link back to the video.

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
