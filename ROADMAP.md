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

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

In the owner's order: work from the top. Each entry becomes a proposal (above) before any code is written.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

### Customizable playlist looping

`PlaybackRules.playlistLooping` is always on "for now" (DESIGN.md §8.2). An option lets a playlist stop after its last track instead, for one-shot sequences such as a boss intro.

- **Seam:** the rule already exists and the play history honors it (§8.1). It needs a playlist option (§2.3, §5.1, §5.2), a command and a control in the playlist dialog (§9.7).

### Panic Stop

A large **Panic Stop** button with a space of its own in the footer (DESIGN.md §9.1), always in the same place so the layout never shifts.

- **Behavior:** one click starts fading everything out, playlists and sound effects alike. A second click stops everything immediately, including voices still fading out.
- **Seam:** `'instant'` transitions already cut every voice of a playlist (§6.1, §8); `stopSound` is instant (§7). The fade is new for sounds and has no per-playlist rules, so the proposal decides how long it lasts (one global duration, or each playlist's own fade-out) and what the button shows while fading.

### Live volume

A small volume bar for a temporary volume, on the playlist tiles and sound tiles and in the footer's player bars.

- **Behavior:** the footer's bar and the playlist tile's bar are the same value, kept in step. It is temporary: never saved, back at full on a reload, and separate from the saved `gain` (DESIGN.md §6.4), which the Customize dialogs set. It multiplies with it.
- **Seam:** voices already have a gain stage of their own next to the fade stage (§6.3). Open for the proposal: whether sound effects get one value per sound, and whether a tile's bar is always visible or appears on hover.

### Reload guard

Reloading or closing the page asks for confirmation (`beforeunload`) while anything is playing, since a reload stops all audio (DESIGN.md §6.7).

- **Notes:** the page's own reload after a refresh of external changes (§9.1) must not ask. The UI listens to `playlist.stateChanged` and `sound.activeChanged` to know whether anything plays.

### Protect the API from other web pages

Any page open in the same browser can send simple cross-site requests to `127.0.0.1`, for example a `text/plain` `POST` to `/api/trash/delete`, and DNS rebinding reaches every endpoint (DESIGN.md §5.2).

- **Notes:** require `application/json` on requests with a body, and reject requests whose `Host` is not the server's own address (`localhost`, `127.0.0.1` and whatever LAN access later adds). Applies to `readJsonBody` and the waveform upload (`src/http/router.js`). LAN access builds on this (see below).

### Ogg Opus files

`.opus` is listed among the unsupported extensions (DESIGN.md §2.1), though `ogg.js` already reads Opus titles and durations (§4.2, §4.3). Safari on the target MacBook plays Ogg Opus (§12).

- **Notes:** accept `.opus` as a supported extension and format, with a content type for streaming (§5.2), and let downloads keep an Opus stream instead of re-encoding it to Vorbis (§5.4, which today keeps only `.mp3` and `.ogg`). `canPlay` still checks the format (§6.3). Open for the proposal: what a download of a YouTube video produces (`.opus` or `.webm`), and existing `.ogg` files that hold Opus.

### Error handling

Show every problem found at startup in one place. If there are any, a button in the page header says that there are issues to handle, and opens a dialog listing all of them.

- **Today:** warnings go to the terminal only (DESIGN.md §3.1: unsupported files, orphan options files, symlinks, empty playlists), and the browser learns nothing. The refresh dialog (§9.1) lists invalid options files, but only after a refresh.
- **Includes:** files whose duration can't be measured. Bootstrap stores `"duration": null` for them (§3.5), but the UI assumes every sound has one: the sound dialog leaves out its Start and end section for such a sound, and crossfades skip such tracks. Reporting them is the first step; reading the duration in the browser on first play is an option for later.
- **Notes:** the server needs to keep the list and send it (a field of `/api/library` or an event), and the same list should cover problems that appear later (failed downloads, failed saves, tracks that fail to play).

### Basic mobile design

Make the page usable on a phone or tablet.

- **Changes:** DESIGN.md §1.1 currently targets desktop browsers only, with "no special handling" for touch, and §9 lays the page out for a laptop screen.
- **Notes:**
  - The header's three volume controls collapse into a hamburger menu on narrow screens. Today they have a fixed width and make the page scroll sideways below about 1030 px, which also affects a narrow desktop window.
  - The footer's three bars per row, the tile grid and the dialogs need narrow layouts.
  - Audio unlocking and playback in Safari on iOS need checking.
  - Context menus get **no** touch gesture: long press stays unused (see "Decided against").
  - Design specific to the remote player belongs to "LAN access and remote control" below, not here.

### Playwright browser tests

Replace the committed smoke scripts (`scripts/browser-smoke/`, [`TESTING.md`](TESTING.md)), several of which check earlier versions of the UI, with Playwright tests.

- **Notes:**
  - The tests run against a mock of the playback library that Playwright controls: a fake `AudioEngine` and clock in the page (DESIGN.md §6.3), so that the UI is time-independent. A test advances time, ends a track or fails a voice on purpose, and never waits for real audio.
  - Real-browser checks of `WebAudioEngine` itself stay manual (or a separate small suite), since the mock replaces it.
  - Port what the smoke scripts cover, then remove them. It needs Playwright as a dev dependency, which needs the owner's approval (CLAUDE.md) and stays out of `npm run check`.

### Switching scenes

Changing the mood in one action instead of stopping one playlist and starting another by hand. For example, starting a playlist fades out the others in its group, or a saved scene stores a set of playlists and volumes.

- **Notes:** write the proposal at the end, once Panic Stop and Live volume exist, since both are building blocks (a fade of everything, a temporary volume per playlist).

### Sound variants

For future consideration: a sound that picks one of several files at random on each press (a sword hit with five takes), and a per-sound choice of what a second press does (overlap, restart, or stop).

- **Seam:** `SoundPlayer` starts a new instance on every press (DESIGN.md §7).

### LAN access and remote control

Open the app on a phone on the same network to choose what plays, while the PC does the playing. This merges the earlier "LAN access" and "Remote control" entries. It builds on "Basic mobile design", and the design specific to the remote (what its page shows, how it differs from the player) belongs here.

- **Seam:** commands and events are plain serializable objects and every command goes through `dispatch()`, which validates it (DESIGN.md §6). The server holds no playback state. Deletions, moves, downloads and the trash are deliberately not commands, so a remote limited to playback follows from the architecture.
- **Notes:**
  - Would add a `--host` option (DESIGN.md §1), a command relay (`POST /api/commands`), an event stream of playback state, and a "player" and "remote" role for pages.
  - Open: whether the remote is a separate page or a role of the same page. Today every open tab is an independent player, so the proposal must say which tab is the player and what happens when a second player connects.
  - Needs "Protect the API from other web pages" first, and a way to keep other people on the network out (for example a token in the link), since anything on the LAN could otherwise run downloads and delete files.

### Preloading the next track

Load the next track shortly before the current one ends, for gapless changes.

- **Seam:** `PlaylistPlayer` (DESIGN.md §8); crossfades already start the next voice early (§8.4). From localhost a track loads in milliseconds, so measure the gap before proposing it.

### Editing where files came from

The metadata dialog (DESIGN.md §9.13) shows each file's `source` read-only. The owner wants to edit it later.

- **Seam:** the dialog's rows come from one list of fields (`ui/source-fields.js`), each naming its source key, so each can become a field. `"edited"` is already reserved as the `origin` of a source typed in by hand (§2.3). The save would go through `LibraryEditor` and a `PATCH`, as the other options do (§5.1, §5.2).

---

## Decided against

Not planned, so a later review doesn't propose them again.

- **Search, filter and keyboard shortcuts.**
- **Context menus on touch screens**, including a long-press gesture.
- **Narration ducking**, a toggle that lowers the music.
- **Sound grouping** into sections.
- **Loudness matching** of files.
- **Importing local files** from the page. Files are added by copying them into the folder, which the external changes button picks up (DESIGN.md §5.3), or by downloading.
- **A warning when two tabs play at once.**
- **Media element reuse for Safari.** New media elements are assumed to play once the audio context has been unlocked (DESIGN.md §12).
- **More saved preferences** as a feature of its own. A preference is proposed together with the feature that needs it.
