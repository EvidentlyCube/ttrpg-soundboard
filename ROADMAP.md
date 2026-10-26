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

None yet.

---

## Backlog

Features that are wanted but not yet proposed in detail, with the seam the current code already leaves for each.

### Fades and crossfades

Fade in when a playlist starts, fade out when it stops, crossfade between tracks; configured per playlist. The plain "Play", "Next" and "Stop" menu items then start to differ from their "(Instant)" twins.

- **Seam:** `PlaybackRules.fadeIn` / `fadeOut` / `crossfade` (DESIGN.md §8.2), resolved in one place by `resolvePlaybackRules()` and turned into timings by `resolveTransition()`. `Voice.rampGain()`, the retiring set with its deadlines and cap, and `'instant'` cutting fading voices already exist and are tested with non-zero rules.
- **Notes:**
  - A crossfade at the natural end of a track has to start the next voice at `endAt - crossfade`, before the current track ends, rather than on `ended`.
  - A fade-out on stop probably wants a visible `stopping` state between `playing` and `idle`.

### Track order options

Shuffle, shuffle without repeats, and so on, per playlist.

- **Seam:** the order strategy registry (`order-strategies.js`, DESIGN.md §8.2) and `PlaybackRules.order`. Strategies are pure; random ones should take a seed so they stay testable.

### Custom track start and end points

Skip a long intro or cut a track short.

- **Seam:** `planTrack(track, rules) → { startAt, endAt }` (DESIGN.md §8.2). `startAt` is already applied by seeking once the track has loaded.
- **Notes:** `endAt` needs a clock timer bound to the current generation that treats reaching `endAt` like `ended`.

### "Customize" dialogs

Edit a sound's, track's or playlist's options (title, and later volume, fades, order, start and end points) from the UI.

- **Seam:** the "Customize" context menu items exist as disabled stubs (DESIGN.md §9.3). Options files already keep unknown keys when rewritten (§2.3).
- **Notes:** needs a write API for options files, validation shared with bootstrap, and pushing the changed library to the page.

### Per-playlist, per-track and per-sound volume

- **Seam:** every voice already has its own gain node (DESIGN.md §6.3); a per-playlist gain node would sit between the voices and the music bus.

### Rescanning while running

Pick up added or removed files without restarting, by a button or by watching the directory.

- **Seam:** `BootstrapService` and the scanner are reusable; the page reloads the library through `/api/library`.
- **Notes:** the nested-directory and metadata questions currently happen in the terminal; while running they would need an answer from the UI or a non-interactive rule.

### LAN access and phone remote control

Open the app on a phone on the same network to choose what plays, while the PC does the playing.

- **Seam:** commands and events are plain serializable objects and every command goes through `dispatch()`, which validates it (DESIGN.md §6). The server holds no playback state.
- **Notes:** would add a `--host` option, a `GET /api/events` stream (server-sent events) and a `POST /api/commands` relay, plus a "player" and "remote" role for pages.

### Search, filter and keyboard shortcuts

- **Seam:** UI only, built on the existing facade.

### More saved preferences

- **Seam:** `.soundboard` settings, `SettingsStore` and the `/api/settings` endpoints (DESIGN.md §2.3, §5.2).

### Context menus on touch screens

Long press to open a tile's menu.

- **Seam:** the shared `Overlay` and `openContextMenu()` (DESIGN.md §9.3).

### Resume position and preloading

Resume a playlist where it stopped; preload the next track for gapless changes.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8). Starting a playlist currently always begins at the order strategy's first track.

### Committed browser smoke tests

The UI and `WebAudioEngine` have been checked by driving the real page in headless Chromium over the DevTools protocol, using only Node's built-in `WebSocket`. That script lives outside the repository.

- **Notes:** commit it (for example as `scripts/browser-smoke/` with an `npm run smoke` script) so the checks can be repeated. It needs a local Chromium and stays out of `npm run check`. See [`TESTING.md`](TESTING.md).

### Media element reuse for Safari (only if needed)

New media elements are assumed to play in Safari once the audio context has been unlocked (DESIGN.md §12). If manual testing shows otherwise, `WebAudioEngine` could create a small pool of elements during a click and reuse them.
