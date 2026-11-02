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

### yt-dlp update check and the Info dialog

**Goal.** At startup, when yt-dlp is installed, the app checks whether a newer yt-dlp exists, since an outdated yt-dlp is the usual reason YouTube downloads break. If one does, a warning appears in the Problems dialog. A new **Info** item in the ☰ app menu opens a dialog that shows the app's version, yt-dlp's version and whether an update exists, and ffmpeg's version.

**Design changes.**
- §3.4: after `findTools`, when yt-dlp was found, the update check starts in the background. It never delays or stops the start. When it finds an update, the terminal prints a yellow line: `yt-dlp 2026.10.26 is available (installed: 2026.10.21).`
- §5.4: new `update-check.js` with `checkYtDlpUpdate(run)` and a parser for its output, tested with the fake runner. The result is `{ state: 'checking' | 'current' | 'outdated' | 'failed', current, latest, error }`. The check has a 30 s timeout; being offline counts as `failed`, which is not a problem, only shown in the Info dialog.
- §5.1: a new problem kind, `ytdlp-outdated` (warning, path `yt-dlp`): "yt-dlp 2026.10.26 is available (installed: 2026.10.21). Downloads may fail until it is updated." `Problems` gets a second list for tool problems, which a refresh keeps (today a refresh replaces the whole list). Dismissing works as for the others and lasts until the next start.
- §5.2: `GET /api/info` returns `{ app, ytDlp: { version, update }, ffmpeg }`, where `app` is `package.json`'s version, a missing tool's version is `null`, and `update` is the check's result (`null` when yt-dlp is missing). The check's problem reaches pages through the existing `problems` message.
- §6.1: `getInfo()` on the facade, through `BackendApi`.
- §9.3: the app menu gets **Info** in its own group at the bottom.
- New §9.17 Info dialog: three rows, Soundboard / yt-dlp / ffmpeg, each with its version, or "Not installed" in muted text. The yt-dlp row adds "Up to date", "Checking for updates…", "2026.10.26 available" (yellow) or "Could not check for updates" (with the error as a tooltip). The dialog loads the info each time it opens.
- §9.14: the kind label "yt-dlp outdated".

**Open questions.**

A. **How to check.** `yt-dlp -U` prints what you pasted, but it is not a dry run: when it can write to its own file (a standalone binary in `~/bin`, for example) it **installs the update** at every start, possibly while a download starts in the page. Your Fedora install fails only because `/usr/bin` is read-only. Options:
   1. *(Recommended)* Ask GitHub ourselves with Node's `fetch`: `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest` gives `tag_name` (`2026.10.26`), compared with `yt-dlp --version`. No side effects and no yt-dlp run. The catch: it knows only the stable channel. A nightly build's version (`2026.10.21.232853`) is compared by its date, so it reads as up to date unless it is older than the latest stable.
   2. Run `yt-dlp -U` and parse `Latest version:` / `Current version:` / `is up to date`. It follows the user's channel exactly, but it may update yt-dlp behind the user's back, as described above.
   3. Run `yt-dlp -U` on purpose as a feature ("the app keeps yt-dlp updated"). That needs a Problems message when the update fails, and a rule that no download runs until it is done.

B. **Live updates in the Info dialog.** *(Recommended)* None: the dialog loads once when opened, so one opened during the first seconds shows "Checking for updates…" until it is reopened. The alternative is an `info` event on the stream, for a few seconds of waiting at most.

C. **What else the dialog shows.** *(Recommended)* Only the three asked for. Node's version and the library folder are candidates if you want them.

**Plan.**
1. `update-check.js`: the check and its parsing (fake runner or fake fetch, depending on A): up to date, outdated, nightly, failure, timeout.
2. Server: start the check in `main.js` when yt-dlp exists, the terminal line, tool problems in `Problems` kept across refresh, `GET /api/info`.
3. Page: `BackendApi.getInfo`, `Soundboard.getInfo`, the Info menu item and dialog, the Problems dialog label.
4. Tests for the server and page parts, `TESTING.md` (the Info dialog against the real tools), then `DESIGN.md`.

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
