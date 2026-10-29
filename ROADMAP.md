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

### Where files came from

**Goal.** Files that `yt-dlp` named (`Title [dQw4w9WgXcQ].mp3`) get a YouTube `source` recorded, as downloads already do. A new **Metadata** item in the sound and playlist context menus opens a read-only dialog. For a sound, it shows everything known about its file. For a playlist, it shows the same for every track.

**Design changes.**

- **§2.3 Sound or track options.** `source` can also come from the file name:
  ```json
  "source": { "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "extractor": "Youtube", "videoId": "dQw4w9WgXcQ", "fromFileName": true }
  ```
  `fromFileName` marks it as a guess, so the dialog can say so. It passes validation already, since unknown keys inside `source` are kept, but it gets documented and checked as `true` or missing.
- **§3.1–3.3 Bootstrap**, a new step after the options files are written. Every sound and track whose options file has no `source` is checked for an id in its file name (A, B). When one is found, `source` is merged into the options file, so it is written once and never guessed again. The reporter counts these writes with the other generated options. Refreshes (§3.6) run bootstrap, so they do the same.
- **§4 Metadata extraction.** A new `readTags(filePath) → Promise<{ title, artist, album, year }>` (each `string | null`) reads more than the title (E):
  - ID3v2 `TIT2`/`TPE1`/`TALB`/`TDRC` (`TYER` in v2.3; `TT2`/`TP1`/`TAL`/`TYE` in v2.2), with ID3v1 as the fallback for each.
  - Vorbis `TITLE`/`ARTIST`/`ALBUM`/`DATE`.
  - The same bounded reads and limits as today. `readTitle` becomes `readTags(...).title`.
- **§5.2 HTTP API.** `GET /api/metadata?sound=<id>` and `GET /api/metadata?playlist=<id>` answer `{ files: [FileMetadata] }`, with one file for a sound and every track in path order for a playlist. `404` for an unknown id, `400` without exactly one of the two. They are read when asked: the tags from the file, the size and date from the disk. `FileMetadata` is:
  ```json
  { "id": "Combat/Battle [dQw4w9WgXcQ].ogg", "title": "Battle", "format": "ogg", "size": 4194304, "modified": "2026-10-24T16:41:00.000Z",
    "duration": 213.47, "sha1": "3f78…", "tags": { "title": "Battle Theme", "artist": "…", "album": null, "year": "2019" },
    "source": { "url": "…", "extractor": "Youtube", "videoId": "dQw4w9WgXcQ", "playlistId": "PL…", "chapter": 3, "fromFileName": false } }
  ```
  `sha1` comes from `measuredFrom` (null when there is none). `source` is `null` when there is none.
- **§6.1 facade.** A new `loadMetadata({ kind: 'sound' | 'playlist', id }) → Promise<FileMetadata[]>`, plus the `BackendApi` method `fetchMetadata`. Not a command.
- **§9.3 context menus.** **Metadata** comes after Customize in both menus.
- **New §9.13 Metadata dialog** (`ui/metadata-dialog.js`), read-only, titled `Metadata: "<title>"`.
  - **A sound** shows one card of label/value rows:
    - File (the path), Format, Size, Duration, Modified and SHA-1;
    - then **Tags** (Title, Artist, Album, Year), each left out when missing;
    - then **Source**: Link, Site (the extractor), Video ID, Playlist (linked as `https://www.youtube.com/playlist?list=<id>` for YouTube), and Chapter. When the source came from the file name, a muted note says "Found in the file name".
  - A sound without a source says "No source recorded".
  - Links open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`). Long values end in "…", with the full value as a tooltip. All text can be selected and copied.
  - **A playlist** starts with a summary line: folder, track count, total size and total duration. Then comes one card per track in playlist order, numbered as in the Tracks tab, with the same rows (F).
  - "Loading…" shows while the request runs. A failure shows in red.
- **TESTING.md.** Manual checks for both dialogs, the links, and a file whose `source` was guessed.

**Open questions.**

- **A. When is the file name checked?** *Recommended:* at every start and refresh, but only for files whose options file has no `source` yet. Your libraries were already bootstrapped, so every file has an options file. Checking only when an options file is first created would never reach them. Once found, the `source` is stored, so each file is checked until it has one and never again.
- **B. Which brackets count as an id?** *Recommended:* only the last `[…]` right before the extension, holding exactly 11 characters of `A–Z a–z 0–9 _ -`, as `yt-dlp` names files. This covers chapter files too (`Title - 003 Intro [id].ogg`). It keeps a `[Remastered]` elsewhere in the name from counting. An 11-character word in that last spot, such as `[Instrumentl]`, would still be taken for an id; `fromFileName` lets the dialog flag it as a guess.
- **C. Is the id only stored, or checked too?** *Recommended:* only stored, with the watch link built from it. Checking it would mean going online at every start for every such file.
- **D. Does the title change?** Files that took their file name as their title still show `Battle [dQw4w9WgXcQ].ogg` on the tile. *Recommended:* no. Titles stay as the user left them, and the Customize dialog can rename them. The other option is to clean titles that still equal the file name exactly, as downloads do (§2.4). That would quietly rename many tiles at the next start.
- **E. Which metadata does the dialog list?** *Recommended:*
  - the file facts the app already knows: path, format, size, duration, modified time and SHA-1;
  - the source;
  - four embedded tags read when the dialog opens: title, artist, album and year.
  Reading more tags, such as comments or cover art, could come later. Gain, points and fades stay in the Customize dialog.
- **F. A playlist with many tracks.** *Recommended:* every track's card is shown, open, in one scrolling list, so the dialog can be skimmed and searched with the browser's find. The other option is an accordion like the Tracks tab, with one track open at a time.

**Plan.** In the lean flow: code first, with the owner checking the UI, then tests and DESIGN.md in one sweep.
1. **Finding ids in file names**: the pure matcher and link builder, and bootstrap storing `source` (with `fromFileName` validated).
2. **`readTags`** for ID3v2, ID3v1 and Vorbis comments, with `readTitle` built on it.
3. **`GET /api/metadata`** for a sound or a playlist.
4. **Facade**: `loadMetadata` and `BackendApi.fetchMetadata`.
5. **UI**: the two menu items and the metadata dialog for a sound and for a playlist.
6. **Tests** for steps 1–4, **TESTING.md** checks, then **DESIGN.md** (its own commit), and removing this proposal and the backlog entry "Where files came from".

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

### Planned, in the owner's order

No planned features are left. The next step is the section "Finally: design the remaining features" below.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

### Later, unordered

#### LAN access and phone remote control

Open the app on a phone on the same network to choose what plays, while the PC does the playing.

- **Seam:** commands and events are plain serializable objects and every command goes through `dispatch()`, which validates it (DESIGN.md §6). The server holds no playback state.
- **Notes:** would add a `--host` option, a `GET /api/events` stream (server-sent events) and a `POST /api/commands` relay, plus a "player" and "remote" role for pages.

#### Where files came from

Downloads record their origin in the options file's `source` (DESIGN.md §2.3).

- **Recognizing existing files:** bootstrap could look in each file name for a YouTube video id in square brackets, as `yt-dlp` names files (`Title [dQw4w9WgXcQ].mp3`, matching `\[([A-Za-z0-9_-]{11})\]`), and store `source: { extractor: 'Youtube', videoId }` when the options file has no `source` yet.
- **Showing it:** expose `source` in `/api/library` and in the Customize dialogs, for example as a link back to the video.

#### Search, filter and keyboard shortcuts

Will not implement

#### More saved preferences

- **Seam:** `.soundboard` settings, `SettingsStore` and the `/api/settings` endpoints (DESIGN.md §2.3, §5.2).

#### Context menus on touch screens

Will not implement.

#### Preloading the next track

Load the next track shortly before the current one ends, for gapless changes.
- **Seam:** `PlaylistPlayer` (DESIGN.md §8); crossfades already start the next voice early (§8.4).

#### Committed browser smoke tests

The UI and `WebAudioEngine` have been checked by driving the real page in headless Chromium over the DevTools protocol, using only Node's built-in `WebSocket`. That script lives outside the repository.

- **Notes:** commit it (for example as `scripts/browser-smoke/` with an `npm run smoke` script) so the checks can be repeated. It needs a local Chromium and stays out of `npm run check`. See [`TESTING.md`](TESTING.md). It becomes more valuable as the dialogs add UI.

#### Media element reuse for Safari (only if needed)

New media elements are assumed to play in Safari once the audio context has been unlocked (DESIGN.md §12). If manual testing shows otherwise, `WebAudioEngine` could create a small pool of elements during a click and reuse them.

### Finally: design the remaining features

All the planned features are done. Next, write proposals for everything still open: the three items below and the "Later, unordered" entries above.

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
