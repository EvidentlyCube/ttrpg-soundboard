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

### 8. Track looping

**Goal.** A checkbox in the playlist dialog makes the current track repeat until the user moves on (Next, Previous, a track from the list). The track moved to then repeats in turn. Like the other settings, it applies at once, also to the track playing, and is saved 500 ms later.

**Decided** (from the backlog): the option is `trackLooping`; the existing `PlaybackRules.loop` becomes `playlistLooping`, stays `true` and is not customizable; seamless looping is the expected answer for crossfades.

**How a track loops.** The player can't loop a track by starting it again: every start makes a new media element, which has to load before it plays, so a streamed track would fall silent for a moment at every loop. The loop therefore belongs to the voice itself, which the browser can do without a gap: a media element's `loop`, and `AudioBufferSourceNode.loop` with `loopStart` and `loopEnd` for buffers. While a voice loops it never fires `ended`.

**Design changes.**

- **§2.3, §5.1, §5.2.** Playlist options files may hold `trackLooping` (`true` or `false`, default `false`). `Playlist`, `updatePlaylist`, `PATCH /api/playlists/<id>` and `/api/library` carry it.
- **§6.1.** `customizePlaylist(playlistId, { …, trackLooping? })`; `savePlaylistOptions` sends it too.
- **§6.3.** Voices get `setLooping(looping)`. A looping voice starts over at its start point (`startAt`) when it reaches its end, without a gap, and doesn't fire `ended`; `position` jumps back accordingly. Turning looping off lets the current pass play to the end and fire `ended` as usual. `FakeAudioEngine` models it.
- **§8.1, §8.2.** `PlaybackRules` gets `trackLooping` (read from the playlist), and `loop` is renamed `playlistLooping`. Every new voice gets `setLooping(rules.trackLooping)`; `setRules` applies a change to the current voice at once. Next, Previous and choosing a track work as before, following the play history and the order.
- **§8.4.** While the current track loops, there is no crossfade at its end: no crossfade timer and no crossfade marker on the progress bar (`crossfadeFrom` is `null`). Crossfades still happen when the user moves to another track.
- **§9.2.** The progress bar and time jump back to the start at each loop, since the position does.
- **§9.7.** A checkbox in the Playback order card, below the radio buttons: "Repeat the current track", with the description "It plays again until you move to another track." A shared `checkbox()` part goes in `customize-parts.js` next to `radioGroup`, for the next features.

**Owner's answers.**

1. **No crossfade at the loop point:** a looping track loops seamlessly.
2. **Toggling applies at once.** During a crossfade the incoming track is already the current one, so it is the one that loops; the outgoing track just finishes its fade.
3. **The checkbox goes in the Playback order card.**
4. **MP3 gaps are accepted** as the browser plays them; start and end points can trim a track later.
5. **Looping between start and end points is left to feature 11,** with a note there.

**Plan.**

1. **Server.** `trackLooping` in validation, `Playlist`, `/api/library`, `updatePlaylist` and `PATCH /api/playlists/<id>`. *Tests:* valid and invalid values, the default, saving.
2. **Engine port.** `setLooping` in the port, `FakeAudioEngine` and `WebAudioEngine`. *Tests:* the fake engine wraps the position and never fires `ended` while looping, and fires it once looping is turned off. `WebAudioEngine` is checked in headless Chromium.
3. **Player and facade.** Rename `loop` to `playlistLooping`; `trackLooping` in the rules, set on every new voice and changed at once by `setRules`; no crossfade timer or marker while looping; `customizePlaylist` accepts it. *Tests:* a looping track plays past its end without moving on; Next moves on and the new track loops; turning looping off mid-track moves on at the end; crossfades still apply to manual changes; saving and validation; the randomized invariant test with looping on in some runs.
4. **UI.** The `checkbox()` part and the checkbox in the Playback order card, plus checks in `TESTING.md`. Checked with the manual checklist and a headless Chromium run.
5. **Design update.** `DESIGN.md` in its own commit. Then this proposal and its backlog entry are removed.

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. **Decided** lists the owner's answers already given; the notes list what else is known and the questions still to settle.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

#### 8. Track looping

A checkbox: the current track repeats until the user moves to another one. That track then repeats in turn.

- **Decided:** the existing `PlaybackRules.loop` (whether the play history is extended past its first fill, DESIGN.md §8.1) is renamed `playlistLooping`. It stays `true` and is not customizable. The new option is `trackLooping`.
- **Notes:** with a crossfade, does a looping track crossfade into itself, or loop seamlessly? Seamless is the expected answer; it interacts with start and end points (feature 11).

#### 9. What "stop" does

Radio buttons in the playlist dialog:

- **Pause:** remember the position; playing again continues from there.
- **Reset track:** remember the track; playing again starts it from the beginning.
- **Reset playlist:** forget everything; playing again starts as if for the first time. This is today's behavior, and the likely default.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8). Starting a playlist currently always begins at the order strategy's first track.
- **Decided:** nothing is remembered across a page reload.
- **Notes:** "stopped but remembering" is a new look for the idle tile, showing that it will resume. Does "Stop (Instant)" follow the setting too? Probably yes, since "instant" is about fades, not about forgetting. The play history (DESIGN.md §8.1) is kept or cleared along with the position.

#### 10. Test playback in the track list

A play/stop button next to each track in the playlist dialog, which starts or stops it immediately. The open accordion shows a progress bar with seeking. Everything reflects the playlist's real state, so a track started from the footer shows as playing in the dialog, and when the track ends the playlist carries on as usual.

- **Seam:** the existing facade covers it: `jumpToTrack(id, i, 'instant')`, `stopPlaylist(id, 'instant')`, `seek`, and the `playlist.stateChanged` and `playlist.progress` events. This is mostly UI work.

#### 11. Track start and end points

As for sounds (DESIGN.md §7, §9.7), per track, shown on or below the track's progress bar.

- **Seam:** `planTrack(track, rules) → { startAt, endAt }` (DESIGN.md §8.2). `startAt` is already applied by seeking after loading.
- **Decided:** the selected range *is* the track as far as playback is concerned. The footer's time, the progress bar and seeking all cover only the part between the start and end points.
- **Decided:** as for sounds, changed points take effect from the next time a track starts; a playing track keeps its range. The voices' `startAt` and `endAt` options (DESIGN.md §6.3) and the dialog's range control can be reused. Track files already accept `startAt`, `endAt`, `fadeIn` and `fadeOut` (§2.3); tracks just ignore them so far.
- **Notes:** `endAt` needs a clock timer bound to the current generation that treats reaching `endAt` like `ended`; a crossfade then starts at `endAt − crossfade`.
- **Track looping (feature 8)** loops voices with the browser's own looping, which covers the whole file. With start and end points, a looping stream voice must instead seek back to `startAt` when it reaches `endAt` (from the end-point timer it already has); buffer voices can use `loopStart` and `loopEnd`. The track dialog's own editor still shows the whole file, since that is where the points are chosen.

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
