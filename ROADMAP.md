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

### Downloading sounds and tracks from a link

**Goal.** The user pastes a link and the server downloads it into the audio directory, as a new sound effect, a new playlist, or more tracks for an existing playlist. A direct link to an audio or video file is fetched by the server itself. Any other link goes to `yt-dlp`, which first looks it up so the user can choose what to download:

- a single video without chapters is downloaded as it is;
- a single video with chapters can be split into one file per chapter, and the user picks which chapters to keep;
- a playlist, album or channel lists its entries, and the user picks which ones to download.

Everything is stored as `.ogg`. New items appear on the board as each file finishes. The page doesn't reload, so music that is playing keeps playing.

Three places start a download:

1. an **Add sound** button in the Sound Effects section header;
2. an **Add playlist** button in the Playlists section header;
3. an **Add tracks** button in the playlist dialog's Tracks tab (and an "Add tracks…" item in the playlist menu).

**Design changes.**

- **§1, §1.1 Overview and constraints.** "Nothing is ever fetched from the internet" stays true for the browser only. The server now fetches the links the user pastes. `yt-dlp` and `ffmpeg` become **optional external programs**: they are found on `PATH`, run as child processes, and never bundled or installed by the app. Without them the app works exactly as it does today. This is not an npm dependency, but it is a new kind of dependency, so it needs the owner's approval (question 1).
- **§2.1 Directory layout.** Downloads work in `<root>/.soundboard-downloads/`. The name starts with `.`, so the scanner and the change watcher already ignore it. It is on the same file system as the root, so a finished file can be renamed into place atomically.
- **§3.1, §3.4 Bootstrap.** After the scan, bootstrap looks for the tools (`yt-dlp --version`, `ffmpeg -version`) and prints one line, for example `Downloads: yt-dlp 2026.08.19, ffmpeg 7.1` or the warning `Downloads: yt-dlp not found, so only direct links can be added`. It deletes whatever an earlier run left in `.soundboard-downloads/`.
- **§5.1 Domain model.** `LibraryEditor` gains `addSound(file, { title })`, `createPlaylist({ title })` and `addTrack(playlistId, file, { title })`. Each one moves a finished file into place under a safe, unique name (question 8), writes its options file with the title and the measured duration (§3.5), adds it to `Library.files` and to its list, and sorts as usual. A new playlist's directory and options file are created with its first track, so an empty playlist never exists.
- **§5.4 Downloads (new), `src/downloads/`.** This is the new domain.
  - `DownloadService` holds the jobs and runs them one at a time, in order (question 9). A job has a target (`sound`, `newPlaylist` with its title, or `playlist` with its id), its items, and a state: `queued`, `downloading`, `converting`, `done`, `failed` or `cancelled`. Each item carries its own state and progress. An item that fails doesn't stop the others (question 11).
  - External programs sit behind ports, with test fakes: `ProcessRunner` (spawns a program with an argument array, never through a shell, and streams its output lines), `LinkFetcher` (Node's `fetch` for direct links), and the adapters `YtDlp` and `Ffmpeg` built on `ProcessRunner`.
  - **Lookup** (`probe(url)`). Only `http:` and `https:` links are accepted. The server first sends a request to the link. A response with an `audio/*` or `video/*` content type is a **direct file** (question 12). Anything else goes to `yt-dlp -J --flat-playlist --no-playlist -- <url>`, which returns JSON. That JSON is reduced to `{ kind: 'video', title, duration, chapters: [{ title, start, end }] }` or `{ kind: 'playlist', title, entries: [{ id, title, duration, url }] }`. The URL always follows `--`, so a link can never be read as an option. Live streams are refused.
  - **Download.** `yt-dlp -f bestaudio/best` saves the file into the job's temporary folder; `--newline` and a `--progress-template` give progress lines. A direct link is streamed to disk by `LinkFetcher`.
  - **Conversion** (question 3) runs through `ffmpeg`, so direct links and `yt-dlp` downloads share one path. An `.mp3` or `.ogg` direct link is kept as it is. Everything else is encoded to Ogg Vorbis. A chapter is cut from the downloaded file with `-ss` and `-to` while it is encoded (question 4). `-progress pipe:1` gives the progress.
  - **Cancelling** kills the running process and deletes the job's temporary folder. Items already added stay.
  - Jobs live in server memory. A page reload sees them again, but a server restart forgets them (and cleans up, §3.1).
- **§5.2 HTTP API.** New endpoints:
  - `GET /api/downloads`: `{ tools: { ytDlp, ffmpeg }, jobs: [...] }`.
  - `POST /api/downloads/probe` `{ url }`: the lookup result. `422` with a message when the link can't be used (no `yt-dlp`, an unsupported site, a live stream, or `yt-dlp`'s last error line).
  - `POST /api/downloads` `{ url, target, items }`: queues a job and returns it.
  - `DELETE /api/downloads/<id>`: cancels a job.
  - The event stream (`/api/events`) gets typed messages: `{ type: 'externalChanges', pending }` (today's message), `{ type: 'downloads', jobs }` while jobs change (at most 4 times a second), and `{ type: 'library.added', sound }` or `{ type: 'library.added', playlist }` (the whole playlist, in the `/api/library` format) once a file has been added.
- **§5.3 Change watcher.** Adding a file goes through the watcher's queue ("taking turns"), so it never overlaps a refresh or a comparison. It records the new audio and options files in the baseline, so the app's own additions never count as external changes. A refresh (§3.6) waits for an addition in progress, and the reverse.
- **§6.1, §6.2 Facade and events.** New methods: `getDownloadTools()`, `probeLink(url) → Promise<ProbeResult>`, `startDownload({ url, target, items }) → Promise<void>`, `cancelDownload(jobId)` and `getDownloads()`. They are not commands, because they are not playback, like waveforms (§6.6). New events: `downloads.changed { jobs }`, `sound.added { sound }` and `playlist.added { playlist }`. Tracks added to an existing playlist are announced as `playlist.changed`, as renames are. After an addition, waveform generation runs again for the new files (§6.6).
- **§6.7 External changes.** "The page never changes its library while it runs" no longer holds. It now changes for **its own additions** only; external changes still go through Refresh and a reload. The section and its introduction need rewording.
- **§8.1 Playlist playback.** A playlist can gain tracks while it plays (question 10). `PlaylistPlayer` takes the new track list without touching the current voice, and the play history is refilled around the current track, as a change of order already does.
- **§9.1 Layout.** The section headers "Playlists" and "Sound Effects" get small **+ Add playlist** and **+ Add sound** buttons. Both sections are then always shown, even when empty, so the buttons can be reached; the empty-board message sits under them. A **Downloads** indicator in the header, left of the waveform progress, reads "Downloading 2 / 7 · 43 %" and is shown only while jobs are queued or running, or have failed. Clicking it opens a popover listing the jobs and their items, with a Cancel button per job and the error of each failed item. The whole download area is disabled, with a tooltip, when the tools it needs are missing.
- **§9.3 Playlist menu.** Adds "Add tracks…", which opens the add dialog for that playlist.
- **§9.7 Playlist dialog.** The Tracks tab gets an **Add tracks** button under the list.
- **§9.9 Add dialog (new)**, `ui/add-dialog.js`, in the target's accent (amber for sounds, blue for playlists).
  1. **Link.** A filled field "Link" and a **Look up** button. While the lookup runs, the button is disabled and reads "Looking up…". Errors are shown under the field.
  2. **Choice**, depending on the result:
     - *Direct file or plain video:* its title and duration.
     - *Video with chapters:* a radio group, **One file** "The whole video as one file." or **Split into chapters** "One file per chapter." Splitting shows a checklist of the chapters with their durations and Select all / Select none, all of them ticked.
     - *Playlist:* the same checklist for its entries, all ticked, with a note when the list was cut short (question 7).
     - For a **new playlist**, a Title field filled in with the video's or playlist's title.
  3. **Download** queues the job and closes the dialog. Progress is shown in the header (above).

  Downloads for **sounds** follow the same choices: each chosen chapter or entry becomes its own sound.
- **§10 Project structure** lists `src/downloads/` and the new UI files. **§12 Target machine** notes that downloads use disk space in the root, up to roughly twice the largest download while it converts.

**Open questions.**

1. **May the server run `yt-dlp` and `ffmpeg`?** They are optional, found on `PATH`, and never bundled. *Recommended:* yes. Startup reports what it found, and a feature whose tool is missing is disabled in the UI with a tooltip. Paths can't be configured for now; a `--yt-dlp <path>` option can come later if it's ever needed.
2. **Should the page update in place, or refresh and reload as external changes do?** A reload stops all playback, which is bad when a track is added in the middle of a session. *Recommended:* update in place, as described above. It also gives moving and deleting files (backlog) the seam they will need.
3. **Which codec?** Safari's Ogg support depends on its version (§12), and the MacBook runs Safari. Options are Ogg **Vorbis** (re-encoded, works wherever Ogg works) and Ogg **Opus** (YouTube's audio is usually Opus already, so it could be copied into an `.ogg` container without re-encoding: faster and lossless). *Recommended:* Vorbis at `-q:a 5` (about 160 kbps), kept as one constant so it is easy to change. **Please check which Safari version the MacBook has, and whether it plays the `.ogg` files in the example fixture.** If it doesn't, MP3 may be the better target.
4. **How are chapters split?** *Recommended:* `yt-dlp` downloads the whole audio once, and our `ffmpeg` step cuts each chosen chapter while it encodes. The alternative, `yt-dlp --split-chapters`, can't skip chapters and leaves less control over names and progress.
5. **Can playlist entries be split into chapters too?** The flat listing that makes large playlists fast doesn't include chapters. *Recommended:* no; entries are downloaded whole.
6. **What about a link that names both a video and a playlist** (`watch?v=…&list=…`)? *Recommended:* look up just the video (`--no-playlist`). When the link also names a playlist, the dialog shows "Show the whole playlist instead", which looks the link up again as a playlist.
7. **How long can an entry list be?** A channel can hold thousands of videos. *Recommended:* list at most the first 500 (`--playlist-end 500`) and say so in the dialog.
8. **How are files named?**
   - The name is the title, with the characters `/ \ : * ? " < > |` and control characters removed, and leading dots and spaces stripped (a leading dot would hide the file, §2.1). It is cut to 120 characters, gets the extension `.ogg`, and gets ` (2)`, ` (3)`… when the name is taken. The options file stores the original title.
   - Tracks of a **new playlist** are prefixed `01 `, `02 `… in source order, because tracks sort by path (§2.2).
   - Tracks **added to an existing playlist** continue that numbering when every existing track file starts with a number; otherwise they get no prefix.
   - A new playlist's directory is named after its title in the same way, with ` (2)` when the name is taken.

   *Recommended:* as above.
9. **One job at a time?** *Recommended:* yes, a single queue. Several downloads at once from one site invite rate limits, and conversion already uses the CPU.
10. **What happens when tracks are added to a playlist that is playing?** *Recommended:* they join at once. Ordered playback reaches them in path order. Random and shuffle refill the history around the current track, as a change of order does (§8.1). The current track keeps playing.
11. **What if some items of a job fail?** *Recommended:* the rest carry on. The job ends as `failed` with a count, and the downloads popover shows each failed item with its error. Nothing retries by itself.
12. **How is a direct link recognized?** *Recommended:* by the response's `Content-Type` (`audio/*` or `video/*`), not by the URL's extension, because many file links have none. HTML pages and everything else go to `yt-dlp`. Without `yt-dlp`, those links get a clear error.

**Out of scope.** Sign-ins, cookies and age-restricted videos (`--cookies-from-browser`). Choosing titles for each item in the dialog (they can be renamed afterwards, §9.7). Moving and deleting files (backlog).

**Plan.**

1. **Tool detection and process runner** (`ProcessRunner`, `findTools`). Tested with a fake runner: versions are parsed, a missing program is reported, the startup line is printed, and old temporary folders are cleaned up.
2. **Lookup** (`probe`). Tested with small hand-written `yt-dlp` JSON samples and a fake `LinkFetcher`: direct files, plain videos, videos with chapters, playlists, the 500-entry cap, live streams, a non-http link, and `yt-dlp`'s error lines.
3. **File naming** (pure functions). Tested: sanitizing, leading dots, the length limit, ` (2)` suffixes, the numbering rules, and directory names.
4. **Library additions** (`LibraryEditor.addSound`, `createPlaylist`, `addTrack`). Tested on a temporary tree: files are moved into place, options files hold the title and duration, the library is sorted, the watcher's baseline is updated (so there is no external change), and additions take turns with a refresh.
5. **Download jobs** (`DownloadService` with fake `YtDlp`, `Ffmpeg` and `LinkFetcher`). Tested: the queue order, states and progress, chapter cuts with the right times, MP3 and OGG direct links kept as they are, an item failing while the rest carry on, cancelling (the process is killed, the folder deleted), and jobs listed after the fact. One integration test runs the real `ffmpeg` on a fixture file copied to a temporary folder, and is skipped when `ffmpeg` is missing.
6. **HTTP endpoints and typed event messages.** Tested with the HTTP client helper: probe, start, list and cancel, status codes and validation, `downloads` and `library.added` messages, and the reworded `externalChanges` message.
7. **Frontend logic.** New `BackendApi` and `ServerEvents` methods, the facade methods and events, `LibraryModel` adding sounds, playlists and tracks, `PlaylistPlayer` taking a new track list while it plays, and waveforms running again for new files. Tested with the fakes.
8. **UI:** the Add buttons, the add dialog, the downloads indicator and popover, the playlist menu item, and the Tracks tab button. Manual checks are added to `TESTING.md`.
9. **`DESIGN.md`** describes the feature, in its own commit, and this proposal is removed.

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

#### Moving and deleting files

Move a sound into a playlist, a track out of a playlist or into another one, and delete sounds and tracks, all from the UI.

- **Seam:** the in-place library updates from "Downloading sounds and tracks from a link" (`LibraryEditor` additions, `library.added` messages, `playlist.changed`) extend to removals and moves. The change watcher's baseline has to follow every move, and an options file and a waveform (`.json`, `.wf`) move or go together with their audio file.
- **Notes:** decide what happens to a track or sound that is playing when it moves or is deleted. Deleting should probably move files to a `.soundboard-trash/` folder rather than remove them, so a mistake at the table can be undone.

#### Search, filter and keyboard shortcuts

- **Seam:** UI only, built on the existing facade.

#### More saved preferences

- **Seam:** `.soundboard` settings, `SettingsStore` and the `/api/settings` endpoints (DESIGN.md §2.3, §5.2).

#### Context menus on touch screens

Long press to open a tile's menu.

- **Seam:** the shared `Overlay` and `openContextMenu()` (DESIGN.md §9.3).

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
