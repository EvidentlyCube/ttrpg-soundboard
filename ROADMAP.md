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

### 1. Customize dialog for sound effects

**Goal.** "Customize" in a sound's context menu opens a dialog where the sound can be renamed and given its own volume, including a boost above its original loudness. There is no Save button: every change takes effect at once (the tile's title, the loudness of the sound, even while it plays) and is saved to the sound's options file shortly after.

**Owner's decisions (review round 1).**
- Volume range −30 to +12 dB in 0.5 dB steps. Clipping is allowed, with a warning in the dialog.
- Every change applies immediately and is saved with a 500 ms debounce. Sorting by the new title waits until the dialog closes.
- An empty title is never saved: the last valid title stays in effect, and closing the dialog with an empty field restores it.
- A play/stop button in the dialog.
- Store the volume in the form the browser's audio API uses; convert to decibels only for display.

**Design changes.**

- **§2.3 File formats.** Sound options gain an optional `gain`:
  ```json
  { "title": "Big Explosion", "gain": 0.5957 }
  ```
  - `gain` is the linear multiplier a Web Audio `GainNode` takes: `1` plays the file as recorded, `2` doubles the amplitude. Missing means `1`.
  - Validation (still fatal at startup): a finite number from **0 to 4**. 4 is just above +12 dB; values below the slider's range are accepted and the slider shows them at its bottom end.
  - Written rounded to 4 decimal places, so files stay readable and converting back to dB gives the same 0.5 dB step.
  - It is deliberately not called `volume`: the volumes in `.soundboard` are slider positions (§6.4), a different thing.
- **§5.1 Domain model.** `AudioFile` gains `gain`. The server's `Library` becomes changeable at runtime: a sound's title and gain can be updated, and `sounds` is sorted again after a rename.
- **§5.2 HTTP API.**
  - `/api/library` includes `gain` for each sound and each track, so the format doesn't change again for per-track volume.
  - New: `PATCH /api/sounds/<encoded id>` with the body `{ title?, gain? }`. The title is trimmed. The same validation as the options file applies; unknown keys, an empty title or an out-of-range gain give `400`, an unknown sound `404`. The change is merged into the options file (read, merge, atomic write, unknown keys kept, §2.3) and the in-memory library is updated. The response is the updated sound. Writes to one file are serialized like the settings writes.
- **§6.1 Facade API.**
  - `customizeSound(soundId, { title?, gain? })` applies the change in memory **at once**: playing instances change loudness and new ones start at the new gain. An empty or whitespace-only title is an `InvalidCommandError`; the UI never sends one.
  - The save is debounced per sound, 500 ms after the last change, with one request in flight per sound, so saves can't arrive out of order. This reuses the pattern of the volume save (`SettingsSync`, §6.4), and `flushSettings()` on `pagehide` flushes these too.
  - The facade's library is kept sorted, so `getLibrary()` is always correct. *When* the screen re-sorts is the UI's choice (below).
  - `BackendApi` gains `saveSoundOptions(soundId, changes)`.
- **§6.2 Events.**
  - `sound.changed` `{ sound }` right after each accepted change.
  - `sound.saveFailed` `{ soundId, message }`. The change stays in effect in memory, and the next change retries with the full set of values.
- **§6.3 AudioEngine port.** Each voice gets a second gain stage for its own volume, separate from the one used for fades. A playlist fading a track then never needs to know the track's volume, and the later playlist and track volumes fit the same slot:
  - `createStreamVoice({ url, bus, gain })` and `createBufferVoice({ buffer, bus, gain })`, where `gain` defaults to `1`;
  - `voice.setGain(gain)`, smoothed like the bus gains (`setTargetAtTime`), so dragging the slider never clicks.

  The graph becomes `source → voice gain → voice fade → bus → master`.
- **§6.4 Volume.** A section on item volumes: stored as linear gain, shown as decibels (`dB = 20 · log10(gain)`, `gain = 10^(dB / 20)`), the −30 to +12 dB range of the controls, and clipping above 0 dB.
- **§7 SoundPlayer.** New instances start at the sound's gain; a change is applied to the instances already playing.
- **§9.3 Context menus.** "Customize" in the sound menu is enabled. The playlist one stays a stub until feature 2.
- **New §9.7 Dialogs.** A shared, centered modal `Dialog` component, which every later Customize dialog reuses:
  - It has a title, a body, and a close button (×). Esc and a click on the backdrop close it too; nothing can be lost, since every change is already applied.
  - Closing it flushes any pending save at once.
  - A small status line shows "Saving…", "Saved" or the error from `sound.saveFailed`.
  - Opening it closes any open popup. If the system suspends audio while it is open, the resume splash covers it and the dialog stays.
- **The sound dialog** contains:
  - **Title:** a text field, focused on open, with the file name shown below it for reference. Each edit is sent as you type. While the field is empty it is marked invalid and nothing is sent; the tile keeps the last valid title, and closing the dialog puts that title back in the field.
  - **Volume:** a slider from −30 to +12 dB in 0.5 dB steps with a mark at 0 dB, and a number field next to it, kept in sync. Values are shown as `+3.0 dB`, `0 dB` and `−12.5 dB`. Double-clicking the slider resets it to 0 dB. Above 0 dB a warning reads "Boosting can distort loud sounds."
  - **A play/stop button**, using `playSound` and `stopSound`, to hear the sound while adjusting it.
- **Sorting on screen.** While the dialog is open, the tile's title updates in place. When the dialog closes, the sound grid is redrawn in the library's sorted order, so the tile moves only then.

**Open questions.** None left from round 1. One small point to confirm: the browser needs its own copy of the title sort (the same collator as §2.2), because it can't load files from `src/`. *Recommended:* a few lines in `public/app/logic/`, plus a test that checks both sorts agree.

**Plan.**

1. **Options file and library format.** `gain` in validation (type, range, messages), in the server's `AudioFile` and in `/api/library`. *Tests:* validation messages, bootstrap rejecting an out-of-range value, the library JSON with and without `gain`.
2. **Write API.** `PATCH /api/sounds/<id>`: validation, rounding, merging into the options file with unknown keys kept, re-sorting after a rename, serialized writes to one file, and the status codes listed above. *Tests:* against the real server and a temp copy of the fixture, including two overlapping saves to the same sound ending with the newer values.
3. **Voice gain in the engine port.** The `gain` option and `setGain()` on the port, in `FakeAudioEngine` (which records them) and in `WebAudioEngine` (the extra smoothed gain node). `gainToDb()` and `dbToGain()` in `logic/volume.js`. *Tests:* the conversions, and the fake recording gains. `WebAudioEngine` goes on the manual checklist.
4. **Sound gain in playback.** `SoundPlayer` starts instances at the sound's gain and applies changes to playing instances. *Tests:* new and playing instances, buffered and streamed, a sound without `gain`.
5. **Facade and saving.** The `customizeSound` command with validation; the library kept sorted with the browser-side sort; `sound.changed`; the debounced per-sound save with one request in flight, flushing, and `sound.saveFailed`; `saveSoundOptions` in the `BackendApi` port, `HttpBackendApi` and the fake. *Tests:* immediate effect, empty titles rejected, the debounce and merging of changes, out-of-order protection, failures and retry, flush, the sort agreeing with the server's, and `HttpBackendApi` against the real server.
6. **UI.** The shared `Dialog`, a reusable dB volume control (slider, number field, warning), the sound dialog, the enabled menu item, tile titles updating in place, and the grid re-sorting when the dialog closes. dB formatting and parsing go in `ui/format.js`. *Tests:* formatting and parsing of dB values. The rest goes on the manual checklist in `TESTING.md`.
7. **Design update.** `DESIGN.md` in its own commit; then this proposal is removed.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. **Decided** lists the owner's answers already given; the notes list what else is known and the questions still to settle.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as in feature 1. Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

#### 2. Customize dialog for playlists

Rename the playlist and set its volume, using the dialog and dB control from feature 1.

- **Seam:** the shared `Dialog` and volume control, the `PATCH` pattern (`PATCH /api/playlists/<id>`, written to `<dir>.json`), and the per-voice volume slot from feature 1.
- **Notes:** the playlist gain can simply be multiplied into each voice's gain (`playlist gain × track gain`), with no extra gain node per playlist. Changing it while playing updates the current voice and any voices fading out. Tracks are sorted by path, not title (§2.2), so renaming a track never moves it.

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

- **Seam:** `PATCH /api/tracks/<id>`; track ids contain `/`, so the whole rest of the path is the id, encoded per segment as the media URLs already are.

#### 6. Sound start and end points

A two-handle range slider plus two number fields, in milliseconds, in the sound dialog. Playback starts and stops at those points.

- **Seam:** `planTrack()` (DESIGN.md §8.2) for playlists, and new start and end values for `SoundPlayer`.
- **Notes:** buffer voices can start and stop exactly (`AudioBufferSourceNode.start(when, offset, duration)`). Streamed voices seek after loading and need a timer for the end, which the port should hide behind one `createVoice({ startAt, endAt })` so `SoundPlayer` does not care which kind it has. Previewing from the dialog uses the play button from feature 1.

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

- **Seam:** the per-voice gain from feature 1, multiplied by the playlist gain from feature 2.

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
