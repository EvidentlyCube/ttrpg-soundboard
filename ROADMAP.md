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

### Debug view

**Goal.** A button at the right end of the header, after the volume controls, toggles a debug panel that hangs below it. The panel lists every voice the audio engine is playing, sound effects and music tracks alike, oldest first, with its status and current volume. A voice stays listed for 5 seconds after it finishes. The data comes from the playback layer itself, so the panel shows what the engine was really asked to do, not what the UI believes.

**How the data is collected.** The players don't expose their voices, and a `Voice` can't be asked about its state or volume. Rather than adding state getters to both engines and threading them through two players, a `VoiceMonitor` wraps the `AudioEngine` port as a decorator: it creates the real voice, hands back a wrapper that forwards every call and records it. Nothing in `SoundPlayer`, `PlaylistPlayer` or `WebAudioEngine` has to learn about debugging, and the monitor sees every voice, including music tracks fading out after a crossfade and sounds replaced by the ninth press.

For each voice it keeps:
- **Identity:** a serial number (the chronological order), a label, the bus (`sfx` or `music`), and when it was created.
- **Status:** `loading` until the voice reports `loaded`, then `playing`, `paused` (after `pause()`), `fading in` or `fading out` while a fade is running, and the final `ended` (fired `ended`), `stopped` (someone called `stop()`) or `error` (with its message).
- **Volume:** the voice's own gain (last `setGain`) times its fade level now. The fade level is computed from the last `rampGain(target, seconds)` and the clock with the same linear formula as `levelAt` in `fade-ramp.js`, which is a pure function and moves to `logic/` so both sides can use it. Shown in dB like the gain widget (`−6.0 dB`, `−∞ dB`).

**Design changes.**
- §6.3: `VoiceOptions` gains an optional `label` (the sound's or track's title), which `WebAudioEngine` ignores. A new subsection describes the `VoiceMonitor` decorator.
- §6.1 and §6.2: query `getVoices()` returning snapshots `{ serial, label, bus, status, volume, message? }` in start order, and event `voices.changed` (`{}`), sent when a voice is added, changes status or is removed. Volume moves continuously, so it is read with `getVoices()` rather than announced.
- §7, §8: the players pass `label` when they create voices. No behavior change.
- §9.1 (header) and a new §9.8 for the panel, §10 (structure), §11 (testing).

**Open questions.**
1. **Which voices.** All of them: sound instances and music tracks, including tracks still fading out. Each row carries a small badge in the bus color (amber `SFX`, blue `Music`). *Recommended: yes.*
2. **Order.** Chronological by start, oldest at the top, as you described. Since finished voices disappear after 5 s the list stays short; it scrolls inside a maximum height (about 60 % of the window) if it doesn't. *Recommended: oldest first. The alternative, newest first, keeps new voices visible without scrolling.*
3. **Columns.** Badge and label, status, volume in dB. *Recommended: exactly that. Optionally also the position and length (`0:03 / 0:10`), which is cheap but changes as often as the volume.*
4. **What "volume" means.** The voice's own level: the sound's or playlist-times-track gain, times the current fade. The master and bus sliders are left out, so a quiet row means the item itself is quiet. *Recommended: yes. Say so if you'd rather see the final level including the sliders.*
5. **The 5 seconds.** They start when a voice ends, is stopped or fails. A voice cut off by Stop All or by the ninth press counts as `stopped` and also lingers for 5 s. The row keeps its place and turns muted. *Recommended: yes.*
6. **Stacking and behavior.** The panel is non-modal: no backdrop, it doesn't take focus, and the board keeps working under it. It sits above dialogs, so you can watch voices while testing a track in the playlist dialog, but below the context menus and the splash. It closes with the button, or with Esc when no menu is open. It starts closed after every reload (nothing is remembered, as for the rest of the playback state). *Recommended: yes.*
7. **Collecting while closed.** The monitor always records, so opening the panel shows what is already playing, and it keeps at most 200 entries (finished ones are dropped first). The panel itself only refreshes (every 250 ms) while it is open. *Recommended: yes.*
8. **Button.** A small icon button with a bug icon and the title "Debug view", `aria-expanded` and `aria-controls`; lit in the music accent while open. *Recommended: yes.*

**Plan.**
1. Port and labels: `label` in `VoiceOptions` and the fake engine, passed by `SoundPlayer` and `PlaylistPlayer`; move `fade-ramp.js` to `logic/`. Tests: the players pass the title.
2. `VoiceMonitor`: wrapper and records, statuses, fade-aware volume, linger and cap. Tests with the fake engine and fake clock, including the ordering, `ended` once, stop during a fade, error, and the 5 s timer being cleared on teardown.
3. Facade: `getVoices()` and `voices.changed`, with the monitor wired in front of the engine. Facade tests for both players.
4. UI: the header button and the panel, refreshed every 250 ms while open; new manual checks in `TESTING.md`.
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

#### 10. Debug view

A header button that opens a panel listing the voices playing, with their status and volume. It is next in line; the details are in its proposal under [Proposals](#proposals).

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
