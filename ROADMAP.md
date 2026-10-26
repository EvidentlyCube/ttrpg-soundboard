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

**Goal.** "Customize" in a sound's context menu opens a dialog where the sound can be renamed and given its own volume, including a boost above its original loudness. The volume has a slider and a number field, both in decibels. Moving the slider is heard straight away on the sound if it is playing; **Save** writes both values to the sound's options file, and **Cancel** puts everything back.

**Why decibels.** 0 dB means "as recorded"; each 6 dB roughly doubles or halves the loudness. That reads the same at every level, while a percentage beyond 100 % does not say much ("is 180 % twice as loud?"). The gain is `10 ** (dB / 20)`, so +6 dB ≈ 2× and +12 dB ≈ 4× the amplitude. The slider is linear in dB, which is also linear in how loud it sounds.

**Design changes.**

- **§2.3 File formats.** Sound options gain an optional `volumeDb`:
  ```json
  { "title": "Big Explosion", "volumeDb": -4.5 }
  ```
  Missing means `0`. Validation (still fatal at startup): a finite number from **−30 to +12**.
- **§5.1 Domain model.** `AudioFile` gains `volumeDb`. The server's `Library` becomes changeable at runtime: a sound's title and volume can be updated, and `sounds` is sorted again after a rename.
- **§5.2 HTTP API.**
  - `/api/library` includes `volumeDb` for each sound (and track, so the format does not need to change again for per-track volume).
  - New: `PATCH /api/sounds/<encoded id>` with the body `{ title?, volumeDb? }`. The title is trimmed. The same validation as the options file applies; unknown keys, an empty title or an out-of-range volume give `400`, an unknown sound `404`. The change is merged into the options file (read, merge, atomic write, unknown keys kept, §2.3), the in-memory library is updated, and the response is the updated sound. Writes to one file are serialized like the settings writes.
- **§6.1 Facade API.**
  - `customizeSound(soundId, { title, volumeDb })` sends the change to the server. Like every command it returns at once; the outcome arrives as an event.
  - `previewSoundVolume(soundId, volumeDb | null)` changes the volume in memory only, for playing and newly started instances. `null` ends the preview and goes back to the saved value. Nothing is sent to the server.
  - `BackendApi` gains `saveSoundOptions(soundId, changes)`.
- **§6.2 Events.**
  - `library.changed` `{ library }` after a save succeeds. The page receives the whole re-sorted library, which is simplest for the UI and rare enough to be cheap.
  - `sound.customizeFailed` `{ soundId, message }`.
- **§6.3 AudioEngine port.** Each voice gets a second gain stage for its own volume, separate from the existing one used for fades. That way a playlist fading a track never has to know the track's volume, and the later per-playlist and per-track volumes fit the same slot:
  - `createStreamVoice({ url, bus, volume })` and `createBufferVoice({ buffer, bus, volume })`, where `volume` is a linear gain that defaults to `1`;
  - `voice.setVolume(gain)`, smoothed like the bus gains, so dragging the slider never clicks.

  The graph becomes `source → voice volume → voice fade → bus → master`.
- **§6.4 Volume.** A section on item volumes: the dB range, `dbToGain()`, and the fact that a boost above 0 dB can clip on files that are already loud (see the open questions).
- **§7 SoundPlayer.** New instances start at the sound's volume (or the preview value); a volume change or preview is applied to the instances already playing.
- **§9.3 Context menus.** "Customize" in the sound menu is enabled. The playlist one stays a stub until feature 2.
- **New §9.7 Dialogs.** A shared, centered modal `Dialog` component, reused by every later Customize dialog:
  - it has a title, a body, and Cancel and Save buttons; Enter saves and Esc cancels;
  - a click on the backdrop does **nothing**, so a stray click never loses edits;
  - while saving, the buttons are disabled; a failure shows the message inside the dialog and keeps it open;
  - opening it closes any open popup. If the system suspends audio while it is open, the resume splash covers it and the dialog stays.
- **The sound dialog** contains:
  - **Title:** a text field, focused on open. The file name is shown below it for reference. Save is disabled while it is empty.
  - **Volume:** a slider from −30 to +12 dB in 0.5 dB steps with a mark at 0 dB, and a number field next to it, kept in sync. Values are shown as `+3.0 dB`, `0 dB` and `−12.5 dB`. Double-clicking the slider resets it to 0 dB.
  - **A play/stop button** to hear the sound while adjusting it.

**Open questions.**

1. **Volume range.** *Recommended: −30 to +12 dB, in 0.5 dB steps.* −30 dB is about 3 % amplitude, quiet enough for a background sound; +12 dB is 4× amplitude, which is plenty to rescue a quiet recording. A wider range only makes the slider coarser.
2. **Clipping.** A boosted loud file distorts. *Recommended: accept it for now, and say so in a small hint under the slider when the value is above 0 dB.* A limiter on the master bus (a `DynamicsCompressorNode`) would prevent it but colors the sound of everything. It could be a later preference.
3. **Live preview of the volume.** *Recommended: yes, as described above.* Without it, tuning a sound means saving, closing, playing, and reopening. The title is applied only on Save, because sounds are sorted by title and the tile would jump around while you type.
4. **Play button in the dialog.** *Recommended: yes.* It reuses `playSound` and `stopSound`; the tile's stop button keeps working as usual.
5. **Clearing the title.** *Recommended: not allowed, Save stays disabled.* A "Reset to file name" button could be added later if wanted.
6. **Storing dB rather than a gain.** *Recommended: `volumeDb`, as above.* It is what the UI shows, round numbers stay round in the file, and the unit is in the key name for anyone editing the file by hand.

**Plan.**

1. **Options file and library format.** `volumeDb` in validation (range, type, error messages), in the server's `AudioFile` and in `/api/library`. *Tests:* validation messages, bootstrap rejecting an out-of-range value, the library JSON with and without `volumeDb`.
2. **Write API.** `PATCH /api/sounds/<id>`: validation, merging into the options file with unknown keys kept, re-sorting after a rename, serialized writes to one file, and the status codes listed above. *Tests:* against the real server and a temp copy of the fixture, including two overlapping saves to the same sound ending with the newer values.
3. **Voice volume in the engine port.** The `volume` option and `setVolume` on the port, in `FakeAudioEngine` (which records them) and in `WebAudioEngine` (the extra gain node, smoothed). `dbToGain()` in `logic/volume.js`. *Tests:* `dbToGain`, and the fake recording volumes; `WebAudioEngine` goes on the manual checklist.
4. **Sound volume in playback.** `SoundPlayer` starts instances at the sound's volume and applies changes and previews to playing instances. *Tests:* new and playing instances, ending the preview, a sound without `volumeDb`.
5. **Facade.** `customizeSound` and `previewSoundVolume` commands with validation, `saveSoundOptions` in the `BackendApi` port, `HttpBackendApi` and the fake, then `library.changed` and `sound.customizeFailed`. *Tests:* command validation, success and failure events, the library re-sorted after a rename, the preview never reaching the server, `HttpBackendApi` against the real server.
6. **UI.** The shared `Dialog`, a reusable dB volume control (slider and number field), the sound dialog, the enabled menu item, and the sound grid re-rendering on `library.changed`. dB formatting and parsing go in `ui/format.js`. *Tests:* formatting and parsing of dB values; the rest goes on the manual checklist in `TESTING.md`.
7. **Design update.** `DESIGN.md` in its own commit, then this proposal is removed.

---

## Backlog

### Planned, in the owner's order

These are the next features, in roughly the order they will be built. Each will get its own proposal when its turn comes. The notes list what is already known and the questions to settle at that point.

#### 2. Customize dialog for playlists

Rename the playlist and set its volume, using the dialog and dB control from feature 1.

- **Seam:** the shared `Dialog` and volume control, the `PATCH` pattern (`PATCH /api/playlists/<id>`, written to `<dir>.json`), and the per-voice volume slot from feature 1.
- **Notes:** the playlist volume can simply be added into each voice's volume (`playlist dB + track dB`), with no extra gain node per playlist. Changing it while playing updates the current voice and any voices fading out.

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
- **Notes:**
  - Stopping during a crossfade, as the owner described: the track that was fading out simply carries on fading out; the track that was fading in stops its fade-in and fades out from its current level.
  - Open: is the fade-out from a partial level the full fade-out duration, or shortened in proportion? Does resuming after a pause fade in?
  - A fade-out probably wants a visible `stopping` state between `playing` and `idle`, so the tile and the bar show that the playlist is on its way out. Pressing the tile again while it is stopping needs a rule: cancel the stop, or start over.

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
- **Notes on Next, Previous and choosing a track** (to settle in the proposal):
  - *Previous* goes back through the tracks actually played (a history), in every mode. For Shuffle that is the same as stepping back in the list.
  - *Choosing a track* from the track list plays it. In Shuffle it is then treated as played: it is moved to the current position of the list, so it won't come up again until the next round.
  - The track list always shows the alphabetical order, with the current track marked.
  - Changing the order while the playlist plays takes effect from the next track.

#### 8. Track looping

A checkbox: the current track repeats until the user moves to another one. That track then repeats in turn.

- **Notes:** the existing `PlaybackRules.loop` means "wrap from the last track to the first". It should be renamed (for example `wrap`) when this is built, to avoid two meanings of "loop". With a crossfade, does a looping track crossfade into itself, or loop seamlessly? Seamless is the expected answer; it interacts with start and end points (feature 11).

#### 9. What "stop" does

Radio buttons in the playlist dialog:

- **Pause:** remember the position; playing again continues from there.
- **Reset track:** remember the track; playing again starts it from the beginning.
- **Reset playlist:** forget everything; playing again starts as if for the first time. This is today's behavior, and the likely default.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8). Starting a playlist currently always begins at the order strategy's first track.
- **Notes:** "stopped but remembering" is a new state for the tile (an idle tile that shows it will resume). Does "Stop (Instant)" follow the setting too? Probably yes, since "instant" is about fades, not about forgetting. Is the remembered position kept across a page reload? Probably not at first. In Shuffle, the remembered list is kept as well.

#### 10. Test playback in the track list

A play/stop button next to each track in the playlist dialog, which starts or stops it immediately. The open accordion shows a progress bar with seeking. Everything reflects the playlist's real state, so a track started from the footer shows as playing in the dialog, and when the track ends the playlist carries on as usual.

- **Seam:** the existing facade covers it: `jumpToTrack(id, i, 'instant')`, `stopPlaylist(id, 'instant')`, `seek`, and the `playlist.stateChanged` and `playlist.progress` events. This is mostly UI work.

#### 11. Track start and end points

As for sounds (feature 6), per track, shown on or below the track's progress bar.

- **Seam:** `planTrack(track, rules) → { startAt, endAt }` (DESIGN.md §8.2). `startAt` is already applied by seeking after loading.
- **Notes:** `endAt` needs a clock timer bound to the current generation that treats reaching `endAt` like `ended`; a crossfade then starts at `endAt − crossfade`. Open: do the footer's time and progress bar show the whole file, or only the part between the start and end points?

#### 12. Track volume

Per-track volume in the track's accordion.

- **Seam:** the per-voice volume from feature 1, added to the playlist volume from feature 2.

#### 13. Waveform

The track's waveform drawn above its progress bar and start/end points.

- **Notes:** the waveform has to come from decoding the audio, and only the browser can decode without a third-party library. Fully decoded, a 5-minute stereo track takes about 100 MB, so tracks should be decoded one at a time, reduced to a small set of peaks (a few thousand numbers), and the full decode dropped at once. The peaks could be cached by the server in a hidden file, so each track is only decoded once. To be settled in the proposal.

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
