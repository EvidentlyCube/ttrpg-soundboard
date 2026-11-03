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

### Debug dialog

**Goal.** Tools for troubleshooting move out of the way. The app menu gets a **Debug** item that opens a small dialog with **Regenerate waveforms** and **Show debug view**. The header's bug button is no longer always there: it appears, in red, only while the debug view is shown, and clicking it closes the view and hides the button again.

**Design changes.**
- §9.1 Layout: the header lists the debug button as "while the debug view is shown" instead of always.
- §9.3 Overlay and context menus: the app menu loses **Regenerate waveforms** and gains **Debug**, which opens the Debug dialog. The menu table changes to match, and so does the splash's disabled list (`appMenuItems({ started: false })`, §9.0).
- §9.8 Debug view: the button is hidden until the view is shown from the Debug dialog, is red (`danger`) instead of lit in the music accent, and a click closes the panel *and* hides the button, so it no longer toggles. A new paragraph describes the Debug dialog: title "Debug", the two buttons, each closing the dialog.
- §6.6 waveforms: no change; the dialog calls the same `regenerateWaveforms()`.

**Open questions.**
1. *Is Regenerate waveforms removed from the top level of the menu?* Recommended: **yes**. It's only in the Debug dialog now.
2. *Where does Debug go in the menu?* Recommended: in the group with **Options** and **Info**, after Info. Like them, it's disabled on the splash before the board starts.
3. *What do the dialog's buttons do to the dialog?* Recommended: **both close it**. The debug panel sits above dialogs (`z-[60]`), so leaving the dialog open would put the panel on top of it. The waveform progress already shows in the header.
4. *What does the dialog show while the debug view is already shown?* Recommended: the button reads **Hide debug view** and hides it, so the dialog is a toggle as well as the header button.
5. *Does Esc still close the panel?* Recommended: **yes, and it hides the button too**. Closing the view always means the same thing, whichever way it's done.
6. *Is the choice remembered across a reload?* Recommended: **no**. The view starts hidden after every reload, as the panel does today.
7. *What does "red" look like?* Recommended: a red icon on a faint red background (`text-danger bg-danger/15`, `hover:bg-danger/25`), like the outlined Problems button. That makes it clearly "debug mode is on" without looking like an error.

**Plan.** Lean flow: code first, the owner checks the UI, then tests and docs in one sweep.
1. `appMenuItems`: replace `regenerateWaves` with `debug`. Add a `ui/debug-dialog.js` with the two buttons. `DebugView` gets `show()` / `hide()` and an `isShown()` the dialog reads, the button is hidden while the view is hidden, and its click and Esc hide both. The owner checks it in the browser.
2. Tests: the `appMenuItems` unit test. Browser specs for the menu, the dialog, showing and hiding the view from the button, from Esc and from the dialog, and regenerating from the dialog. The existing debug view and waveform specs move to the new route. Then `npm run check` and a commit.
3. `DESIGN.md` §9.0, §9.1, §9.3 and §9.8 in their own commit. Remove this proposal.

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
