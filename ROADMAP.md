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

### 7. Playback order

**Goal.** In the playlist dialog, choose how a playlist moves through its tracks: **Ordered** (the default, alphabetical), **Random** (each next track picked at random, never the same twice in a row), or **Shuffle** (all tracks once in a shuffled order, then a new shuffle). Previous and Next work like undo and redo over the tracks the playlist has played, so going back and forward again replays the same tracks. The choice applies at once and is saved 500 ms later.

**Decided** (from the backlog): the three orders as described above; Previous and Next as undo and redo, with a new pick only when Next goes past the end of what was played; the 3-second rule for Previous stays; the track list keeps the alphabetical order with the current track marked; a changed order applies from the next new pick; nothing is remembered across a reload.

**Why two tracks are not enough to test it.** With two tracks, Random ("never the same twice") and Shuffle ("a new round never starts with the track that just played") both come down to strict alternation, exactly like Ordered. Nothing about the new orders can be heard or seen. Automated tests don't need the fixture, since they use fake libraries of any size, but manual testing does (question 6).

**Design changes.**

- **§2.3.** Playlist options files may hold `order`: `"ordered"` (the default), `"random"` or `"shuffle"`. Any other value fails validation like other bad keys.
- **§5.1, §5.2.** `Playlist` gets `order`. `updatePlaylist` and `PATCH /api/playlists/<id>` accept it. `/api/library` includes it for every playlist.
- **§6, §6.1.** `customizePlaylist(playlistId, { …, order? })`; an unknown order is an `InvalidCommandError`. `savePlaylistOptions` sends it with the rest of the playlist's options. `Soundboard` takes an optional `random` function (default `Math.random`), passed down to the players, so tests can use a seeded generator.
- **§8.2.** `PlaybackRules.order` is read from the playlist. The order strategies change shape, because Random and Shuffle need state and must not pick twice for the same moment:
  - A **strategy** (`logic/order-strategies.js`) is created when the playlist starts: `{ first(), next(lastIndex), played(index) }`. Ordered steps through the indices (wrapping, as `loop` is always on). Random picks uniformly among all tracks but the last one. Shuffle deals a shuffled round, and deals a new round when it runs out, never starting it with the track that just played. `played(index)` tells Shuffle that a chosen track counts as played in this round.
  - A **track queue** (`logic/track-queue.js`, new) holds the played tracks and a cursor. `next()` moves forward through tracks already played, and only past the end asks the strategy for a new pick, which is appended. `previous()` steps back. `choose(index)` (a track picked in the track list) drops everything after the cursor and appends the choice. `peekNext()` returns the track that `next()` would move to, picking and remembering it if needed, so the crossfade timer, the crossfade marker and the natural end of a track all agree on one upcoming track.
  - The queue keeps at most 500 tracks; the oldest are dropped.
- **§8.1.** `play()` starts a new queue: Ordered from the first track, Random from a random one, Shuffle from the first track of its first round. `next()`, `previous()` and `jumpTo()` go through the queue; the 3-second rule for Previous is unchanged. A changed order replaces the strategy at once. A pick that was only peeked at (to plan a crossfade) is dropped and picked again with the new order. Tracks already played after the cursor (after going back) stay.
- **§8.4.** The crossfade uses `peekNext()` instead of asking the strategy each time.
- **§9.7.** A **Playback order** card in the playlist dialog's "Playlist" tab, between Volume and Fades: three radio buttons, each with a one-line description below its name.
- **§10.** The new files and the new fixture playlist.

**Open questions.**

1. **Names in the file.** *Recommended: `"ordered"`, `"random"` and `"shuffle"`, matching the UI, and renaming today's internal `"sequential"` to `"ordered"`,* so one name is used everywhere.
2. **Previous before the first played track.** The queue has nothing before the track the playlist started with. *Recommended:*
   - **Ordered** keeps today's behavior: step to the alphabetically previous track (wrapping to the last), added to the front of the queue.
   - **Random and Shuffle** restart the current track, since nothing earlier was played.
3. **Choosing a track from the track list.** *Recommended: as the backlog suggests.* It plays the track, drops anything after the cursor (as typing does after an undo) and appends the choice. In Shuffle it counts as played for the current round, so the round doesn't play it again.
4. **Changing the order while playing.** *Recommended: as described under §8.1.* The new order applies to the next new pick; tracks you can redo with Next stay as they were.
5. **How long the history is.** *Recommended: 500 tracks.* That is many hours of play, and a few kilobytes at most.
6. **Fixture.** *Recommended: add a playlist `Music Order/` to `test_fixtures/example_soundboard/` with 6 MP3 tracks of about 10 s each, cut with ffmpeg from the existing fixture songs at different points, and tagged "Order 1" to "Order 6".*
   - Six tracks make Random and Shuffle clearly different from Ordered within a minute of listening, and the titles show in the footer which track is playing.
   - The tests that list every fixture file (titles, durations, scanning, bootstrap) get the new entries.
   - The fixture is yours; please confirm I may add to it.
7. **The radio buttons' descriptions.** *Recommended:*
   - Ordered: "First to last, as listed."
   - Random: "Any track next, never the same one twice in a row."
   - Shuffle: "Every track once in a shuffled order, then shuffled again."

**Plan.**

1. **Server.** `order` in playlist options validation, `Playlist`, `/api/library`, `updatePlaylist` and `PATCH /api/playlists/<id>`. *Tests:* valid and invalid values in files, the default, saving, and the route's `400`.
2. **Order strategies.** Ordered, Random and Shuffle with an injected random function, plus a seeded generator in `test/helpers/`. *Tests:* Random never repeats a track (and handles one track); every Shuffle round holds each track once and never starts with the track that ended the previous round; `played()` removes a chosen track from Shuffle's round; the same seed gives the same sequence.
3. **Track queue.** *Tests:* redo replays the same tracks; a new pick only past the end; `choose()` drops what was after the cursor; `peekNext()` picks once and `next()` then moves there; a changed strategy drops only a peeked pick; Previous before the start (Ordered and the others); the 500-track cap.
4. **Player and facade.** `PlaylistPlayer` uses the queue; `resolvePlaybackRules` reads `order`; `setRules` swaps the strategy; `customizePlaylist` accepts `order`; `Soundboard` takes `random`. *Tests:* each order through the player, crossfades into the peeked track, a changed order while playing, saving, validation, and the randomized invariant test run with all three orders.
5. **Fixture.** The `Music Order/` playlist, and the fixture tests updated.
6. **UI.** The Playback order card, plus checks in `TESTING.md`. Checked with the manual checklist and a headless Chromium run.
7. **Design update.** `DESIGN.md` in its own commit. Then this proposal and its backlog entry are removed.

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. **Decided** lists the owner's answers already given; the notes list what else is known and the questions still to settle.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

#### 7. Playback order

Radio buttons in the playlist dialog:

- **Ordered** (the default): first to last in the usual alphabetical order.
- **Random:** each next track is picked at random, never the same one twice in a row (unless the playlist has only one track).
- **Shuffle:** a shuffled list of all tracks is played through; then a new shuffled list is made whose first track is not the one that just played.

- **Seam:** the order strategy registry (`order-strategies.js`, DESIGN.md §8.2) and `PlaybackRules.order`. Random strategies take a seeded random number generator so they stay testable.
- **Decided: Previous and Next work like undo and redo.** The playlist keeps a list of the tracks it has played and a cursor in it. *Previous* steps back through it and *Next* steps forward again, replaying the same tracks in the same order. Only when *Next* goes past the end of the list does the order strategy pick a new track, which is appended. Ordered and Shuffle can generate the upcoming tracks in advance; Random picks each one when it is needed.
- **Notes** (to settle in the proposal):
  - *Choosing a track* from the track list plays it and is probably appended like a new pick, dropping anything after the cursor (as typing does after an undo). In Shuffle it then counts as played for that round.
  - The 3-second rule for *Previous* (restart the current track) stays.
  - The track list always shows the alphabetical order, with the current track marked.
  - Changing the order while the playlist plays takes effect from the next new pick.

#### 8. Track looping

A checkbox: the current track repeats until the user moves to another one. That track then repeats in turn.

- **Decided:** the existing `PlaybackRules.loop` ("wrap from the last track to the first") is renamed `playlistLooping`. It stays `true` and is not customizable. The new option is `trackLooping`.
- **Notes:** with a crossfade, does a looping track crossfade into itself, or loop seamlessly? Seamless is the expected answer; it interacts with start and end points (feature 11).

#### 9. What "stop" does

Radio buttons in the playlist dialog:

- **Pause:** remember the position; playing again continues from there.
- **Reset track:** remember the track; playing again starts it from the beginning.
- **Reset playlist:** forget everything; playing again starts as if for the first time. This is today's behavior, and the likely default.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8). Starting a playlist currently always begins at the order strategy's first track.
- **Decided:** nothing is remembered across a page reload.
- **Notes:** "stopped but remembering" is a new look for the idle tile, showing that it will resume. Does "Stop (Instant)" follow the setting too? Probably yes, since "instant" is about fades, not about forgetting. The played-tracks list from feature 7 is kept or cleared along with the position.

#### 10. Test playback in the track list

A play/stop button next to each track in the playlist dialog, which starts or stops it immediately. The open accordion shows a progress bar with seeking. Everything reflects the playlist's real state, so a track started from the footer shows as playing in the dialog, and when the track ends the playlist carries on as usual.

- **Seam:** the existing facade covers it: `jumpToTrack(id, i, 'instant')`, `stopPlaylist(id, 'instant')`, `seek`, and the `playlist.stateChanged` and `playlist.progress` events. This is mostly UI work.

#### 11. Track start and end points

As for sounds (DESIGN.md §7, §9.7), per track, shown on or below the track's progress bar.

- **Seam:** `planTrack(track, rules) → { startAt, endAt }` (DESIGN.md §8.2). `startAt` is already applied by seeking after loading.
- **Decided:** the selected range *is* the track as far as playback is concerned. The footer's time, the progress bar and seeking all cover only the part between the start and end points.
- **Decided:** as for sounds, changed points take effect from the next time a track starts; a playing track keeps its range. The voices' `startAt` and `endAt` options (DESIGN.md §6.3) and the dialog's range control can be reused. Track files already accept `startAt`, `endAt`, `fadeIn` and `fadeOut` (§2.3); tracks just ignore them so far.
- **Notes:** `endAt` needs a clock timer bound to the current generation that treats reaching `endAt` like `ended`; a crossfade then starts at `endAt − crossfade`. The track dialog's own editor still shows the whole file, since that is where the points are chosen.

#### 12. Track volume

Per-track volume in the track's accordion.

- **Seam:** only UI is needed: a track's `gain` from its options file is already applied, multiplied by the playlist's (DESIGN.md §6.4). Saving it means accepting `gain` in `LibraryEditor.updateTrack` and `customizeTrack` (DESIGN.md §5.1), and the control goes in the open row of the track accordion (§9.7).

#### 13. Waveform

The track's waveform drawn above its progress bar and start/end points.

- **Decided:** waveforms are generated in the browser, which is the only place that can decode audio without a third-party library.
  - Once the splash closes, the page asks the server which waveforms are missing and generates them one at a time in the background.
  - The header shows that this is happening, with progress and a button to stop it.
  - Each finished waveform is sent to the server, which stores it, so a track is only ever decoded once.
- **Research for the proposal:** the storage format and drawing method that keep memory low.
  - A fully decoded 5-minute stereo track is about 100 MB, so each decode must be reduced to peaks straight away and the decoded audio dropped before the next one starts.
  - The likely answer is a fixed number of min/max pairs per track stored as bytes, which is a few KB each, in a hidden directory such as `.soundboard-cache/`. They would be fetched only when a dialog shows them and drawn on a `<canvas>`.
  - The work must not starve playback on the 8 GB MacBook. Decoding at a low sample rate with an `OfflineAudioContext` may help.
  - Open: do sounds get waveforms too, above their start and end slider (DESIGN.md §9.7)?

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

Load the next track shortly before the current one ends, for gapless changes. Resuming where a playlist stopped is covered by feature 9.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8); crossfades already start the next voice early (§8.4).

#### Committed browser smoke tests

The UI and `WebAudioEngine` have been checked by driving the real page in headless Chromium over the DevTools protocol, using only Node's built-in `WebSocket`. That script lives outside the repository.

- **Notes:** commit it (for example as `scripts/browser-smoke/` with an `npm run smoke` script) so the checks can be repeated. It needs a local Chromium and stays out of `npm run check`. See [`TESTING.md`](TESTING.md). It becomes more valuable as the dialogs add UI.

#### Media element reuse for Safari (only if needed)

New media elements are assumed to play in Safari once the audio context has been unlocked (DESIGN.md §12). If manual testing shows otherwise, `WebAudioEngine` could create a small pool of elements during a click and reuse them.

### Finally: design the remaining features

Once features 6–13 are done, write proposals for everything still open: the three items below and the "Later, unordered" entries above.

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

- **Customizable playlist looping.** Feature 8 keeps `playlistLooping` always on "for now". An option could let a playlist stop after its last track instead.
- **Files whose duration can't be measured.** Bootstrap stores `"duration": null` for them (DESIGN.md §3.5), but the UI assumes every sound has a duration: the sound dialog leaves out its Start and end section for such a sound, and crossfades skip such tracks. Decide how they should be handled, for example by reading the duration in the browser on first play, or by reporting them at startup like unsupported files.
