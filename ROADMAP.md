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

### 4. Playlist fade in and fade out

**Goal.** A playlist can fade in when it starts and fade out when it stops, each with its own duration set in the Customize dialog. The plain "Play" and "Stop" (tile clicks, the footer's stop button, the menu items) use them; "Play (Instant)" and "Stop (Instant)" keep cutting at once.

**Already decided** (backlog): stopping during a crossfade lets the fading-out track carry on and fades the incoming one out from its current level over the full fade-out. There is no `stopping` state: a stop marks the playlist idle at once and the fades finish in the background. Playing again during those fades starts a new playback and leaves them alone. Pausing no longer cuts a crossfade.

**Design changes.**

- **§2.3, §5.1, §5.2.** Playlist options gain `fadeIn` and `fadeOut`: seconds, `0` to `30`, default `0`, rounded to 2 decimals, validated like `crossfade`. They are part of `Playlist`, `/api/library` and `PATCH /api/playlists/<id>`.
- **§6.1, §6.2.** `customizePlaylist(playlistId, { …, fadeIn?, fadeOut? })`; `playlist.changed` carries them. `resolvePlaybackRules` reads them (§8.2).
- **§8 PlaylistPlayer:**
  - **Fade-in** on a `'default'` play, and on a jump from idle: the first voice ramps from silence over `fadeIn`.
  - **Fade-out** on a `'default'` stop: the current voice, if audible, moves to the retiring set and ramps to silence from its *current* level over `fadeOut`, cut to the time the track has left. Thanks to the fade-ramp fix, an interrupted fade-in continues down from where it had got to. A paused or still-loading voice is stopped at once, as today.
  - **Retiring voices** keep fading after a stop and after a new play. Only `'instant'` cuts them, as today. The rule that a stop without a fade-out cuts them (`killRetiring` when `fadeOut` is 0) stays, so with fade-out off, Stop still means silence.
  - **Pause** is immediate and ignores the fade settings. It still stops voices that are fading out from a crossfade at once, and it ends a fade-in in progress by setting the voice to full level, so Resume (also immediate) continues at full volume. Pause and resume never need to know about fades.
  - **Invariant (§8 rule 4):** while idle, no voice is *audible*; voices may still be fading out until their deadline (fade + 1 s). After that, nothing is left.
- **§9.7.** The playlist dialog gets **Fade in** and **Fade out** sections. They reuse the Crossfade control, generalized into a seconds control: a slider from 0 to 10 s and a typed value up to 30 s, with no limit from track lengths.

**Owner's decisions (review round 1).**
1. Resume after a pause is immediate.
2. Pause is immediate.
3. Pause and resume always ignore the fade settings. Tracks retiring from a crossfade are stopped at once on pause. This replaces the earlier backlog note that pausing would no longer cut a crossfade.
4. No extra limit on the fade-in for short tracks; the fade-out is cut to the time left.
5. Picking a track while the playlist is stopped acts like starting it: it fades in.
6. Pausing during a fade-in ends the fade-in. After Resume the track plays at full volume.

**Plan.**

1. **Settings.** `fadeIn` and `fadeOut` in validation, `Playlist`, `/api/library`, the playlist `PATCH`, `LibraryModel`, the facade, `OptionsSync` and `resolvePlaybackRules`. *Tests:* as for `crossfade`.
2. **Player.** Fade-in on play, fade-out on stop from the current level and cut to the time left, retiring voices surviving stop, play and pause, the invariant updated. *Tests:* each case on the fake engine, stop during a crossfade (both voices), play again during a fade-out, `'instant'` still cutting everything, and the randomized invariant.
3. **UI.** The shared seconds control and the two sections. *Tests:* the control's helpers, the manual checklist and a headless Chromium run, including measuring the real gain levels of a fade-in and a fade-out.
4. **Design update.** `DESIGN.md` in its own commit; then this proposal and its backlog entry are removed.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. **Decided** lists the owner's answers already given; the notes list what else is known and the questions still to settle.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

#### 4. Playlist fade in and fade out

A fade-in used only when the playlist starts, and a fade-out used only when it stops.

- **Seam:** `PlaybackRules.fadeIn` / `fadeOut` (DESIGN.md §8.2).
- **Decided:**
  - Stopping during a crossfade: the track that was fading out carries on fading out; the track that was fading in stops its fade-in and fades out from its current level over the normal fade-out duration.
  - Pausing during a crossfade no longer cuts the track that is fading out, and a `'default'` stop lets it carry on (today both cut it: `pause()` and `killRetiring` in `resolveTransition`, DESIGN.md §8.1).
  - There is **no `stopping` state.** A stop marks the playlist idle at once; the fading voices just finish in the background (the retiring set). Playing it again while they fade starts a new, separate playback and leaves those fades alone.
- **Notes:** "(Instant)" commands still cut retiring voices, as today (§6.1). Open: does resuming after a pause fade in? Likely not.

#### 5. Track list in the playlist dialog

Every track as an accordion, with one open at a time. The only setting for now is the track's title.

- **Seam:** the playlist dialog (DESIGN.md §9.7) and `PATCH /api/tracks/<id>`; track ids contain `/`, so the whole rest of the path is the id, encoded per segment as the media URLs already are.
- **Notes:** tracks are sorted by path, not title (§2.2), so renaming a track never moves it.

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

- **Seam:** only UI is needed: a track's `gain` from its options file is already applied, multiplied by the playlist's (DESIGN.md §6.4). Saving it needs the track write API from feature 5.

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
