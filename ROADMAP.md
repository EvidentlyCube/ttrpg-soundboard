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

### Deleting and moving sounds, tracks and playlists

**Goal.** From the Customize dialogs, the user can delete a sound, a track or a whole playlist, and move a sound into a playlist, or a track into another playlist or out to the sound effects. Deleting never destroys anything: files go to a `.trash/` folder in the root, where they stay until the next feature deals with them. Every open tab follows the change, and nothing counts as an external change.

**Design changes.**
- **§2 layout, §2.1.** A new `.trash/` folder in the root. Its leading dot already hides it from the scanner, the change watcher and refreshes.
  - A deleted file keeps its path relative to the root inside `.trash/`, together with its options file and waveform: `Boom.mp3` → `.trash/Boom.mp3` (+ `.json`, `.wf`), `Combat/Boss/1.mp3` → `.trash/Combat/Boss/1.mp3`.
  - A deleted playlist moves as a whole: `Combat/` → `.trash/Combat/` and `Combat.json` → `.trash/Combat.json`. The folder goes with everything in it, including subdirectories that aren't included and files the app doesn't show.
  - Missing folders in `.trash/` are created. Name clashes there get ` (2)`, ` (3)`… as additions do (question D).
- **§5.1 `LibraryEditor`.** New `deleteSound(id)`, `deleteTrack(id)`, `deletePlaylist(id)`, `moveSound(id, playlistId)` and `moveTrack(id, target)`, where `target` is a playlist id or `null` for the sound effects.
  - Each moves the audio file, its options file and its waveform with `rename` (all on one file system), then updates `Library.files`, `sounds` and the playlists. A playlist left without tracks is removed from the library (question C).
  - A move keeps the file name, adding ` (2)` on a clash, and lands in the top level of the target (question G). The options file moves unchanged: sounds and tracks accept the same keys (§2.3), so title, gain, points and fades all carry over. A waveform stays valid, because `rename` keeps size and modified time.
  - Each one waits for writes queued on the item's options file first, so a save can't recreate the file at its old path. Afterwards the old id is unknown, so a late save gets `UnknownSoundError` and similar errors.
  - Each returns what it removed and wrote, for the change watcher.
- **§5.2 HTTP API.**
  - `DELETE /api/sounds/<id>`, `DELETE /api/tracks/<id>` and `DELETE /api/playlists/<id>` answer `204`, or `404` for an unknown id.
  - `POST /api/move` takes `{ id, to: playlistId | null }` and answers with the item at its new place, in the `/api/library` format. A request to move an item where it already is gets `400`. The id goes in the body because a track id already takes up the rest of the path.
  - A new event stream message `library.removed` carries `{ soundId }`, `{ trackId, playlistId }` or `{ playlistId }`. A move is a `library.removed` followed by the existing `library.added`. For `library.added`, the playlist that receives a track is sent whole, as it is today.
- **§5.3 Change watcher.** `writeFiles(task)` also accepts a `removed` list from the task and drops those paths from the baseline. Files inside `.trash/` are never in the baseline.
- **§6 ports.** New `BackendApi` methods `deleteItem({ kind, id })` and `moveItem(id, to)`.
- **§6.1, §6.2 facade and events.** New methods `deleteSound(id)`, `deleteTrack(id)`, `deletePlaylist(id)`, `moveSound(id, playlistId)` and `moveTrack(id, playlistId | null)`. Each returns a promise that rejects with a message for the user. Like downloads, these are not commands, because they are not playback.
  - Each first flushes and settles the item's pending options save (and, for a playlist, its tracks' saves).
  - New events are `sound.removed { soundId }` and `playlist.removed { playlistId }`. A track that leaves a playlist is announced as `playlist.changed`, as additions are. The tab that made the change and every other tab handle it the same way, through `library.removed` and `library.added`, skipping ids they don't know or already have (§6.8).
- **§6.8** becomes "Library changes" and covers removals too.
  - **§7.** A removed sound's instances stop instantly, and its buffer is dropped from the cache.
  - **§8.1.** A playlist that is removed stops instantly and its player is disposed. A new `PlaylistPlayer.replaceTracks(playlist)` generalizes `addTracks`. The history entries, retiring voices and resume point of a removed track are dropped, and the rest are remapped (`PlayHistory.setTracks` already takes a remap; removed tracks map to nothing). If the removed track is the current one, the playlist stops instantly (question A).
- **§9.7 Customize dialogs.** A new last card holds the buttons. It is titled **Move or delete** in the sound dialog and in an open track row, and **Delete** on the playlist's first tab (question B).
  - **Delete** is a red (`danger`) button, labeled "Hold to delete" (question F).
    - Deleting a sound or a playlist closes its dialog.
    - Deleting a track removes its row and leaves the playlist dialog open. Its tab title "Tracks (N)" follows.
    - A failure shows as a red message in the card.
  - **Move…** opens the move dialog.
- **New §9.11 Move dialog** (`ui/move-dialog.js`), titled "Move <title>", in place of the Customize dialog, as the add dialog is opened (question E).
  - It lists the destinations as full-width buttons. **Sound effects** always comes first, with an amber (`sfx`) accent: a colored stripe and icon, and an amber hover tint. The playlists follow, sorted by title, with the blue (`music`) accent.
  - The item's current place is greyed out and disabled, and annotated "Here now".
  - Picking a destination moves the item at once and closes the dialog. A failure shows in red and keeps the dialog open.
- **§9.1 board.** Tiles of removed sounds and playlists disappear, and a moved sound or a new track shows like a download's addition.
- **TESTING.md.** Manual checks for the hold button, the move dialog and the board following changes in a second tab.

**Open questions.**

- **A. What happens to something that is playing when it is deleted or moved?** Recommended: it stops instantly. All of a sound's instances stop. A playlist that is deleted, or whose current track (playing, paused or loading) leaves it, stops instantly as `stop('instant')` does, and forgets a resume point on that track.
  - The alternative for a current track is to skip to the next one. But the dialog is where the user is working, and a moved file's old URL stops serving at once, so a seek would fail.
  - This also decides what the other tabs do, so disabling the buttons while an item plays wouldn't be enough on its own.
- **B. Can a playlist be moved?** Recommended: no, a playlist only gets Delete. Moving it would mean merging all its tracks into another playlist or into the sound effects, which is rarely wanted, and tracks can be moved one at a time.
- **C. What happens to a playlist whose last track is deleted or moved away?** Recommended: it disappears from the board (`playlist.removed`).
  - If its folder then holds nothing but dot files, the folder and its options file go to `.trash/`, as a deleted playlist does, so the next start doesn't warn about an empty playlist.
  - Otherwise, for example when it still holds subdirectories that aren't included, both stay where they are.
- **D. Name clashes in `.trash/`?** Recommended: ` (2)`, ` (3)`… before the extension, as for additions (§5.1).
  - For a deleted playlist, the folder and its options file are renamed together (`.trash/Combat (2)/` + `.trash/Combat (2).json`), so each deletion stays one unit.
  - Tracks deleted one by one from `Combat` all go into `.trash/Combat/`, wherever its playlist is.
- **E. Where does the user end up after a move?** Recommended: the move dialog replaces the Customize dialog, and closes after the move. Moving several tracks out of one playlist then means reopening the playlist dialog each time.
  - The alternative is to return to the playlist dialog after moving a track, which needs a way to reopen it on the Tracks tab.
- **F. How does the hold-to-delete button behave?** Recommended:
  - Pressing it, by pointer or by holding Enter or Space, fills it from left to right over 1 s with a CSS transition, started by a `data-holding` attribute (§9.6), and the delete runs when a 1000 ms timer fires.
  - Releasing early, leaving the button, losing focus or `pointercancel` cancels it, and the fill snaps back.
  - Key repeats are ignored.
  - While the request runs, the button is disabled and reads "Deleting…".
- **G. Where does a track from a nested subdirectory go when moved?** Recommended: into the top level of the target playlist folder, or into the root for the sound effects. The subdirectory doesn't follow it.

**Plan.** In the lean flow: code first, with the owner checking the UI, then tests and DESIGN.md in one sweep.
1. **Trash and removals in `LibraryEditor`**: `deleteSound`, `deleteTrack` and `deletePlaylist`, with ` (2)` clash handling, the waits on queued writes, emptied playlists (C), and the watcher's `removed` list.
2. **Moves in `LibraryEditor`**: `moveSound` and `moveTrack`, with clashes, nested tracks (G) and emptied playlists.
3. **HTTP and events**: the three `DELETE` routes, `POST /api/move` and `library.removed`.
4. **`PlaylistPlayer.replaceTracks` and `PlayHistory` remapping with removals**, and stopping on a removed current track (A).
5. **Facade**: the delete and move methods, `library.removed` handling, `sound.removed` and `playlist.removed`, stopping sounds and disposing players, and the `BackendApi` methods.
6. **UI**: the hold-to-delete button, the new cards in the three places, the move dialog, and the board removing tiles.
7. **Tests** for steps 1–5, **TESTING.md** checks, then **DESIGN.md** (its own commit), and removing this proposal and the backlog entry "Moving and deleting files".

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

#### Moving and deleting files

Move a sound into a playlist, a track out of a playlist or into another one, and delete sounds and tracks, all from the UI.

- **Seam:** the in-place library updates that downloads use (DESIGN.md §5.1, §6.8: `LibraryEditor` additions, `library.added` messages, `playlist.changed`) extend to removals and moves. The change watcher's baseline has to follow every move (`writeFiles`, §5.3), and an options file and a waveform (`.json`, `.wf`) move or go together with their audio file.
- **Notes:** decide what happens to a track or sound that is playing when it moves or is deleted. Deleting should probably move files to a `.soundboard-trash/` folder rather than remove them, so a mistake at the table can be undone.

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
