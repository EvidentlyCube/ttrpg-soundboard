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

### yt-dlp update and the Info dialog

**Goal.** At startup, when yt-dlp is installed, the app runs `yt-dlp -U`, since an outdated yt-dlp is the usual reason YouTube downloads break. If a newer version exists and the update fails (usually because it needs `sudo`), a warning appears in the Problems dialog. A new **Info** item in the ☰ app menu opens a dialog that shows the app's version, yt-dlp's version and its update status, and ffmpeg's version.

**Design changes.**
- §3.4: the server listens right after bootstrap, but answers with an **initializing page** until the tools are found and the update has run: a dark page saying "Initializing…", which polls the server and reloads once the app is ready. The API answers `503` meanwhile. Then the terminal prints the tools line, and a line about the update: `yt-dlp updated to 2026.10.26.`, or in yellow `yt-dlp 2026.10.26 is available (installed: 2026.10.21), but the update failed: Insufficient permissions to write to /usr/bin` or `Could not check for a yt-dlp update: …`. After a successful update the tools are looked up again, so the new version is shown.
- §5.4: new `yt-dlp-update.js`, `updateYtDlp(run)`: runs `yt-dlp -U` and reads its output: `is up to date` → `current`; `Updated yt-dlp to` → `updated`; `Latest version:` and `Current version:` without that → `outdated`, with the last `ERROR:` line as the reason; anything else → `failed`. Result: `{ state, current, latest, error }`. It is killed after 60 s, which counts as `failed`. `failed` is not a problem, only shown in the terminal and the Info dialog.
- §5.1: a new problem kind, `ytdlp-outdated` (warning, path `yt-dlp`): "yt-dlp 2026.10.26 is available (installed: 2026.10.21), but the update failed: …". `Problems` keeps such lasting problems across a refresh (today a refresh replaces the whole list). Dismissing works as for the others and lasts until the next start.
- §5.2: `GET /api/info` returns `{ app, ytDlp: { version, update }, ffmpeg }`, where `app` is `package.json`'s version, a missing tool's version is `null`, and `update` is the result above (`null` when yt-dlp is missing). While initializing, every page path gets the initializing page and every other request a `503`.
- §6.1: `getInfo()` on the facade, through `BackendApi`.
- §9.3: the app menu gets **Info** in its own group at the bottom.
- New §9.17 Info dialog: three rows, Soundboard / yt-dlp / ffmpeg, each with its version, or "Not installed" in muted text. The yt-dlp row adds "Up to date", "Updated at startup", "2026.10.26 available" (yellow, the reason as a tooltip) or "Could not check for updates" (the error as a tooltip). It loads the info each time it opens.
- §9.14: the kind label "yt-dlp outdated".

**Answered.**
- A. Run `yt-dlp -U` and let it update when it can.
- B. The app doesn't start until the checks are done; an initializing page reloads into it.
- C. The dialog shows only the three versions for now.

**Plan.**
1. `yt-dlp-update.js`: running `-U` and reading its output: up to date, updated, outdated with the error, failed, timeout.
2. Server: the initializing page, the update in `main.js` with its terminal lines, lasting problems in `Problems`, `GET /api/info`.
3. Page: `BackendApi.getInfo`, `Soundboard.getInfo`, the Info menu item and dialog, the Problems dialog label.
4. Tests for the server and page parts, `TESTING.md`, then `DESIGN.md`.

---


## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

In the owner's order: work from the top. Each entry becomes a proposal (above) before any code is written.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

### Basic mobile design

Make the page usable on a phone or tablet.

- **Changes:** DESIGN.md §1.1 currently targets desktop browsers only, with "no special handling" for touch, and §9 lays the page out for a laptop screen.
- **Notes:**
  - The header's three volume controls collapse into a hamburger menu on narrow screens. Today they have a fixed width and make the page scroll sideways below about 1030 px, which also affects a narrow desktop window.
  - The footer's three bars per row, the tile grid and the dialogs need narrow layouts.
  - Audio unlocking and playback in Safari on iOS need checking.
  - Context menus get **no** touch gesture: long press stays unused (see "Decided against").
  - The remote page is described in DESIGN.md §9.15.

### Browser test coverage still to write

What the Playwright suite (`test/browser/`) does not check yet, collected when the first suite was finished. It covers the splash, playing and controlling playlists and sounds, errors, a suspended system, the tile menus (instant items, Reset, Stop All), what a stopped playlist remembers, repeating, Previous, seeking while paused and the time formats, the sound and playlist Customize dialogs, the Tracks tab (opening, renaming, volume, cropping, playing and seeking a track, deleting, moving, failed saves), the Move dialog (sounds and tracks, name clashes, failures), the Metadata dialog (rows, rebuilt YouTube links, n/a, non-http links), regenerating and failing waveforms, a failed refresh and the rest of the external changes, a failed start, the empty library line, the debug view and the context menu closing, the random, shuffle and crossfade playback, the track list, the footer layout and the sound instance limits, the Add and Download dialogs with fake yt-dlp and ffmpeg (lookups, chapters, playlists, progress, cancelling, failures, tracks added to a playlist), the waveform canvases being painted, the whole trash (listing, restoring playlists, tracks and sounds, Restore all, Delete all, errors, deleting what plays) (title, volume, start and end points with their handles and fields, fades, order, repeat, when stopped, crossfade, saving, the volume widget, and a sound that is already playing), external changes, the header volumes, the waveform indicator and the basics of the trash. Everything below is open. Each group is a candidate for its own proposal. The part that only a real browser can check stays in the manual checklist ([`TESTING.md`](TESTING.md)), and so does `WebAudioEngine`.

- **Keyboard seeking.** The progress bar has no keyboard seeking today; decide whether it should get one before testing it.
- **The suite itself.**
  - Firefox and WebKit projects in `playwright.config.js`, at least for layout checks. The browsers installed here are for an older Playwright than `@playwright/test` 1.64.1 (it wants `firefox-1555` and `webkit-2370`), so run `npx playwright install firefox webkit` first; the projects were not added since they could not be run.
  - Narrow-window layouts, once "Basic mobile design" is done.
  - Whether `finishWaveforms()` and the other real-time waits can be made deterministic.

### Switching scenes

Changing the mood in one action instead of stopping one playlist and starting another by hand. For example, starting a playlist fades out the others in its group, or a saved scene stores a set of playlists and volumes.

- **Notes:** write the proposal at the end, once Panic Stop and Live volume exist, since both are building blocks (a fade of everything, a temporary volume per playlist).

### Sound variants

For future consideration: a sound that picks one of several files at random on each press (a sword hit with five takes), and a per-sound choice of what a second press does (overlap, restart, or stop).

- **Seam:** `SoundPlayer` starts a new instance on every press (DESIGN.md §7).

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
