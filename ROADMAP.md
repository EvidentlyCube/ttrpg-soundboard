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

### Soundboard name

**Goal.** A soundboard can have a name of its own, set in a new **Options** dialog from the ☰ menu. The name replaces "Soundboard" in the board's header and the tab title, and the Selector shows it for the soundboard instead of the folder's name. Without a name, the folder's name is used everywhere.

**Design changes.**
- §2.3 (`.soundboard`): an optional `"name"` key, a non-empty string of at most 100 characters (`MAX_NAME_LENGTH`), validated like the other keys; a wrong one is a fatal validation error. Clearing the name removes the key.
- §5.1, §5.2: `SettingsStore` holds the name next to the volumes, saved with the same serialized read-merge-write. `GET /api/settings` gains `name` (`null` without one), and a new `PUT /api/settings/name` takes `{ name: string | null }`, trimming it; `400` for one too long.
- §5.7, §5.8, §3 (startup): a soundboard's name is read from its `.soundboard` (a broken or missing one counts as no name) for the folder cards (given folders and Recent), the listing's subfolders and the listing itself. They gain `title`: the name, or `null`.
- §6.1: `Soundboard` keeps the name from the settings it loads at start, `setName(name)` applies it at once (`settings.nameChanged`) and saves it with the 500 ms debounce of the other customizations, flushed by `flushSettings`.
- §9.1, §9.3: the header shows the name (the folder's name without one), and the document title becomes "<name> · Soundboard". The ☰ menu gets **Options** (enabled only once started), opening the Options dialog (new §9.x): one "Name" field, its placeholder the folder's name, saving as you type.
- §9.18: a soundboard card shows the name over the path; a soundboard row in Browse shows the name, with the folder's name in muted text after it when they differ.

**Open questions.**
1. *What does the header show on the splash, before anything is loaded?* Today the only request before the click is `GET /api/remote` (§9.0). **Recommended:** add the name to that answer's neighbor, `GET /api/settings`, fetched on load as well — it reads one small file and starts no audio, and the header then never jumps from "Soundboard" to the name. The rule in §9.0 becomes "the only requests are `GET /api/remote` and `GET /api/settings`".
2. *Do other open pages (another tab, the remote page) update live when the name changes?* **Recommended:** no; they show it after a reload. A live update needs a new event on the event stream for a rare action.
3. *Does the remote page show the name?* **Recommended:** not in this feature; it has no header today (§9.15).
4. *Where does the folder's name come from when there is no name?* **Recommended:** the folder's base name, as the Selector shows it today.

**Plan.**
1. `.soundboard` `name`: validation, `SettingsStore` load/update, `GET /api/settings` and `PUT /api/settings/name` — backend tests for the key's rules, the merge with volumes, and the route's answers.
2. The startup side: `soundboardName(folder)` reading the name safely; `title` on the given folders, the recent folders, the listing and its subfolders — backend tests with broken and missing files.
3. `Soundboard` name, `setName` with the debounced save, `settings.nameChanged`, `BackendApi.saveName` — frontend tests with the fake clock.
4. UI: the header and document title, the Options item and dialog, the Selector cards and rows — browser tests.
5. `DESIGN.md`.

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
