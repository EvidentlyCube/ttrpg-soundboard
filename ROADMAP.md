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

### 3. Playlist crossfade

**Goal.** A playlist can have a crossfade, set in its Customize dialog. When one track gives way to the next, whether it ended on its own or Next, Previous or a pick from the track list moved on, the old track fades out while the new one fades in over that time. The "(Instant)" commands still cut over at once.

**Design changes.**

- **§2.3, §5.1, §5.2.** Playlist options gain `crossfade`: seconds, a number from `0` to `30`, default `0` (no crossfade). Validation is fatal at startup like the other keys. It is part of `Playlist`, `/api/library` and `PATCH /api/playlists/<id>`; `PATCH /api/sounds/<id>` keeps rejecting it.
- **§6.1, §6.2.** `customizePlaylist(playlistId, { title?, gain?, crossfade? })`; `playlist.changed` carries it. A new value takes effect at once: on the next change of track, and on the end of the track playing now.
- **§8.2 Extension points.** `resolvePlaybackRules(playlist)` reads `crossfade` from the playlist instead of always returning the defaults. `PlaylistPlayer.setRules(rules)` replaces the rules of a playing playlist.
- **§8 PlaylistPlayer**, the core of the feature:
  - **At a natural end.** Once a track has loaded and plays, the player sets a clock timer, tied to the current generation, for `duration − position − crossfade`. When it fires, the next track starts and the two fade across. Seek, pause, resume and a change of the setting re-plan the timer; leaving `playing` cancels it. If the duration is unknown or the timer is late, `ended` still advances as today (then the new track only fades in).
  - **When the fades start.** Both fades begin when the new track actually starts playing (`loaded`), not when it is requested. Until then the old track plays on at full volume, so no part of the crossfade is spent waiting for the file. The old track's fade-out is shortened to the time it has left, so it never stops mid-fade.
  - **Manual changes.** Next, Previous and jumps with `'default'` crossfade the same way, if the old track is audible. A paused or still-loading old track is stopped at once, as today.
  - **Short tracks.** The crossfade used for a track is at most half its length, so a short track still plays on its own for a while.
  - **One track, looping.** A playlist with one track crossfades into a new start of the same track.
  - The retiring set, its deadline (fade + 1 s) and its cap of 4 already cover a crossfade, as does `'instant'` cutting every fading voice.
- **§9.7.** The playlist dialog gets a **Crossfade** section: a slider from 0 to 10 s in 0.5 s steps and a number field next to it for exact values up to 30 s, shown as `2.5 s`; `0` reads "Off".

**Open questions.**

1. **Stopping during a crossfade.** The owner's note says a stop while the next track fades in "should stop immediately". *Recommended: until fade-out exists (feature 4), a `'default'` stop also cuts the track that is fading out*, so Stop always means silence. Feature 4 then changes it to "the fading-out track carries on", as already decided there.
2. **Pausing during a crossfade.** *Recommended: Pause also stops the track that is fading out*, so Pause means silence and Resume continues only the new track. The alternative is letting the old track finish its fade while the new one is paused, which sounds odd.
3. **Range.** *Recommended: 0 to 30 s stored; the slider covers 0 to 10 s*, which is where nearly all crossfades are, and the number field allows longer ones.
4. **Short tracks.** *Recommended: at most half the track's length*, as above. The alternative is skipping the crossfade entirely for tracks shorter than twice its length.
5. **Fades start on `loaded`.** *Recommended*, as above. The simpler alternative starts both fades at the request; with a local server the difference is a few hundred milliseconds, but Safari may take longer to start a stream.

**Plan.**

1. **Format.** `crossfade` in playlist validation, `Playlist`, `/api/library` and the playlist `PATCH` (and not the sound one). *Tests:* validation and messages, bootstrap, the editor keeping other keys, the API.
2. **Rules at runtime.** `resolvePlaybackRules` reads the playlist; `PlaylistPlayer.setRules`; `customizePlaylist` and `OptionsSync` carry `crossfade`; `LibraryModel` validates it. *Tests:* rules resolution, commands and the facade.
3. **Crossfading in the player.** Fades that start on `loaded` with the old track's fade-out shortened to its time left; the natural-end timer and its re-planning on seek, pause, resume and rule changes; the short-track limit; stop and pause cutting fading voices (per questions 1 and 2). *Tests:* each case on the fake clock and engine, stale timers from replaced tracks ignored, and the randomized invariant extended with crossfades and natural ends.
4. **UI.** The Crossfade section in the playlist dialog. *Tests:* formatting and parsing of seconds; the manual checklist and a headless Chromium run.
5. **Design update.** `DESIGN.md` in its own commit; then this proposal and its backlog entry are removed.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. **Decided** lists the owner's answers already given; the notes list what else is known and the questions still to settle.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

#### 3. Playlist crossfade

A crossfade duration in the playlist dialog, used when one track gives way to the next.

- **Seam:** `PlaybackRules.crossfade` and `resolveTransition()` (DESIGN.md §8.2). The retiring set, its deadlines and its cap, and `Voice.rampGain()` already exist and are tested with non-zero rules.
- **Notes:**
  - At the natural end of a track the next one must start at `end − crossfade`, before the current one ends, rather than on `ended`. This needs the duration, so it can only be scheduled after `loaded`. A track shorter than the crossfade needs a rule; the likely answer is shortening the crossfade to fit.
  - Stopping while the next track is fading in stops everything immediately. Until feature 4 exists, a stop never fades.
  - Manual Next, Previous and jumps crossfade too, since they use `'default'`; the "(Instant)" items do not.

#### 4. Playlist fade in and fade out

A fade-in used only when the playlist starts, and a fade-out used only when it stops.

- **Seam:** `PlaybackRules.fadeIn` / `fadeOut` (DESIGN.md §8.2).
- **Decided:**
  - Stopping during a crossfade: the track that was fading out carries on fading out; the track that was fading in stops its fade-in and fades out from its current level over the normal fade-out duration.
  - There is **no `stopping` state.** A stop marks the playlist idle at once; the fading voices just finish in the background (the retiring set). Playing it again while they fade starts a new, separate playback and leaves those fades alone.
- **Notes:** "(Instant)" commands still cut retiring voices, as today (§6.1). Open: does resuming after a pause fade in? Likely not.

#### 5. Track list in the playlist dialog

Every track as an accordion, with one open at a time. The only setting for now is the track's title.

- **Seam:** the playlist dialog (DESIGN.md §9.7) and `PATCH /api/tracks/<id>`; track ids contain `/`, so the whole rest of the path is the id, encoded per segment as the media URLs already are.
- **Notes:** tracks are sorted by path, not title (§2.2), so renaming a track never moves it.

#### 6. Sound start and end points

A two-handle range slider plus two number fields, in milliseconds, in the sound dialog. Playback starts and stops at those points.

- **Seam:** `planTrack()` (DESIGN.md §8.2) for playlists, and new start and end values for `SoundPlayer`.
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

- **Seam:** `PlaylistPlayer` (DESIGN.md §8); the crossfade work (feature 3) already has to start the next voice early.

#### Committed browser smoke tests

The UI and `WebAudioEngine` have been checked by driving the real page in headless Chromium over the DevTools protocol, using only Node's built-in `WebSocket`. That script lives outside the repository.

- **Notes:** commit it (for example as `scripts/browser-smoke/` with an `npm run smoke` script) so the checks can be repeated. It needs a local Chromium and stays out of `npm run check`. See [`TESTING.md`](TESTING.md). It becomes more valuable as the dialogs add UI.

#### Media element reuse for Safari (only if needed)

New media elements are assumed to play in Safari once the audio context has been unlocked (DESIGN.md §12). If manual testing shows otherwise, `WebAudioEngine` could create a small pool of elements during a click and reuse them.
