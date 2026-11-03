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

### Release packages

**Goal.** A player downloads one zip for their system, unpacks it and double-clicks a launcher. A terminal window opens, the browser opens the Selector, and the app runs. Node.js doesn't need to be installed, because each zip carries the official Node binary for its platform. Single executable applications (SEA) were considered and set aside: the owner prefers a plain folder with a real `node` binary, the app files and a launcher. A developer builds every zip with one command, `npm run pack`, which uses only Node built-ins, so no new dev dependency is needed.

Each zip unpacks to one folder:

```
soundboard-0.2.0-macos-arm64/
	Start Soundboard.command      launcher (Start Soundboard.cmd on Windows, start-soundboard.sh on Linux)
	README.txt                    short version: how to start, stop, update, the system warning on first start
	app/                          index.js  package.json  LICENSE  src/  public/
	runtime/                      node (node.exe on Windows)  LICENSE (Node's own)
```

The launcher changes to its own folder, runs `runtime/node app/index.js` with any arguments passed through, and leaves the terminal window open on a non-zero exit (`Press Enter to close.`), so a failure stays readable. `app/package.json` stays next to `src/`, because the Info dialog reads the app's version from it (§9.17). The app code itself does not change: it already starts without a folder, in the Selector (§3), and finds `public/` relative to its own files.

**Design changes.**
- §1: the last bullet ("a launcher may open") names the launchers and what they do.
- §1.1: a new **Distribution** row (release zips per platform with the official Node binary, or run from source with your own Node 24.14+). The **External programs** row is unchanged: `yt-dlp` and `ffmpeg` are still not bundled.
- §10: `scripts/pack.js` and `scripts/pack/`, `packaging/` (launcher and README templates), `dist/` (output, git-ignored), `test/scripts/`.
- §10.2: `npm run pack`, and `npm test` also covering `test/scripts/`.
- New **§13 Release packages**: the platforms, the zip layout, the launchers, how the Node binary is fetched and checked, and how the version and file names are chosen.
- `README.md` is rewritten around the zips. It is already out of date (port `3000`, questions in the terminal). Running from source stays as a shorter section.

**Open questions.**

- **A. Platforms.** Recommended: `windows-x64`, `macos-arm64` (the MacBook Neo, §12), `macos-x64` and `linux-x64`. ARM Windows and ARM Linux are left out until someone asks for them; they are one line each in a platform table.
- **B. Which Node.** Recommended: an exact version pinned in one constant in `scripts/pack/platforms.js`, the newest 24.x at the time of the first release, and changed by hand. `engines` stays `>=24.14.0` for running from source. Every download is checked against the release's `SHASUMS256.txt` from nodejs.org and cached in `dist/cache/`, so repeated packs work offline.
- **C. Where releases are built.** Settled: on GitHub, triggered by a version bump. The workflow `.github/workflows/release.yml` runs on every push to `main` that changes `package.json`. It reads the version and stops if the tag `v<version>` already exists. A tag check is used instead of a diff with the previous commit, so a bump pushed together with other commits is still found, and a failed run can be re-run safely. For a new version, it runs `npm run check` and `npm run pack`, unpacks each zip on Linux, macOS and Windows runners and starts it with `--help`, then creates the tag and a **draft** release with the zips attached and notes generated from the commits since the last tag (`gh release create v<version> dist/*.zip --draft --generate-notes --target <sha>`). It needs `permissions: contents: write` and no secrets. The owner reads the draft and publishes it by hand. Until the repository is on GitHub, `npm run pack` builds the zips locally.
- **D. What goes into `app/`.** Recommended: exactly `index.js`, `package.json`, `LICENSE`, `src/` and `public/`, limited to files git tracks, so stray local files are never shipped. The pack refuses to run when those paths have uncommitted changes, so a zip always matches a commit; `--allow-dirty` overrides that for trying things out. `README.md`, tests, docs, fixtures and tooling stay out.
- **E. Version and names.** Recommended: the version comes from `package.json` (now `0.1.0`), and zips are named `soundboard-<version>-<platform>.zip`. A release is cut by bumping the version in its own commit (`Release 0.2.0`) and pushing it. The release workflow creates the tag `v0.2.0` itself (question C). Zip entries get the commit's date as their timestamp, so packing the same commit twice gives byte-identical zips.
- **F. Launchers.** Recommended: `Start Soundboard.cmd` (Windows) and `Start Soundboard.command` (macOS) are double-clickable. On Linux, double-clicking a `.sh` opens it in a text editor in most file managers, and a `.desktop` file needs absolute paths, so `start-soundboard.sh` is run from a terminal and `README.txt` says so. On Windows, Ctrl+C makes `cmd` ask "Terminate batch job (Y/N)?" after the app has already stopped. That is accepted: typing `exit` stops it cleanly, and closing the window works too.
- **G. Unsigned files.** The Node binaries are signed (and notarized on macOS) by the Node project, but the launchers are not. On macOS, Gatekeeper blocks the first double-click on a downloaded `.command`, and the user allows it once in System Settings → Privacy & Security → **Open Anyway**. On Windows, SmartScreen may warn about the `.cmd` (**More info → Run anyway**). Recommended: no signing (an Apple Developer ID costs a yearly fee, and Windows signing needs a certificate). `README.txt` and `README.md` walk through both warnings with the exact button names.
- **H. Zip and tar handling.** Recommended: two small modules on Node built-ins (`zlib` for deflate, gunzip and `crc32`; `crypto` for the checksums), not the system's `zip`/`tar` and not an npm package. The zip writer stores Unix permissions, so `node`, the `.command` and the `.sh` stay executable after unpacking on macOS and Linux. The tar reader only needs to pull `bin/node` and `LICENSE` out of Node's `.tar.gz`. Windows takes `node.exe` as a direct download, which `SHASUMS256.txt` also lists, and Node's `LICENSE` from the Linux tarball, which is the same file.

**Plan.**
1. Zip writer and tar reader (`scripts/pack/zip.js`, `scripts/pack/tar.js`).
2. Node runtime fetching (`scripts/pack/node-runtime.js`): download, checksum check, cache, pulling the binary and `LICENSE` out.
3. Launchers and `README.txt` (`packaging/`), and the pack script (`scripts/pack.js`, `npm run pack [-- --platform <name>…] [--allow-dirty]`): file list from git, dirty check, zip layout, output to `dist/`, `dist/` added to `.gitignore`. The owner tries the zips on their machines.
4. `README.md` rewritten around the zips.
5. Tests sweep: zip round trip (entries, contents, permissions, timestamps), tar extraction, checksum mismatch rejected, file selection and the dirty check, and an end-to-end test that packs `linux-x64` from a fake cached runtime and starts the unpacked app with `--help`. `npm test` also runs `test/scripts/**`, and the backend type-check project covers it. Manual checks in `TESTING.md`: each launcher on its system, the Gatekeeper and SmartScreen steps, stopping, and the window staying open after a failure. Then `DESIGN.md`.
6. The release workflow (question C), tried on GitHub once the repository is there.

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
