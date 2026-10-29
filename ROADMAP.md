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

**Goal.** Every sound and track records where it came from. Downloads already do. Files named by `yt-dlp` (`Title [dQw4w9WgXcQ].mp3`) get their YouTube source from the file name, files with a link in their tags get it from there, and everything else is marked as having no known origin. A new **Metadata** item in the sound and playlist context menus opens a read-only dialog that shows the source of a sound, or of every track in a playlist, with clickable links. Editing the source comes later, so its shape and the dialog are kept ready for that.

**Design changes.**

- **§2.3 Sound or track options.** `source` gets an `origin`, saying how it was learned:
  ```json
  "source": { "origin": "fileName", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "extractor": "Youtube", "videoId": "dQw4w9WgXcQ" }
  ```
  - `"download"` is written by downloads from now on. A `source` without `origin`, as older downloads have, counts as `"download"` too.
  - `"fileName"` marks an id found in the file name, and `"tags"` a link found in the file's tags.
  - `"unknown"` marks a file whose origin couldn't be found (G). A source like that is just `{ "origin": "unknown" }`. Every file then has a `source` after its first start, so none is examined twice.
  - `"edited"` is reserved for the future editor.
  - Validation: `origin` must be one of these five strings. All the other keys stay optional (`url` included), as today.
  - New downloads of a chapter also store `chapterStart` (seconds, 3 decimals), so the chapter can be linked (H).
- **§3.1–3.3 Bootstrap**, a new step after the options files are written. Every sound and track whose options file has no `source` gets one (A), merged into the file:
  1. **The file name** (B). The last `[…]` right before the extension, if it holds exactly 11 characters of `A–Z a–z 0–9 _ -`, is a YouTube video id. The source becomes `{ origin: "fileName", url: "https://www.youtube.com/watch?v=<id>", extractor: "Youtube", videoId }`. Nothing is checked online (C).
  2. **Otherwise, the tags** (I). The first `http:` or `https:` link in the tags where `yt-dlp --embed-metadata` puts the page link becomes `{ origin: "tags", url }`, with `extractor` and `videoId` added when it is a YouTube link. Those tags are ID3v2 `WXXX`, `TXXX` "purl", `WOAS` and `COMM`, and Vorbis `PURL`, `COMMENT` and `DESCRIPTION`.
  3. **Otherwise** it is `{ origin: "unknown" }`.
  - **The title loses the id** (D). When the id came from the file name, ` [<id>]` is removed from the title. A title that is still exactly the file name also loses its extension, as downloads name their files (§2.4). So `Battle [dQw4w9WgXcQ].ogg` becomes "Battle". A title the user changed keeps everything except the ` [<id>]` part.
  - The reporter counts these writes with the other generated options. Refreshes (§3.6) run bootstrap, so they do the same for files that arrived since.
- **§4 Metadata extraction.** A new `readSourceLink(filePath) → Promise<string | null>` reads the tags above with the same bounded reads and limits as the title.
- **§5.1, §5.2 library.** `AudioFile` and the `/api/library` format gain `source`, the stored object with `origin` filled in, or `null` (only possible before bootstrap has written it). The library being the single place is what a later editor needs.
- **§6.1 facade.** Nothing new: the dialog reads `source` from `getLibrary()`. `LibraryModel` keeps it with the rest of each file, and additions bring it along.
- **§9.3 context menus.** **Metadata** comes after Customize in both menus.
- **New §9.13 Metadata dialog** (`ui/metadata-dialog.js`), read-only, titled `Metadata: "<title>"` (E).
  - **A sound** shows one raised card (`card`, §9.7) with label/value rows:
    - **File:** the path inside the root.
    - **Origin:** "Downloaded", "Found in the file name", "Found in the file's tags" or "Unknown".
    - **Link:** the `url`.
    - **Site:** the `extractor`.
    - **Video:** the `videoId`.
    - **Playlist:** the `playlistId`.
    - **Chapter:** the `chapter` number.
  - **No value** shows an italic "n/a" at lower opacity (`italic text-muted/70`).
  - **Links** open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`):
    - **Link** links to its `url`.
    - **For YouTube only**, links are rebuilt from the ids:
      - **Video:** `https://www.youtube.com/watch?v=<videoId>`.
      - **Playlist:** `https://www.youtube.com/playlist?list=<playlistId>`, with a second link, "in playlist", to `watch?v=<videoId>&list=<playlistId>`.
      - **Chapter:** `watch?v=<videoId>&t=<whole seconds>s` when `chapterStart` is known. Without it, the chapter number is plain text (H).
  - Long values end in "…", with the full value as a tooltip. Everything can be selected and copied.
  - The rows are built from a list of field descriptions (label, key, how to link), so an editor can later turn each into a field.
  - **A playlist** shows one card per track in playlist order, in one scrolling list (F). Each card's title is the track number and title, and its rows are as above.
- **TESTING.md.** Manual checks for both dialogs, each origin, the rebuilt links and "n/a".

**Answers so far.**

- **A. Every file without a `source` gets one at start or refresh**, so the check runs once per file: found in the file name, found in the tags, or `"unknown"`.
- **B. The `yt-dlp` convention.** Only the last `[…]` before the extension, 11 characters. False positives are accepted.
- **C. Nothing is checked online.**
- **D. Titles drop the id.**
- **E. The dialog shows the source and its fields**: link, site, video, playlist and chapter, plus the origin and the file's path.
- **F. One scrolling list**, a raised card per track.

- **G. No known origin is `"unknown"`.**
- **H. Downloads store `chapterStart` from now on.** No chapter files exist yet, so none lack it.
- **I. Links in tags are read from the tags named above.** The known forms of YouTube links are recognized: `youtube.com/watch?v=`, `m.` and `music.youtube.com`, `youtu.be/<id>`, `/shorts/<id>`, `/embed/<id>` and `/live/<id>`. A `list=` parameter fills in `playlistId`. More forms can be added when testing finds them.
- **J. No downloads exist without `origin`.** A `source` without one is still read as `"download"`, which costs nothing.

**Plan.** In the lean flow: code first, with the owner checking the UI, then tests and DESIGN.md in one sweep.
1. **Source rules** (pure): finding the id in a file name, cleaning the title, building YouTube links, and validating `origin`. Downloads write `origin` and `chapterStart`.
2. **`readSourceLink`** for ID3v2 and Vorbis comments.
3. **Bootstrap** gives every file without a `source` one, and renames as in D.
4. **Library and API**: `source` on `AudioFile`, in `/api/library` and in `LibraryModel`.
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
