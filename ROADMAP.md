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

**Goal.** In the playlist dialog, choose how a playlist moves through its tracks: **Ordered** (the default, alphabetical), **Random** (each next track picked at random, never the same twice in a row), or **Shuffle** (all tracks once in a shuffled order, then a new shuffle). Previous and Next move backwards and forwards through the playlist's history. The choice applies at once and is saved 500 ms later.

**Decided** (the owner's answers and the backlog):
1. **History.** Each playlist keeps a history of tracks and a cursor in it. Next and Previous move the cursor. When Next goes past the end, the history is extended by the order: **Ordered** appends the whole playlist in order, **Shuffle** appends a whole new shuffled round (never starting with the track that just played), and **Random** appends one track at a time.
2. **Starting** a playlist fills a fresh history the same way, and plays its first entry: Ordered starts at the first track, Shuffle at the first track of a shuffled round, Random at a random track.
3. **Previous** never goes before the first entry. At the first entry it restarts the current track, and so does the existing 3-second rule. Ordered therefore no longer wraps backwards from the first track to the last.
4. **Choosing a track** from the track list clears the history and fills it as if playback had started there:
   - **Ordered:** the whole playlist in order, with the cursor at the chosen track, so Previous goes to the alphabetically earlier tracks.
   - **Shuffle:** a shuffled round with the chosen track first, so every track still plays once in the round.
   - **Random:** just the chosen track.
5. **Changing the order** does the same as choosing the current track, without restarting it: the history is cleared and filled by the new order around the current track. While the playlist is stopped, the new order is simply used at the next start.
6. **Size.** The history keeps at most 2¹⁶ (65,536) entries. When it grows beyond that, entries before the cursor are dropped, oldest first.
7. **One track.** Random and Shuffle pick among the tracks other than the current one, never by retrying until a pick differs. With a single track they repeat it, so they can never loop forever.
8. **Names** in the options file and the code: `"ordered"`, `"random"` and `"shuffle"`; today's internal `"sequential"` becomes `"ordered"`.
9. **Radio button descriptions:** Ordered "First to last, as listed."; Random "Any track next, never the same one twice in a row."; Shuffle "Every track once in a shuffled order, then shuffled again."
10. **Fixture.** A new playlist `Music Order/` with 6 MP3 tracks of about 10 s, cut from the existing fixture songs and tagged "Order 1" to "Order 6".
11. From the backlog: the track list keeps the alphabetical order with the current track marked, and nothing is remembered across a reload.

**Why two tracks are not enough to test it.** With two tracks, Random ("never the same twice") and Shuffle ("a new round never starts with the track that just played") both come down to strict alternation, exactly like Ordered. Nothing about the new orders can be heard or seen. Automated tests don't need the fixture, since they use fake libraries of any size, but manual testing does (decision 10).

**Design changes.**

- **§2.3.** Playlist options files may hold `order`: `"ordered"` (the default), `"random"` or `"shuffle"`. Any other value fails validation like other bad keys.
- **§5.1, §5.2.** `Playlist` gets `order`. `updatePlaylist` and `PATCH /api/playlists/<id>` accept it. `/api/library` includes it for every playlist.
- **§6, §6.1.** `customizePlaylist(playlistId, { …, order? })`; an unknown order is an `InvalidCommandError`. `savePlaylistOptions` sends it with the rest of the playlist's options. `Soundboard` takes an optional `random` function (default `Math.random`), passed down to the players, so tests can use a seeded generator.
- **§8.2.** `PlaybackRules.order` is read from the playlist. The order strategies become pure functions that fill the history (`logic/order-strategies.js`): each order has `start(trackCount, random, at)`, which returns the first entries and the cursor (`at` is the chosen or current track, if any), and `extend(trackCount, random, last)`, which returns the entries to append after `last`.
- **§8.1.** A **play history** (`logic/play-history.js`, new) holds the entries and the cursor, with `start(at?)`, `next()`, `previous()`, `canGoBack`, `upcoming` (the entry after the cursor, extending the history first if needed) and `setOrder(order)`. Because upcoming tracks are entries, the crossfade timer, the crossfade marker and the natural end of a track all agree on one next track. `play()`, `next()`, `previous()` and `jumpTo()` go through the history as decided above; a changed order (`setRules`) restarts the history around the current track.
- **§8.4.** The crossfade reads the upcoming entry instead of asking the order strategy.
- **§9.7.** A **Playback order** card in the playlist dialog's "Playlist" tab, between Volume and Fades: three radio buttons, each with a one-line description below its name.
- **§10.** The new files and the new fixture playlist.

**Plan.**

1. **Server.** `order` in playlist options validation, `Playlist`, `/api/library`, `updatePlaylist` and `PATCH /api/playlists/<id>`. *Tests:* valid and invalid values in files, the default, saving, and the route's `400`.
2. **Order strategies.** `start` and `extend` for the three orders with an injected random function, plus a seeded generator in `test/helpers/`. *Tests:* Ordered fills in order with the cursor at `at`; a Shuffle round holds each track once, starts with `at` when given, and never starts with `last`; Random never repeats `last`; one track never loops; the same seed gives the same entries.
3. **Play history.** *Tests:* Next replays entries after going back; the history extends only past the end; `upcoming` extends once and `next()` then moves there; Previous stops at the first entry; `start(at)` and `setOrder` refill around a track; the 2¹⁶ cap drops only entries before the cursor.
4. **Player and facade.** `PlaylistPlayer` uses the history; `resolvePlaybackRules` reads `order`; `setRules` applies a changed order; `customizePlaylist` accepts `order`; `Soundboard` takes `random`. *Tests:* each order through the player, Previous at the first entry restarting, crossfades into the upcoming entry, a changed order while playing, saving, validation, and the randomized invariant test run with all three orders.
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
