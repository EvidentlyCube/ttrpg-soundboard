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

Everything is stored as `.ogg`, under the file name it was downloaded with. While a download runs, a dialog that can't be dismissed shows the output of the tool that is running. New items appear on the board as each file finishes. The page doesn't reload, so music that is playing keeps playing. Each new file's options file records where the file came from (`source`).

Three places start a download:

1. an **Add sound** button in the Sound Effects section header;
2. an **Add playlist** button in the Playlists section header;
3. an **Add tracks** button in the playlist dialog's Tracks tab (and an "Add tracks…" item in the playlist menu).

The buttons are always there. When the tools are missing, clicking one only shows a notice saying so.

**Design changes.**

- **§1, §1.1 Overview and constraints.** "Nothing is ever fetched from the internet" stays true for the browser only. The server now fetches the links the user pastes. `yt-dlp` and `ffmpeg` are **external programs**: they are found on `PATH`, run as child processes, and never bundled or installed by the app. Both are needed for downloads; without them the rest of the app works as it does today.
- **§2.1 Directory layout.** Downloads work in `<root>/.soundboard-downloads/`. The name starts with `.`, so the scanner and the change watcher already ignore it. It is on the same file system as the root, so a finished file can be renamed into place atomically.
- **§2.3 File formats.** Sound and track options files get an optional `source`, written only by downloads, never by hand or through `PATCH`. It isn't sent to the browser yet.
  ```json
  "source": { "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "extractor": "Youtube", "videoId": "dQw4w9WgXcQ", "playlistId": "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG", "chapter": 3 }
  ```
  - A **direct link** stores only `url`, the full link as pasted.
  - A **`yt-dlp` download** stores the video's page `url`, `extractor` (`yt-dlp`'s `extractor_key`, because an id only means something on its own site) and `videoId`. `playlistId` is stored only when a playlist was downloaded, and `chapter` (counting from 1) only for a file cut from one chapter (question A).
  - **Validation:** `source` must be an object, its known keys strings, and `chapter` a positive integer. Unknown keys inside are kept.
- **§2.4 Default titles.** Unchanged. A download writes the title its source gives (question B).
- **§3.1, §3.4 Bootstrap.** After the scan, bootstrap looks for the tools (`yt-dlp --version`, `ffmpeg -version`). It prints `Downloads: yt-dlp 2026.08.19, ffmpeg 7.1`, or a warning such as `Downloads are off: ffmpeg was not found`. It also deletes whatever an earlier run left in `.soundboard-downloads/`.
- **§5.1 Domain model.** `LibraryEditor` gains `addSound(file, options)`, `createPlaylist(title)` and `addTrack(playlistId, file, options)`.
  - Each one moves a finished file into place under its download name. When that name is taken, ` (2)`, ` (3)`… is added before the extension, so nothing is ever overwritten.
  - It writes the options file with `title`, `source` and the measured duration (§3.5), adds the file to `Library.files` and its list, and sorts as usual. Tracks sort by path (§2.2), so added tracks take their place by name.
  - A new playlist's directory, named after its title in the same way, and its options file are created with its first track, so an empty playlist never exists.
- **§5.4 Downloads (new), `src/downloads/`.** This is the new domain.
  - **One job at a time.** `DownloadService` runs at most one job, and starting another while one runs is refused. A job has a target (`sound`, `newPlaylist` with its title, or `playlist` with its id), its items, and a state: `downloading`, `converting`, `done`, `failed` or `cancelled`. An item that fails doesn't stop the others. A finished job stays until the user dismisses it, so its summary survives a reload.
  - **Ports with test fakes.** External programs sit behind ports:
    - `ProcessRunner` spawns a program with an argument array, never through a shell, and streams its stdout and stderr as lines;
    - `LinkFetcher` uses Node's `fetch` for direct links;
    - the adapters `YtDlp` and `Ffmpeg` are built on `ProcessRunner`.
  - **The log.** Each run starts the log with its command line (`$ yt-dlp …`), followed by everything the program prints. A line ended by a carriage return alone is replaced by the next one, as a terminal shows progress, so `yt-dlp`'s and `ffmpeg`'s progress lines update in place instead of piling up. The job keeps the last 1000 lines. Direct downloads write their own progress lines in the same style.
  - **Lookup** (`probe(url)`).
    - Only `http:` and `https:` links are accepted. The URL always follows `--`, so a link can never be read as an option.
    - The server first sends a `GET` to the link and closes it once the headers arrive. A response with an `audio/*` or `video/*` content type is a **direct file**: `{ kind: 'file', name, size }`. The size comes from `Content-Length`, and is `null` when it's missing. The name comes from `Content-Disposition`, then the last part of the URL's path.
    - Anything else goes to `yt-dlp -J --flat-playlist --no-playlist -- <url>`. That gives `{ kind: 'video', id, title, duration, size, chapters: [{ title, start, end }] }`, where `size` is the chosen format's `filesize` or `filesize_approx`, or `null`. It can also give `{ kind: 'playlist', id, title, entries: [{ id, title, duration, url }] }`. A flat listing has no sizes.
    - Live streams are refused.
  - **Download.**
    - `yt-dlp -f bestaudio/best --newline` saves into the job's temporary folder with its default name template, `%(title)s [%(id)s].%(ext)s`. The `[id]` part is what a later scan of existing files can recognize (backlog).
    - A direct link is streamed to disk under its probed name. It stops with an error if more bytes arrive than `Content-Length` announced.
  - **Conversion** always runs through `ffmpeg`, for direct links and `yt-dlp` downloads alike.
    - An `.mp3` or `.ogg` direct link is kept as it is.
    - Everything else is encoded to Ogg Vorbis (`-q:a 5`, about 160 kbps). The extension becomes `.ogg` and the rest of the name stays.
    - A chapter is cut from the one downloaded file with `-ss` and `-to` while it is encoded. It is named like `yt-dlp --split-chapters` would name it: `<title> - 003 <chapter title> [<id>].ogg`.
  - **Cancelling** kills the running process and deletes the job's temporary folder. Items already added stay.
  - Jobs live in server memory. A page reload sees the job again, with its log, but a server restart forgets it (and cleans up, §3.1).
- **§5.2 HTTP API.** New endpoints:
  - `GET /api/download`: `{ tools: { ytDlp, ffmpeg }, job }`, where `job` is `null` or the current job with its log.
  - `POST /api/download/probe` `{ url }`: the lookup result. `422` with a message when the link can't be used (an unsupported site, a live stream, or `yt-dlp`'s last error line). `503` when the tools are missing.
  - `POST /api/download` `{ url, target, items }`: starts the job and returns it. `409` while another one runs.
  - `DELETE /api/download`: cancels the running job, or dismisses a finished one.
  - **Typed event messages.** The event stream (`/api/events`) gets typed messages:
    - `{ type: 'externalChanges', pending }`, today's message;
    - `{ type: 'download', job }` without the log, whenever the job's state or current item changes;
    - `{ type: 'download.log', lines, replaceLast }`, batched at most 4 times a second;
    - `{ type: 'library.added', sound }` or `{ type: 'library.added', playlist }` (the whole playlist, in the `/api/library` format), once a file has been added.
- **§5.3 Change watcher.** Adding a file goes through the watcher's queue ("taking turns"), so it never overlaps a refresh or a comparison. It records the new audio and options files in the baseline, so the app's own additions never count as external changes. A refresh (§3.6) waits for an addition in progress, and the reverse.
- **§6.1, §6.2 Facade and events.**
  - New methods: `getDownloadTools()`, `probeLink(url) → Promise<ProbeResult>`, `startDownload({ url, target, items }) → Promise<void>`, `cancelDownload()`, `dismissDownload()` and `getDownload()` (the job with its log). Like waveforms (§6.6), they aren't commands, because they aren't playback.
  - New events: `download.changed { job }`, `download.log { lines, replaceLast }`, `sound.added { sound }` and `playlist.added { playlist }`. Tracks added to an existing playlist are announced as `playlist.changed`, as renames are.
  - After an addition, waveform generation runs again for the new files (§6.6).
- **§6.7 External changes.** "The page never changes its library while it runs" no longer holds. It now changes for **its own additions** only, which only ever add; external changes still go through Refresh and a reload. The section and its introduction need rewording.
- **§8.1 Playlist playback.** A playlist can gain tracks while it plays. `PlaylistPlayer` takes the new track list without touching the current voice, and the play history is refilled around the current track, as a change of order already does.
- **§9.1 Layout.**
  - The section headers "Playlists" and "Sound Effects" get small **+ Add playlist** and **+ Add sound** buttons. Both sections are then always shown, even when empty, so the buttons can be reached; the empty-board message sits under them.
  - When `getDownloadTools()` reports a missing tool, the Add buttons stay enabled. Clicking one opens a small notice instead of the add dialog: "Downloads need yt-dlp and ffmpeg. ffmpeg was not found when the app started. Install it, then restart the app."
- **§9.3 Playlist menu.** Adds "Add tracks…", which opens the add dialog for that playlist.
- **§9.7 Playlist dialog.** The Tracks tab gets an **Add tracks** button under the list.
- **§9.9 Add dialog (new)**, `ui/add-dialog.js`, in the target's accent (amber for sounds, blue for playlists).
  1. **Link.** A filled field "Link" and a **Look up** button. While the lookup runs, the button is disabled and reads "Looking up…". Errors are shown under the field.
  2. **Choice**, depending on the result:
     - *Direct file:* its name and **size** ("Size unknown" when the server didn't say).
     - *Plain video:* its title, duration and size when `yt-dlp` knows it.
     - *Video with chapters:* a radio group, **One file** "The whole video as one file." or **Split into chapters** "One file per chapter." Splitting shows a checklist of the chapters with their durations and Select all / Select none, all of them ticked.
     - *Playlist:* the same checklist for its entries, all ticked, with a note when the list was cut short at 500. A link that names both a video and a playlist is looked up as the video; the dialog then offers "Show the whole playlist instead".
     - For a **new playlist**, a Title field filled in with the video's or playlist's title.
     - Downloads for **sounds** offer the same choices: each chosen chapter or entry becomes its own sound.
  3. **Download.** The button shows the size when it is known ("Download 1.4 GB"). A known size over 500 MB, or an unknown size, puts a warning above it ("This is a large file." or "The size of this file is unknown."), so a huge file is never downloaded by accident. Clicking Download replaces this dialog with the download dialog.
- **§9.10 Download dialog (new)**, `ui/download-dialog.js`. It is shown while a job exists, in every open tab, and again after a reload.
  - **Locked.** It has no × button, and neither Esc nor the backdrop closes it. It covers the board and the footer the way the Customize dialogs do (§9.7), so the page can't be used until the job ends (question C). Playback that was already running carries on underneath.
  - **Top:** the target ("Adding to Combat"), "Item 3 of 7: <title>" and the step (Downloading, Converting).
  - **Log:** the job's log in a monospace pane, about 20 lines tall, that follows new lines unless the user has scrolled up. Lines are only ever appended as text, or the last one rewritten, never re-rendered (§9.6).
  - **Cancel**, which asks "Cancel the download? Files already added stay." first.
  - **When the job ends,** the pane stays and a summary appears above it ("6 added, 1 failed", with each failed item and its error). A **Close** button calls `dismissDownload()`.
- **§12 Target machine.**
  - Downloads use disk space in the root: up to roughly twice the largest download while it converts.
  - The Safari notes are updated separately (see below).
- **§10 Project structure** lists `src/downloads/` and the new UI files.

**Decided.**

- **The tools.** The server may run `yt-dlp` and `ffmpeg`. They are checked at startup, and both are needed.
- **The library.** It updates in place, because downloads only ever add.
- **Safari plays Ogg.** `DESIGN.md` §9.5 and §12 now say so, in a separate commit; `canPlayType` stays as a safety net. The codec is Ogg Vorbis.
- **File names.** A file keeps the name it was downloaded with. There is no numbering, and a playlist's order follows the names.
- **Chapters.** `yt-dlp` downloads the whole audio once, and `ffmpeg` cuts the chosen chapters while encoding. Playlist entries aren't split into chapters.
- **Links that name both a video and a playlist** are looked up as the video, with the playlist one click away.
- **Entry lists** stop at 500 entries.
- **Playlists that are playing** take new tracks at once.
- **Failed items** don't stop the job, and nothing is retried by itself.
- **Direct links** are recognized by their content type.

**Open questions.**

- **A. What does `source` hold beyond what you asked for?**
  - You asked for the URL of a direct link, and the video id and playlist id of a `yt-dlp` download.
  - *Recommended:* also store the page `url` and the `extractor` for `yt-dlp` downloads, because an id alone doesn't say which site it belongs to. Also store `chapter` for a file cut from a chapter, because otherwise every chapter file of a video would carry the same `source`.
- **B. What title should the options file get?**
  - You chose to keep the downloaded name for the file. Without a `title` in the options file, the tile would show that whole name, for example `Battle Theme [dQw4w9WgXcQ].ogg`.
  - *Recommended:* write the source's title: the video's, the entry's or the chapter's title, and the file name for a direct link. It can be changed later in Customize.
- **C. Should the footer stay usable while the download dialog is open?**
  - Downloading a playlist can take many minutes, and with the whole page locked, nobody can skip or stop music during that time.
  - *Recommended:* lock the board but leave the footer's player bars usable, by placing the dialog above the board and below the footer. If you want everything locked as you described, the dialog simply covers the footer as well.

**Out of scope.**

- Sign-ins, cookies and age-restricted videos (`--cookies-from-browser`).
- Choosing titles for each item in the dialog. They can be renamed afterwards (§9.7).
- Showing `source` in the UI, and reading it from existing file names (backlog).
- Moving and deleting files (backlog).

**Plan.**

1. **Tool detection and process runner** (`ProcessRunner`, `findTools`). Tested with a fake runner:
   - versions are parsed and a missing program is reported;
   - the startup line is printed;
   - old temporary folders are cleaned up;
   - output is split into lines, including carriage-return progress lines.
2. **`source` in options files** (§2.3). Tested: validation, and that unknown keys inside `source` are kept.
3. **Lookup** (`probe`). Tested with small hand-written `yt-dlp` JSON samples and a fake `LinkFetcher`:
   - direct files with and without a size, and their names from `Content-Disposition` or the URL;
   - plain videos with sizes, videos with chapters, and playlists;
   - the 500-entry cap;
   - live streams, a non-http link, and `yt-dlp`'s error lines.
4. **File names** (pure functions). Tested:
   - chapter names;
   - the extension change to `.ogg`;
   - ` (2)` suffixes;
   - stripping a leading dot, which would hide the file (§2.1);
   - unsafe characters in direct-link names and playlist directory names.
5. **Library additions** (`LibraryEditor.addSound`, `createPlaylist`, `addTrack`). Tested on a temporary tree:
   - files are moved into place;
   - options files hold the title, the source and the duration;
   - the library is sorted;
   - the watcher's baseline is updated, so there is no external change;
   - additions take turns with a refresh.
6. **Download jobs** (`DownloadService` with fake `YtDlp`, `Ffmpeg` and `LinkFetcher`). Tested:
   - one job at a time, its states and current item, and the log with its command lines and its 1000-line limit;
   - chapter cuts with the right times and names;
   - MP3 and OGG direct links kept as they are, and a download stopped when it runs past `Content-Length`;
   - an item failing while the rest carry on;
   - cancelling (the process is killed, the folder deleted), and dismissing.

   One integration test runs the real `ffmpeg` on a fixture file copied to a temporary folder. It is skipped when `ffmpeg` is missing.
7. **HTTP endpoints and typed event messages.** Tested with the HTTP client helper:
   - probe, start, cancel and dismiss, with their status codes (`409`, `503`) and validation;
   - the `download`, `download.log` and `library.added` messages;
   - the reworded `externalChanges` message.
8. **Frontend logic.** New `BackendApi` and `ServerEvents` methods, the facade methods and events, `LibraryModel` adding sounds, playlists and tracks, `PlaylistPlayer` taking a new track list while it plays, and waveforms running again for new files. Tested with the fakes.
9. **UI:**
   - the Add buttons and the missing-tools notice;
   - the add dialog with sizes and warnings;
   - the locked download dialog with its log;
   - the playlist menu item and the Tracks tab button.

   Manual checks are added to `TESTING.md`.
10. **`DESIGN.md`** describes the feature, in its own commit, and this proposal is removed.

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

#### Where files came from

Downloads record their origin in the options file's `source` (see "Downloading sounds and tracks from a link").

- **Recognizing existing files:** bootstrap could look in each file name for a YouTube video id in square brackets, as `yt-dlp` names files (`Title [dQw4w9WgXcQ].mp3`, matching `\[([A-Za-z0-9_-]{11})\]`), and store `source: { extractor: 'Youtube', videoId }` when the options file has no `source` yet.
- **Showing it:** expose `source` in `/api/library` and in the Customize dialogs, for example as a link back to the video.

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
