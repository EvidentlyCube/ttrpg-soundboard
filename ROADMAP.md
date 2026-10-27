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

### 6. Sound start and end points

**Goal.** In a sound's Customize dialog, choose the part of the file that plays: a start point and an end point, set with a two-handle range slider or typed in milliseconds. Every press of the sound then plays only that part. Like the other settings, a change applies at once and is saved 500 ms later.

**Design changes.**

- **§2.3.** Sound and track options files may hold `startAt` (seconds, default `0`) and `endAt` (seconds, or `null` for the end of the file, which is the default). The app writes both rounded to 3 decimals, so whole milliseconds survive. Validation: `startAt` a number ≥ 0, `endAt` a number or `null`, and `endAt` at least 0.01 s after `startAt` when both are numbers (question 5). The points are not checked against `duration`, which is only an estimate for some MP3s. Track files accept the keys too, but tracks ignore them until feature 11.
- **§5.1.** `AudioFile` gets `startAt` and `endAt`. `LibraryEditor.updateSound(id, { title?, gain?, startAt?, endAt? })` validates the merged result, so moving only the start past the stored end is rejected. `updateTrack` still accepts only `title`.
- **§5.2.** `PATCH /api/sounds/<id>` accepts `startAt` and `endAt`. `/api/library` includes both for every sound and track.
- **§6, §6.1.** `customizeSound(soundId, { title?, gain?, startAt?, endAt? })`. Invalid points are an `InvalidCommandError`. `saveSoundOptions` sends the points along with the title and gain, as part of the sound's full editable options. Command validation gets a "number or `null`" field type for `endAt`.
- **§6.3.** `createStreamVoice` and `createBufferVoice` take optional `startAt` and `endAt`. The voice starts at `startAt` and treats reaching `endAt` as its end: it stops and fires `ended`. `position` stays in file time.
  - **Buffer voices** pass the range to `AudioBufferSourceNode.start(0, offset, endAt − offset)`, so the audio thread cuts it to the sample.
  - **Stream voices** seek to `startAt` on `loadedmetadata`, before any audio plays. They end through a timer set on `playing` from the time left, and set again on `seek`; `pause` and `stop` clear it. This is accurate to a few tens of milliseconds while the window is in front. In a background tab Safari slows timers down, so a streamed sound can overrun its end there.
  - `FakeAudioEngine` models both: a voice's position starts at `startAt` once loaded, and `ended` fires when it reaches `endAt`.
- **§7.** `SoundPlayer` passes the sound's points to every new instance. Instances already playing keep the points they started with (question 2). A start point at or past the real end of the file ends the instance right away, like a file that ended.
- **§9.7.** The sound dialog gets a **Start and end** section below the volume:
  - **A range slider** (`ui/range-control.js`) over the sound's stored duration, with two handles that cannot cross. Dragging a handle moves it, and pressing the bar moves the nearer handle there. The part between the handles is lit in the sound's amber, and the rest is dimmed.
  - **Handle keyboard:** each handle is a `role="slider"`. The arrow keys step 10 ms, Shift + arrow steps 100 ms, and Home and End go to the handle's limits.
  - **Two number fields,** "Start" and "End", in whole milliseconds. Each applies its value on Enter or when it loses focus. A value out of range is clamped, and text that can't be read is marked red and not sent, like the gain readout.
  - **A length readout** below, e.g. "Plays 1,250 ms of 4,210 ms".
  - **A Reset button** that sets the start to `0` and the end to `null`.
  - **Dragging the end handle all the way right** stores `null`, so a replaced, longer file still plays to its end.
  - The pure mapping and step functions live in `ui/range-scale.js`, with unit tests.
- **§10.** The new files.

**Open questions.**

1. **What the file stores.** *Recommended: seconds with 3 decimals, as `startAt` and `endAt`*, matching `duration`, the playlist timings and `planTrack`'s names, so feature 11 can reuse them for tracks. The dialog shows and accepts milliseconds, as asked. The alternative is whole milliseconds in the file, which would be the only value there in that unit.
2. **Changes while a sound is playing.** *Recommended: only later presses use new points.* A playing instance keeps its range, so a sound never jumps or cuts off while you drag a handle. To hear the change, press Play again. Volume, by contrast, applies to playing instances, because changing it can't make anything jump.
3. **Sounds with an unknown duration** (`duration: null`, because the file couldn't be measured). *Recommended: the slider is disabled with a note saying so, and only the number fields work, with no upper limit.* Playback works as usual: an end past the real end just plays to the end of the file.
4. **Clicks at the cut points.** Cutting a waveform anywhere but a silent moment can produce an audible click. *Recommended: no de-click fades for now.* Add a few milliseconds of fade later if clicks turn out to be audible in practice. It is a contained change in the engine (§6.3).
5. **Minimum length.** *Recommended: at least 10 ms between the points*, enforced by the slider, the fields and the server, so a sound can never be set to play nothing.

**Plan.**

1. **Server.** Validation of `startAt` and `endAt` in options files, `AudioFile` and `/api/library`, `LibraryEditor.updateSound` and `PATCH /api/sounds/<id>`. *Tests:* valid and invalid points in files (bootstrap stops on them), rounding, a partial update checked against the stored other point, `null` clearing the end, tracks rejecting the keys in `updateTrack`, and the route's `400`s.
2. **Engine port.** `startAt` and `endAt` on both voice factories in the port, `FakeAudioEngine` and `WebAudioEngine`. *Tests:* the fake engine's model (start position, `ended` at the end point, after pause and resume, after a seek). `WebAudioEngine` is checked in headless Chromium and by the manual checklist.
3. **Logic.** The `sound.customize` command with the points and the nullable field type, `LibraryModel.updateSound`, `SoundPlayer` passing the points, and `OptionsSync` saving them. *Tests:* validation (negative, crossed, too close, partial changes against the current points), new presses using new points while playing ones keep theirs, debounced saving of the full options, and `HttpBackendApi` against the real server.
4. **UI.** `range-scale.js` and its tests, the range control, and the dialog section, plus new checks in `TESTING.md`. *Tests:* unit tests for the scale. The rest is checked with the manual checklist and a headless Chromium run.
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

#### 6. Sound start and end points

A two-handle range slider plus two number fields, in milliseconds, in the sound dialog. Playback starts and stops at those points.

- **Seam:** `planTrack()` (DESIGN.md §8.2) for playlists, and new start and end values for `SoundPlayer`. Every sound's `duration` is already known to the browser (§3.5), so the slider can show the whole length before the sound is played.
- **Notes:** buffer voices can start and stop exactly (`AudioBufferSourceNode.start(when, offset, duration)`). Streamed voices seek after loading and need a timer for the end, which the port should hide behind one `createVoice({ startAt, endAt })` so `SoundPlayer` does not care which kind it has. Previewing uses the dialog's existing play button.

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

As for sounds (feature 6), per track, shown on or below the track's progress bar.

- **Seam:** `planTrack(track, rules) → { startAt, endAt }` (DESIGN.md §8.2). `startAt` is already applied by seeking after loading.
- **Decided:** the selected range *is* the track as far as playback is concerned. The footer's time, the progress bar and seeking all cover only the part between the start and end points.
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
  - Open: do sounds get waveforms too, for their start and end points (feature 6)?

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
