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

### Translations

**Goal.** Every text the app shows in the browser can be read in another language. Each language is one file in `public/app/i18n/` (`en.js`, `pl.js`, …), and adding a language means adding one file and nothing else. The user picks the language once, in the Selector, and it applies to the Selector, the Initializer, the board, the remote page and the waiting and connect pages.

Today the texts are spread over about 300 string literals in `public/app/ui/`, `selector.js`, `initializer.js`, the five HTML pages, and about 80 in `src/` that reach the page: folder refusal reasons (§5.7), startup failures (§3.7), the server's problems (§6.9) and `HttpError` messages (§5.2).

**Design changes.**
- **§1.1** gets a "Languages" row: English is the source language and the fallback for any missing text. The terminal stays English.
- **New §9.21 Translations** (or a new §6.11 if the owner prefers it under the frontend architecture):
  - **Language files.** `public/app/i18n/<code>.js`, one per language, each a default-exported plain object: `{ locale: 'pl-PL', name: 'Polski', messages: { … } }`. `messages` is nested by area (`trash`, `selector`, `customize`, …). A value is a string with `{placeholders}`, or, where a number decides the wording, an object of plural forms keyed by `Intl.PluralRules` categories (`{ one, few, many, other }`), so Polish's three forms need no code. Files hold text only, never functions, so a translator never edits code.
  - **`en.js` defines the shape.** The other files are typed against it (`@type {Translation}`), so `npm run typecheck` reports a missing or misspelled key. Text is looked up with `t('trash.restoreAll', { count })`, where the key is checked against `en.js` too, so a typo fails the type check rather than showing a raw key.
  - **`logic/i18n.js`**, pure and DOM-free: looks a key up, falls back to English for a key a language lacks, fills placeholders, picks the plural form, and formats numbers with the language's `locale` (`6 123`, `−3,1 dB` in Polish).
  - **Static HTML** gets `data-i18n="key"` attributes filled at load, so the pages stay plain HTML.
- **§5.2, §5.7, §3.7, §6.9 — server messages become codes.** Everything the server sends for the page to show carries a `code` and its `params` (`{ code: 'folder.hidden' }`, `{ code: 'startup.unreadable', params: { path } }`), and the page translates it. The English `message` stays beside it for the terminal, the log and as a fallback. Output of yt-dlp, ffmpeg and the operating system (an `EACCES` text, a download error) is shown as it comes, untranslated.
- **§5.8 — the language setting.** The config folder's file keeps `"language": "pl"` next to `recent` and `browsed` (left out = automatic). New routes `GET`/`PUT /api/language`, answered to every page, including remotes.
- **§9.18 — the picker.** A language menu in the Selector's header, which saves the choice and reloads the page: "Automatic" (the browser's language when a file exists for it, else English) and one row per file, each in its own language (`Polski`, `English`).
- **§10** lists `public/app/i18n/` and `logic/i18n.js`.

**Open questions.**

- **A. Which languages ship first?** **Settled:** English and Polish. No others are planned unless someone else writes a translation.
- **B. One app-wide setting, or one per browser?** **Settled:** app-wide, in the config folder's file where the app keeps its settings (§5.8).
- **C. Where is the language chosen?** **Settled:** only in the Selector, which reloads the page. The board has no language item in its ☰ menu.
- **D. Server messages as codes, now or later?** **Settled:** now, in this feature.
- **E. Are numbers localized?** **Settled:** yes (`Intl.NumberFormat`: decimal comma, thousands separator). The `m:ss` clock and unit symbols (`dB`, `MB`, `ms`) stay as they are in every language.
- **F. What stays English?** **Settled:** everything that isn't shown in the page: the terminal output (§1), the command-line arguments, `--help` and usage errors, log lines, and anything written to disk (titles, file names, `.soundboard` and the options files). The debug view and Debug dialog (§9.8) stay English too, as developer tools. The server has no language files.
- **G. Tests.** **Settled:** browser specs keep running in English (the default); one unit test checks that every language file has exactly `en.js`'s keys, the same placeholders per key, and every plural form its locale needs; one Playwright spec switches to Polish in the Selector and checks a few texts and a number there and on the board.

**Plan.** Following the lean flow: code first, the owner checks the UI, then tests and `DESIGN.md` in one sweep. One commit per step.

1. **Core.** `logic/i18n.js` (lookup, fallback, placeholders, plurals, numbers), the `Translation` type, and an `en.js` with the first keys.
2. **The setting.** `language` in the config file, `GET`/`PUT /api/language`, and every page loads its language file before its first drawing (the board already waits for `loadName`, §9.0).
3. **The board's texts.** Every string in `public/app/ui/` and `index.html` moves into `en.js`; numbers go through the locale.
4. **The startup and remote pages.** `selector.js`, `initializer.js`, `startup-parts.js`, the remote view and the other HTML pages.
5. **Server messages as codes.** Refusal reasons, startup failures, problems and the `HttpError`s the page shows get `code` and `params`; the page translates them.
6. **The picker.** The Selector header's language menu (question C).
7. **`pl.js`.** The full Polish translation.
8. **Tests, `TESTING.md` and `DESIGN.md`.**

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
