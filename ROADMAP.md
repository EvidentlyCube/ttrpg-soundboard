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

### Error handling

**Goal.** Every problem the app knows about is listed in one place. When there are any, a button in the header says so and opens a dialog with the list. Problems found at startup, and ones that appear later (failed downloads, failed saves, tracks that fail to play), land in the same list.

**Design changes.**
- §3.1 step 4 and §3.5: warnings and unreadable durations are also recorded as problems, not only printed. `Reporter` stays as it is; bootstrap returns the list next to the library (§3.4), and a refresh (§3.6) rebuilds it.
- §5.1: a `Problems` list in `src/library/` (kind, path or item id, message, `at`), held by the server beside the library and settings store. Startup problems are replaced on refresh; runtime problems are added.
- §5.2: `problems` in the `/api/library` response (the startup list), a `problem` event-stream message for runtime ones, and `DELETE /api/problems/<id>` to dismiss one. `/api/problems` gives the whole list for a page that was away.
- §6.1, §6.2: `getProblems()`, `dismissProblem(id)`, `dismissAllProblems()` and a `problems.changed` event `{ count }`. The facade also records what it already announces as errors (`sound.error`, `playlist.error`, `sound/playlist/track.saveFailed`, failed downloads, `app.startFailed` excluded since the page is unusable then), de-duplicated by kind + item.
- §9.1: header Problems button (count, red-tinted), shown only while the list is not empty, left of the external changes button. New §9.14 Problems dialog.
- §9.8 and the example in §2.3 stay as they are. The refresh dialog (§9.1) keeps showing invalid options files, which stop the refresh entirely; they are not "problems" in the list because nothing was loaded.

**Open questions.**
1. **What counts as a problem?** Recommended: unsupported audio files, orphan options files, symlinks, empty playlists, files whose duration couldn't be measured, failed saves, failed downloads, and sounds or tracks that failed to decode or play. Not included: invalid options files (fatal at start, §3.1 step 3, and shown by the refresh dialog).
2. **Where do runtime problems live?** Recommended: the page keeps its own (playback and decode errors are only known there), the server keeps its own (startup, downloads, saves it sees fail), and the dialog merges both. Nothing is persisted; F5 gives a clean list from the server's side. Alternative: the page reports its errors to the server so every tab sees them; more machinery for little gain.
3. **Dismissing.** Recommended: each row has a Dismiss button, and there is a Dismiss all. Startup problems come back on the next start or refresh if the files are still wrong. A problem for an item that is deleted or moved away disappears with it.
4. **Repeated errors.** Recommended: one row per kind and item, with a count ("×3") and the latest time, so a track failing every loop doesn't flood the list.
5. **Does the tile still flash red?** Recommended: yes, unchanged (§9.1); the list is in addition.
6. **Duration fallback.** The backlog mentions reading the duration in the browser on first play. Recommended: leave it out of this feature; reporting comes first.
7. **Button look.** Recommended: red (`bg-danger` if the theme has it, otherwise the existing error red) for errors, yellow (`notice`) when all problems are warnings (unsupported files, symlinks, empty playlists).

**Plan.**
1. `Problems` list (add, merge repeats, dismiss, remove for an item, replace startup ones) — unit tests.
2. Bootstrap and refresh produce startup problems from scan warnings and null durations; the terminal output stays as it is — tests with the fake reporter and prompter.
3. Server: `problems` in `/api/library`, `GET /api/problems`, `DELETE /api/problems/<id>`, `problem` events; failed downloads and saves recorded — HTTP tests.
4. Facade: load, merge with page-side errors, dismiss, `problems.changed`, forgetting on removal — tests with the fake `BackendApi`.
5. UI: header button and Problems dialog — Playwright tests; manual checks in `TESTING.md`.
6. `DESIGN.md` update in its own commit; remove this proposal and the backlog entry.

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

In the owner's order: work from the top. Each entry becomes a proposal (above) before any code is written.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

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

### Browser test coverage still to write

What the Playwright suite (`test/browser/`) does not check yet, collected when the first suite was finished. It covers the splash, playing and controlling playlists and sounds, errors, a suspended system, the sound and playlist Customize dialogs (title, volume, start point, fades, order, repeat, when stopped, crossfade, saving), external changes, the header volumes, the waveform indicator and the basics of the trash. Everything below is open. Each group is a candidate for its own proposal. The part that only a real browser can check stays in the manual checklist ([`TESTING.md`](TESTING.md)), and so does `WebAudioEngine`.

- **Player bar and playlist playback.**
  - The tile menu's instant items (Play, Next and Stop "(Instant)"), Reset, and Stop All on a sound.
  - A playlist set to "Reset track" or "Reset playlist" when stopped: the "Resumes track 3" status, and starting again from the beginning.
  - Repeat the current track, and the random and shuffle orders (with a seeded `random` passed through `test-main.js`).
  - Previous restarting a track that has played for a while, instead of going back.
  - Seeking with the keyboard, and seeking while paused.
  - The crossfade band on the progress bar, and the fade levels on the engine's gain ramps (`FakeVoice.gainRamps`).
  - Times from an hour on (`h:mm:ss`), and `--:--` while the duration is unknown.
  - A track that is disabled in the track list (unsupported format), and the track list scrolling to the current track.
  - The footer layout: three bars per row, two rows, then scrolling.
  - A ninth instance of a sound replacing the oldest, and the difference between small (buffered) and large (streamed) sounds.
- **Sound dialog.**
  - Dragging the start and end handles, pressing the bar, the handles never crossing or coming closer than 10 ms, and the keyboard on the handles (arrows, Shift, Home and End).
  - The start and end fields: `1,25 s`, clamping, nonsense marked red, Esc restoring the field.
  - The fade-out and fades longer than the part that plays (the pulsing red bands).
  - The volume widget: dragging, double-click to reset, the arrow, Home and End keys, `-inf`, nonsense marked red, Esc cancelling the edit only, and the orange boost state above 0 dB.
  - The volume changing a sound that is already playing, and a copy already playing keeping the points it started with.
- **Playlist dialog and tracks.**
  - The Tracks tab: customizing, playing, cropping and changing the volume of a single track, renaming tracks, and the track settings saving (`track.saved`, `track.saveFailed`).
  - Moving a track, and deleting a track or the whole playlist from the dialog, and the dialog closing when its playlist goes away.
  - Adding tracks from the Tracks tab, and the dialog coming back on that tab.
  - The fade-in and fade-out fields, and the crossfade limit note ("Up to … half the shortest track").
- **Add dialog, Download dialog and downloads.** All of it, which needs the fake process runner behind the test server (`downloads: { tools, run }`): lookups and their errors, chapters and playlists, progress and the log, one job at a time, cancelling, dismissing, `503` without the tools, and new tiles appearing at once, including tracks added to a playlist that is playing.
- **Move dialog and moves.** Moving a sound to a playlist and a track to sound effects, name clashes, and the open Customize dialog closing.
- **Trash.**
  - Restoring a playlist or a track (a playlist recreated from its options, tracks flattened), and the ` (2)` name clashes.
  - Restore all and Delete all (held for 2 s), the dialog closing once the trash is empty, and the errors shown in it.
  - Deleting a playlist that is playing, and a deleted sound that is playing stopping.
- **Metadata dialog.** All of it: the rows, source links and their rebuilding for YouTube, the origin and chapter fields, and saving.
- **App menu and waveforms.**
  - ☰ → "Regenerate Waves" counting every sound and track, and its stop button.
  - Failed waveforms counted in the indicator ("2 failed"), and one that cannot be decoded not stopping the rest.
  - Making none again on a second page load, and the waveform appearing in an open dialog when it is made.
- **External changes beyond the basics.**
  - A refresh that fails: the "Could not load the changes" dialog with each problem, and the missing `.soundboard` bringing the "needs a restart" splash back for good.
  - The check when the window gets the focus back.
  - Replacing a file with an identical copy not showing the button, and a change made just before clicking Refresh surviving the reload.
  - The button's "Refreshing…" state.
- **Start-up and the system.**
  - `app.startFailed`: "Could not start the soundboard. Click to retry." and retrying.
  - An open popup closing when the system suspends audio, and an open Customize dialog staying underneath the splash.
  - The empty library line ("none found in this folder").
  - The debug view and its button.
  - The context menu closing on a click outside it and on Esc, and Esc taking the topmost dialog first.
- **The suite itself.**
  - Firefox and WebKit projects in `playwright.config.js` (the browsers are installed), at least for layout checks.
  - Narrow-window layouts, once "Basic mobile design" is done.
  - A visual check of the waveform canvases.
  - Whether `finishWaveforms()` and the other real-time waits can be made deterministic.
  - Why the engine's `unlock` runs twice on start (the splash spec only asserts "at least once").

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
  - Builds on the request guard (DESIGN.md §5.2): the list of accepted `Host` names (`LOOPBACK_HOSTS`) is where the LAN address goes. It also needs a way to keep other people on the network out (for example a token in the link), since anything on the LAN could otherwise run downloads and delete files.

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
