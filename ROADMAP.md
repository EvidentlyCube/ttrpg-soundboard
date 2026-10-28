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

### Track start and end points

**Goal.** In a playlist's Customize dialog, each track can be trimmed like a sound: a start point and an end point choose the part of the file that plays. From then on the trimmed part *is* the track: the footer's time, the progress bar, seeking, Previous's restart, crossfades, looping and "resume where it stopped" all work on that part only.

**What already exists.** Voices take `startAt` and `endAt` (§6.3) and do the work themselves: a stream voice seeks to `startAt` after loading, and its end-point timer pauses it at `endAt` and fires `ended`. So the player needs no timer of its own for the end, unlike what the backlog note assumed. Track options files already accept `startAt` and `endAt` (§2.3) and the validator checks them; the `RangeControl` and `checkClip` from the sound dialog can be reused as they are.

**Design changes.**
- §2.3: tracks no longer ignore `startAt` and `endAt`. `fadeIn` and `fadeOut` stay ignored (open question 2).
- §5.1, §5.2: `LibraryEditor.updateTrack` and the track options endpoint accept `startAt` and `endAt` next to `title`, with the same checks as for sounds (merged with the stored values, at least `MIN_CLIP_MS` apart).
- §6.1, §6.4: `customizeTrack(trackId, { title?, startAt?, endAt? })`, validated by `checkClip` after merging, saved like the title; `playlist.changed` carries the track with its new points. The `saveTrackOptions` payload gains both.
- §6.3: unchanged. Voice `position` and `duration` stay in file time.
- §8.1, §8.2, §8.4: `planTrack` returns the track's points. The player fixes a track's range (`start`, `end`, both in file time, `end` capped at the real file length once the voice has loaded) when the track starts, and passes the points to its voice. Everything the facade reports and accepts is **relative to the range**: `position = voice.position − start`, `duration = end − start`, `seek(0)` is the start point, `crossfadeFrom` and the resume position are relative, and the overlap of a crossfade uses the range length instead of the file duration. A changed point reaches only tracks that start afterwards; the playing one keeps its range (as for sounds, §7). A paused or remembered track returns to its new start instead (open question 6).
- §9.7: the open row of the track accordion replaces its **Progress** card with a **Start and end** card holding one control that both chooses the points and seeks (open question 3). The row header shows no duration; a small "Cropped" bubble marks a track whose points differ from the whole file.
- §10, §11: structure and testing.

**Open questions.**
1. **Header duration.** Decided: no duration in the row header. A small "Cropped" bubble marks a track whose points differ from the whole file.
2. **Track fades.** Decided: no track fades (they are unlikely to matter). The control draws the stretch the crossfade occupies, as the footer's progress bar does.
3. **Where the control goes.** Decided: one control for the points and for seeking, the sound dialog's `RangeControl` over the whole file, in the blue accent. While the track is playing (loading counts as playing), the handles are disabled and invisible, the fields can't be edited, and pressing the bar seeks instead. Otherwise it is the range editor. This replaces the **Progress** card, so the **Start and end** card is the first card of the open row. Interpretation to confirm: a *paused* track is not playing, so it is editable (question 6 depends on this) and cannot be sought from the dialog.
4. **Tracks without a measured duration.** Decided: assume every track has a known duration.
5. **A point beyond the real file.** Decided: treated as for sounds. Points are never rejected against the stored duration; a start at or past the real end ends the track at once (§7). For tracks, the player then moves on.
6. **Editing a track that is stopped or paused.** Decided: changing a point resets that track's position to the start. A stopped playlist that remembers this track as its resume point forgets the position, so the track starts over at its new start. A paused current track goes back to its new start and stays paused. Implementation note: the playing track is never edited (the handles are gone), so this is the only case where a range reaches a track already started.

**Plan.**
1. Backend: `updateTrack` and its HTTP route accept and validate `startAt` and `endAt`; the editable keys for tracks. Tests: saved and merged with the existing file, `endAt` before `startAt` rejected, `null` end stored, unknown keys still rejected, other keys preserved.
2. Frontend model and saving: `customizeTrack` accepts the points, `LibraryModel.updateTrack` applies and checks them, `playlist.changed`, `OptionsSync` and `BackendApi.saveTrackOptions` carry them. Tests with the fake backend, including the debounce and an invalid range.
3. Player: `planTrack` returns the points and the voice gets them; the range is fixed at track start and positions become relative. Tests, first: start applied by the voice and the position starting at 0; `ended` at the end point advances; `duration` and `progress` relative; seek clamped to the range and to the crossfade point; Previous's 3 s rule and restart; crossfade timer and overlap on the range length; looping between the points; resume position relative; an edit resetting a paused track and a remembered resume position to the new start; a start past the real end; the randomized invariant test with points set.
4. UI: the **Start and end** card replacing **Progress** in the track accordion (range editor, or seek bar with crossfade stretch while playing) and the "Cropped" bubble; manual checks added to `TESTING.md`.
5. `DESIGN.md` update.

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. **Decided** lists the owner's answers already given; the notes list what else is known and the questions still to settle.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

#### 11. Track start and end points

As for sounds (DESIGN.md §7, §9.7), per track, shown on or below the track's progress bar.

- **Seam:** `planTrack(track, rules) → { startAt, endAt }` (DESIGN.md §8.2). `startAt` is already applied by seeking after loading.
- **Decided:** the selected range *is* the track as far as playback is concerned. The footer's time, the progress bar and seeking all cover only the part between the start and end points.
- **Decided:** as for sounds, changed points take effect from the next time a track starts; a playing track keeps its range. The voices' `startAt` and `endAt` options (DESIGN.md §6.3) and the dialog's range control can be reused. Track files already accept `startAt`, `endAt`, `fadeIn` and `fadeOut` (§2.3); tracks just ignore them so far.
- **Notes:** `endAt` needs a clock timer bound to the current generation that treats reaching `endAt` like `ended`; a crossfade then starts at `endAt − crossfade`. The track dialog's own editor still shows the whole file, since that is where the points are chosen.
- **Track looping** (DESIGN.md §6.3, §8.1) already loops between a voice's points: a stream voice with an end point seeks back to `startAt` from its end-point timer, and a buffer voice uses `loopStart` and `loopEnd`. Passing the track's points to its voice should be enough, but looping with points needs its own tests and a manual check.

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

Load the next track shortly before the current one ends, for gapless changes.
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

- **Customizable playlist looping.** `PlaybackRules.playlistLooping` is always on "for now" (DESIGN.md §8.2). An option could let a playlist stop after its last track instead.
- **Files whose duration can't be measured.** Bootstrap stores `"duration": null` for them (DESIGN.md §3.5), but the UI assumes every sound has a duration: the sound dialog leaves out its Start and end section for such a sound, and crossfades skip such tracks. Decide how they should be handled, for example by reading the duration in the browser on first play, or by reporting them at startup like unsupported files.
