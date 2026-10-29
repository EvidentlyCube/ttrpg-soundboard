# Soundboard — Testing

How the app is tested: the automated suite that runs in Node, the Playwright suite that drives the real page in a browser with a fake audio engine, and the manual checks in real browsers. [`DESIGN.md`](DESIGN.md) §11 summarizes the approach.

## Running the tests

- `npm test` runs every `*.test.js` with the built-in runner (`node --test`). A single file: `node --test test/backend/http/server.test.js`. Several: pass a glob in quotes, such as `node --test "test/frontend/*.test.js"`. A bare directory path does not work.
- `npm run check` runs type-checking, lint and the tests. It must pass before every commit. `npm test` covers `test/backend`, `test/frontend` and `test/helpers`; the browser suite is not part of it.
- `npm run test:browser` runs the Playwright suite (below). It needs the Playwright browsers (`npx playwright install chromium`) and is run on its own, as `npm run smoke` is. A single file or title: `npm run test:browser -- player-bar` or `npm run test:browser -- -g "pausing"`.

## Principles

- **Test first** for all domain and logic code: backend, metadata, library, HTTP, and everything in `public/app/logic/`.
- **The UI is tested in a browser, not in Node.** The UI components are checked by the Playwright suite (below), which drives the real page against the real server with the fake audio engine. `WebAudioEngine` is not covered by it, since the fake replaces it, and stays on the manual checklist. Pure helpers used by the UI (`format`, `menus`, `position`) are still unit-tested in Node.
- Tests live in `test/`, mirroring the source layout: `test/backend/`, `test/frontend/` and `test/helpers/`. They use `describe`/`it` from `node:test` and `node:assert/strict`, and their names describe behavior.
- **Fixtures stay pristine.** `test_fixtures/example_soundboard` is only ever read or copied to a temporary directory with `copyFixture()`, never written to.

## Test helpers (`test/helpers/`)

| Helper | What it does |
|---|---|
| `tmp-tree.js` | `createTmpTree(spec)` builds a directory tree from an object; `copyFixture(name)` copies a fixture into a temp directory. Both return `{ root, remove() }`. |
| `tag-builders.js` | Builds ID3v1/ID3v2 tags (every version and encoding, unsynchronization, extended headers, frame flags) and Ogg Vorbis/Opus pages in code, so metadata tests need no binary fixtures. |
| `fake-clock.js` | Timers that only fire when a test calls `advance(ms)`, in time order, including timers created by timers. |
| `fake-audio-engine.js` | The `AudioEngine` port on the fake clock, modelling media elements: load delay, `play()` before load, position advancing only while playing, `ended` once. Per-URL scripts add durations, load, play and decode errors, buffer sizes, and "leaky" voices that keep firing events after `stop()`. |
| `fake-backend-api.js` | The `BackendApi` port with settable library, settings and failures; records saves. |
| `fake-waveform-decoder.js` | The `WaveformDecoder` port: records the URLs it decodes, fails for chosen ones, and can be held back with a gate to act while a file is being decoded. |
| `seeded-random.js` | `seededRandom(seed)`, a repeatable stand-in for `Math.random` (mulberry32), for the random playback orders. |
| `fake-prompter.js` / `fake-reporter.js` | Scripted answers for bootstrap questions; records everything reported. |
| `fake-process-runner.js` | `fakeProcessRunner(program)` stands in for `runProcess`: `program(command, args, process)` answers each run of `yt-dlp` or `ffmpeg` (its output lines, exit code, captured stdout, or `'missing'`), and every call is recorded with whether it was killed. `untilKilled(signal)` plays a program that runs until it is killed. |
| `http-client.js` | `rawRequest()` sends a path exactly as given (for path traversal tests, which `fetch` would normalize); `findFreePort()`. |

## What the suite covers

| Area | Tests |
|---|---|
| Metadata | Every ID3 version and text encoding, extended headers, unsynchronization (tag-wide and per frame), group and data-length flags, compressed and encrypted frames, padding, the ID3v1 fallback; Ogg Vorbis and Opus, comments split across pages, multiplexed streams, the 1 MB limit; truncated and random data never throwing; every file in the example fixture. Source links in ID3 (`WXXX` in any encoding, `TXXX` "purl", `WOAS`, `COMM`, v2.2 ids, the order they are preferred in) and in Vorbis comments (`PURL`, `COMMENT`, `DESCRIPTION`). |
| Library | Classification (hidden files, symlinks, orphans, unsupported formats, case rules), scanning built trees and the fixture, natural sorting with deterministic ties, validation messages, atomic writes that keep unknown keys, the settings store's serialized writes. Tree snapshots and baselines (what counts, recorded hashes, new, gone, touched and replaced files with and without hashing). The change watcher with a fake `fs.watch` and the fake clock: the quiet second, quick checks, own writes, removals and renames, the 30 s fallback, refreshes taking turns with comparisons, plus one run with the real `fs.watch`. Source rules: ids in file names, the forms of YouTube links, guessing a source, titles without the id, and validating `origin` and `chapterStart`. |
| Bootstrap | First and later runs with a fake prompter: nested directories accepted or declined (declining writes nothing), metadata titles accepted or declined, `.soundboard` written last, validation errors gathered before anything is asked, empty playlists left alone, the example fixture end to end. Refreshes: new files, nested directories merged but not recorded (and asked about at the next start), validation errors, a missing `.soundboard`. Sources: an id in a new or existing file's name (and its title), a link in the tags, a recorded source left alone, one without `origin` read as a download. |
| CLI | Arguments and ports, colors and `NO_COLOR`, the prompter (including typed-ahead answers and closed input), reporter output, `main` from usage errors to serving and stopping, port in use, `--verbose`. |
| Downloads | Line splitting with carriage-return progress; finding the tools; turning `yt-dlp -J` output into lookups (chapters, playlists, the 500-entry cap, channel tabs, live streams) and its error lines; file names and titles; direct links against a local server (headers, names, progress, a file that grew since the lookup); the `yt-dlp` and `ffmpeg` arguments with a fake runner, plus one real `ffmpeg` cut, skipped when `ffmpeg` is missing. `LibraryEditor` additions on a temporary tree (free names, options files with title, source and duration, sorting, new playlists), deletions into the trash (companions, nested paths, ` (2)` clashes, merged playlist folders, the last track taking its playlist, saves queued before) and moves (sounds to tracks and back, clashes, nested tracks, options carried over). Reading the trash (titles, sizes, folders without audio, broken options files) and restoring from it (companions, ` (2)` clashes, flattened tracks, playlists recreated from their trashed options, whole playlists moved back or merged, Restore all's order, broken options files refused first, what the change watcher is told) and purging (single items, the last track taking its folder, everything). `DownloadService` with fake tools: whole videos, chapters, playlists with a failing entry, direct MP3 kept and WAV converted, one job at a time, invalid requests, cancelling, dismissing, and the log with its batches and its 1000-line limit. |
| HTTP | A real server on a random port: static files and MIME types, path traversal attempts, the library and settings API with its error codes, media with every range form, `HEAD`, `416`, clients disconnecting mid-stream, request logging. The event stream, `POST /api/changes/check` and `POST /api/refresh` with each status, shared refreshes, and a save sent during a refresh reaching the new library. The download endpoints with a fake runner: lookups and their errors, a download streamed over the event stream with its log and addition, `409` while one runs, the whole log on every new connection, `503` without the tools. The delete routes and `POST /api/move` with their answers, `library.removed` on the event stream, media served at the new place, and their error codes. `GET /api/trash`, the restore and delete routes with their error codes, and the `trash` message on connect and after each change. |
| Frontend logic | Event emitter; order strategies; transitions and rules; volume; settings sync and options sync (debounce, one save at a time, flush, settling, failures); library model; command validation; buffer cache (sharing, eviction, in-use protection); sound player (instances, both caps, cancelling pending decodes, errors, fading out and stopping everything); Panic Stop in the `Soundboard` facade (both states, the timer, new starts, stop modes); playlist player (every state transition, stale callbacks from leaky voices, previous/next/jump rules, seeking, progress, errors and the consecutive-error limit, fades with non-zero rules, the retiring cap); the `Soundboard` facade, including external changes, refreshing, and downloads and their additions (sounds, playlists, tracks for a playlist that plays) with a fake `ServerEvents`, deletions and moves (saves settled first, removals stopping what plays, applied once, cached buffers dropped); the play history and the playlist player taking added and removed tracks; `HttpBackendApi` against the real server. Regenerating every waveform, also over a run in progress. Pure UI helpers: menus, waveform shaping (decibels and rank), the metadata dialog's rows and rebuilt YouTube links. |
| Playlist invariant | 400 seeded random command sequences, with and without fades, in all three playback orders, with broken and leaky tracks: afterwards, at most one live voice while active, none and no timers while idle (DESIGN.md §8). |

## Browser tests (Playwright)

`test/browser/` holds specs that run in Chromium against the real page and the real server, on a temporary library. Only sound and time are fake: `/app/main.js` is replaced by `support/test-main.js`, a copy of the composition root that uses `FakeAudioEngine`, `FakeClock` and a `FakeWaveformDecoder` (made full size, since the server only takes complete waveforms) from `test/helpers/`, which the browser loads unchanged. The backend API and the event stream are the real ones, so saves, the watcher and refreshes really happen. Production code has no test hooks. Time stands still until a test calls `audio.advance(ms)`; work that is already due (a load that takes no time) runs by itself.

```
test/browser/
  playwright.config.js   Chromium; traces and screenshots go to a temp folder, never the repository
  support/               fixtures.js, server.js, test-main.js, audio.js, disk.js, globals.d.ts
  pages/                 one page object per area: splash, header, playlists, sounds, footer (with player bars)
  pages/dialogs/         customize-dialog.js (shared), sound-editor.js, playlist-editor.js, trash.js
  specs/                 *.spec.js, one per feature area
```

A spec asks for what it needs by name, and reads like a script:

```js
test('a playlist starts from its tile and keeps time in the footer', async ({ soundboard, splash, playlists, footer, audio }) => {
	await soundboard.open();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await playlists.click('Music MP3');
	await footer.expectPlayersCount(1);
	await audio.expectPlaying('Piece by Piece');

	await audio.advance(1000);
	await footer.player('Music MP3').expectTime('0:01 / 3:00');
});
```

| Fixture | What it is |
|---|---|
| `library`, `unplayableFormats` (options) | What the server serves (`'example'`, a copy of the example fixture, or a tree for `createTmpTree`), and the formats this "browser" cannot play. Set with `test.use({ … })`. |
| `soundboard` | `open()`, `waitUntilLoaded()`, `startAndWaitUntilLoaded()`, `reload()`, and `waitForTheFolderToSettle()`, the one real-time wait, to show that nothing happens. One server and one temporary library per test. |
| `splash`, `header`, `playlists`, `sounds`, `footer`, `dialogs` | Page objects. Actions wait for what they need; assertions are `expect…` methods that retry, so a spec never sleeps or polls. |
| `audio` | The fake engine and clock: `advance`, `script(title, { duration, loadDelay, loadError, bufferError, … })` (every file with that title), `expectPlaying`, `expectPlayingCount`, `expectVoice`, `expectBusGain`, `suspend`/`resume`, and holding and finishing waveform making. |
| `disk` | The audio folder: `expectOptions`, `expectSettings`, `expectFile`, and changes behind the app's back with `addCopyOf` and `remove`. |

Lessons for whoever writes or changes a spec:

- Locate by role and visible name first. The few `data-*` hooks used are ones the UI already has for its own state (`data-sound-id`, `data-playlist-id`, `data-player-bar`, `data-active`, `data-error`, `data-gain-readout`, …). Add a page-object method, not a locator in a spec.
- Several playlists can hold the same song, so `audio.script` sets every file with the title.
- The red error ring on a tile lasts 2 s of real time (`window.setTimeout`), not of fake time. A debounced save (500 ms) and the waveform service's pause between files are on the fake clock; `audio.advance(500)` makes the save happen.
- The screen uses a real minus sign (`−6.0 dB`); `expectVolume` converts. Bus volumes are saved as the slider's position, not as the gain.
- Hold buttons (delete, restore) use real timers: `click({ delay: 700 })`.
- The `soundboard` fixture leaves the page before stopping the server, since the page may still be saving waveforms.
- Fake audio and a headless browser cannot tell how the UI feels or what the real engine does; the manual checklist keeps those checks.

The features not covered yet are collected in [`ROADMAP.md`](ROADMAP.md) ("Browser test coverage still to write"). Each spec file has been checked by breaking the UI it covers on purpose and confirming the spec failed.

## Checking the tests themselves

When new tests pass on the first run, deliberately break the behavior they are meant to protect and confirm they fail, then restore the code. This has caught several tests that passed for the wrong reason.

`scripts/mutate.js` does this in one command and always puts the file back:

```sh
node scripts/mutate.js <file> <find> <replace> <test file or quoted glob>...
node scripts/mutate.js public/app/logic/options-sync.js "if (entry.saving || !options) {" "if (!options) {" test/frontend/options-sync.test.js
```

`<find>` must occur exactly once in the file. It prints `CAUGHT:` with the failing tests and exits 0, or `SURVIVED:` and exits 1 when the tests still pass.

## Browser smoke tests

These older scripts are being replaced by the Playwright suite above and will be removed when it covers what they check. The ones that drive the real `WebAudioEngine` (fades, crossfades, loops, clip points) have no replacement yet.

The real page has been driven in headless Chromium over the DevTools protocol, with real mouse input (`Input.dispatchMouseEvent`) and Node's built-in `WebSocket`, against the real server and a copy of the example fixture. The scripts are in `scripts/browser-smoke/`: `harness.js` starts the server and Chromium, and each other file checks one feature and prints `"check": "ok"` or `"FAIL …"` lines. They always exit 0, so `npm run smoke [name filter]` runs them and counts the failures. It needs `chromium-browser` on `PATH` and stays out of `npm run check`. Screenshots go to a temp folder, never the repository. The scripts are excluded from the backend type-check, since they are throwaway driving code. Some assertions describe earlier versions of the UI and fail now (`clip-ui`, `crossfade-smoke`, `tracks-smoke`, `ui-smoke`; [`ROADMAP.md`](ROADMAP.md)); the others pass. Lessons for whoever writes or changes one:

- Mouse events need the `buttons` bitmask (1 left, 2 right, 0 on release). Without it Chromium believes a button is still held after a right-click and drops the next click.
- To test "clicking outside a popup", first check with `elementFromPoint` that the backdrop really is under the point, since a menu can sit on top of tiles.
- Disabled buttons receive pointer events but no `click`.
- Text that spills out of a block element leaves the element's own box unchanged, so measure overflowing text with a `Range` over its contents, not with `getBoundingClientRect()` on the element. Hidden tab panels report 0×0 boxes; skip them.
- The fake engine only records `rampGain` calls, so how the real `WebAudioEngine` turns them into `AudioParam` automation must be checked in a browser. Wrapping `AudioContext.prototype.createGain` in a test page gives access to every gain node; sample `gain.value` over a few seconds. Reading `gain.value` right after scheduling a change still returns the old value, because the audio thread hasn't run yet. That is how a fade-in once started from full volume.

## Manual checklist

Run in Chrome, Firefox and Safari, with Safari on the MacBook as the one that matters most. Start with a copy of the example fixture (`cp -r test_fixtures/example_soundboard /tmp/sb && npm start -- /tmp/sb`) or a real library.

**Start and audio**
- [ ] The splash appears on load; nothing plays or loads until the click.
- [ ] Close the lid for a minute and reopen: the "resume" splash appears and audio continues after a click.
- [ ] Switching the audio output (speakers, headphones, Bluetooth) while playing.
- [ ] Ogg tiles play, or are disabled with an explanation where the browser can't play Ogg.

**Sounds**
- [ ] Overlapping sounds; the stop button appears and disappears; a ninth instance replaces the oldest.
- [ ] Sounds never create a player bar.

**Panic Stop**
- [ ] With a playlist and a few sounds that have fade-outs playing, "Stop (Fade)" fades them all out audibly, each over its own fade-out, and the button turns red and reads "Stop (NOW!)" while they fade. Pressing it then cuts everything with no tail and no click.
- [ ] After the fades finish by themselves the button is yellow and reads "Stop (Fade)" again. So it does if you start a sound or playlist while it reads "Stop (NOW!)".
- [ ] The button stays in the same place at the footer's right while player bars come and go.

**Customize a sound**
- [ ] Right-click a sound → Customize: the dialog opens with the title field focused; the menu is gone.
- [ ] While a sound plays (use the dialog's Play button on a long sound), moving the volume changes its loudness at once, without clicks; new presses play at the new volume.
- [ ] The gain widget: bars light up in proportion, the boost block and the dB readout turn orange above 0 dB, dragging works, double-click resets to `0.0 dB`.
- [ ] While a change is being saved a spinner shows in the corner, then a checkmark.
- [ ] The dB readout: click it, type `-6` and Enter; `-inf` silences; nonsense stays in the field marked red; Esc cancels only the edit.
- [ ] Keyboard on the widget: arrows step 1 dB, Home silences, End is +12 dB.
- [ ] Renaming updates the tile while typing but only moves it into sorted order when the dialog closes. An emptied title field keeps the old title.
- [ ] Changes survive a reload; the `.json` file next to the sound holds `title` and `gain`.
- [ ] Close the lid while the dialog is open: the resume splash covers it, and the dialog is still there afterwards.

**Sound start and end points, and fades**
- [ ] The Start and end slider spans the whole sound. Dragging either handle moves it; pressing the bar moves the nearer handle there; the handles never cross or come closer than 10 ms. The part between them is amber, and the centered readout says how much plays (`Plays 0.670 s of 1.670 s`).
- [ ] On a focused handle the arrows step 0.010 s, Shift + arrow 0.100 s, and Home and End go to its limits.
- [ ] The Start and End fields sit at the left and right, joined by a bar with Reset in its middle, and show seconds with three decimals and an `s` inside the field. Typing `1.25` or `1,25 s` applies on Enter or when leaving the field; out-of-range values are clamped; nonsense is marked red on Enter and dropped when leaving; Esc restores the field and leaves the dialog open.
- [ ] Reset plays the whole file again. With the end handle all the way right, the options file has `"endAt": null`.
- [ ] The fades show on the amber part in blue: the fade-in from the start handle, the fade-out up to the end handle. Where they overlap, that stretch pulses between two reds; with a fade longer than the whole part, all of it does. The bands follow the fade sliders and the handles as they move.
- [ ] Fade readouts show three decimals (`0.030 s`); a fade typed as `0.035` is still `0.035 s` after a reload.
- [ ] Presses, from the tile and the dialog's Play, start at the start point and stop at the end point, for a small (buffered) sound and for a large (streamed) one over 256 KB. A copy already playing keeps the points it started with.
- [ ] With a fade-in and a fade-out, presses rise from silence and fall to silence exactly at the end point, without clicks. A fade-out longer than the sound starts at once. Stop All still cuts at once.
- [ ] Points and fades survive a reload.

**Waveforms**
- [ ] After the splash, the header shows "Waveforms 3 / 10" with a thin bar and a ■ button while waveforms are made, and the indicator disappears when all are done. Playing music or sounds meanwhile is not affected.
- [ ] Each audio file gets a `<file>.wf` next to it (2 KB plus a 16-byte header); a second page load, or a restart of the server, makes none again and shows no indicator.
- [ ] The ■ button stops generation after the current file ("…, stopped"); the ▶ button continues with what is missing.
- [ ] Opening a track in the playlist dialog, and a sound's dialog, shows its waveform above the Start and end slider in the accent color, filling the height even for a quiet file. A track that is loud throughout still shows where it gets louder, and a quiet intro to a loud track stays visible; the handles stand over the sound they cut at, and the part outside them is dimmed.
- [ ] A playing playlist's footer bar shows the waveform of the part that plays behind a thin progress bar. It follows track changes and changes to the track's points, the seek click still works, and the crossfade stretch is still visible.
- [ ] Dragging a handle, resizing the window and a high-density display keep the waveform sharp and aligned. A track still waiting for its waveform shows none, and the waveform appears by itself when it is made.
- [ ] Replacing an audio file (or touching its content) makes its waveform be made again; deleting a `.wf` file does too, after a reload.
- [ ] While a track plays its waveform stays still above the seek bar. A file the browser can't decode counts as failed in the indicator and the rest carry on.
- [ ] Safari: decoding works, and the tab's memory stays flat while hundreds of waveforms are made.
- [ ] The ☰ button left of the title opens a menu with "Regenerate Waves". Choosing it counts every sound and track in the indicator ("Waveforms 0 / N"), rewrites every `.wf` file, and redraws open waveforms as they are made; ■ stops it.
- [ ] Reloading the page right after the splash never flashes the waveform indicator when nothing is missing.

**External changes**
- [ ] Copying an audio file into the folder shows the yellow "External Changes – Refresh" button about a second after the copy ends; a large file copied slowly shows it only once the copy is done. Clicking it shows "Refreshing…", then the page reloads to the splash, and after the click the new file is there.
- [ ] Deleting a file, and editing an options file by hand, show the button too. Replacing a file with an identical copy does not.
- [ ] Customizing a sound, playlist or track and moving the volume sliders never show the button. A change made right before clicking Refresh is still there after the reload.
- [ ] Changing a file while another window or tab is in front shows the button as soon as the page is back in front.
- [ ] A broken options file makes Refresh open "Could not load the changes" with the file and its problem; nothing is reloaded and the button stays. After fixing the file, Refresh works.
- [ ] A new folder inside a playlist is played after a refresh, without a question; restarting the server from the terminal then asks about it.
- [ ] Renaming `.soundboard` away and clicking Refresh covers the page with the restart message, and clicks do nothing.
- [ ] Safari: the button appears and the refresh works as above.

**Downloads** (yt-dlp and ffmpeg installed, unless a check says otherwise)
- [ ] The terminal prints `Downloads: yt-dlp …, ffmpeg …` at startup. With one of them off the `PATH`, it prints `Downloads are off: … was not found.`, and every Add button opens a notice naming what is missing instead of the add dialog.
- [ ] "+ Add playlist" and "+ Add sound" sit next to the section titles, even when a section is empty. "+ Add tracks" sits under the list on the playlist dialog's Tracks tab; the playlist menu has no "Add tracks…".
- [ ] "+ Add tracks" replaces the playlist dialog with the add dialog. Closing it brings the playlist dialog back on its Tracks tab; so does closing the download dialog once a download it started has finished.
- [ ] Look up a YouTube video with chapters: its title, duration and size show. "Split into chapters" shows the chapters, all ticked, with Select all / Select none and a count; Download is disabled with none ticked.
- [ ] A `watch?v=…&list=…` link looks up the video and offers "Show the whole playlist instead", which lists the playlist's entries.
- [ ] A direct link to an MP3 shows its name and size, and the button reads "Download 1.2 MB". A file over 500 MB, or one whose size is unknown, shows a warning above the button.
- [ ] An unsupported page and a typo show the error under the link field.
- [ ] Downloading covers the header and the board with the download dialog; music in the footer can still be paused, skipped and stopped. Esc and clicks around the dialog do nothing.
- [ ] The log shows each command, then the tool's output; progress lines update in place instead of piling up. Scrolling up stops it following; scrolling to the bottom resumes.
- [ ] Each finished file appears at once as a tile (sound or playlist) in sorted order, or as a new track, while the playlist keeps playing. Its tile title has no `[id]` tag, and its options file has the `source`.
- [ ] Cancel asks first; cancelling stops the tool, keeps what was added, and the summary says the rest was cancelled. Close dismisses the finished dialog.
- [ ] A second tab shows the same dialog and the same additions; reloading during a download brings the dialog back with its log.
- [ ] The External Changes button never appears because of a download.
- [ ] Safari: the downloaded `.ogg` files play.

**Deleting and moving**
- [ ] The sound dialog and an open track row end with a "Move or delete" card; the playlist dialog's first tab ends with a "Delete" card without Move.
- [ ] Hold to delete: a red fill sweeps across the button over half a second, then the item is deleted. Letting go early, moving the pointer off the button or tabbing away snaps the fill back and deletes nothing. Holding Enter or Space works the same; a quick press does nothing.
- [ ] A deleted sound's dialog closes and its tile disappears; its file, options file and waveform are in `.trash/` under the same name. Deleting another sound of the same name later gives `.trash/<name> (2).mp3` with its `.json` beside it.
- [ ] Deleting a track removes its row, renumbers the others and updates "Tracks (N)"; the file is in `.trash/<playlist>/`, in its subdirectory if it had one. A playlist's only track says that deleting or moving it deletes the playlist too, and doing so closes the dialog and removes the tile.
- [ ] Deleting a playlist moves its folder, with everything in it, and its options file into `.trash/`. Deleting a playlist of the same name again merges into the same folder, and its options file replaces the older one.
- [ ] Move… opens a dialog above the Customize dialog: Sound effects first in amber, then the playlists in blue with their track counts. The item's current place is greyed out and says "Here now". Esc closes only the move dialog.
- [ ] Moving a sound into a playlist closes both dialogs; the tile disappears and the playlist's track count grows. The track keeps its title, volume and points.
- [ ] Moving a track to another playlist or to the sound effects closes only the move dialog: the playlist dialog is still on the Tracks tab, scrolled where it was, without that row, so several tracks can be moved in a row.
- [ ] Deleting or moving a sound while it plays stops it; deleting or moving the playing (or paused) track stops its playlist; a stopped playlist that remembered that track forgets it.
- [ ] With a second tab open, every deletion and move shows up there at once, including closing a dialog that tab had open for the item.
- [ ] No yellow Refresh button appears after deleting or moving.

**Where files came from** (copy the fixture, and rename a sound to `Rain [dQw4w9WgXcQ].ogg`, renaming its `.json` too)
- [ ] After a start, that sound's tile reads "Rain" and its `.json` has `"source": { "origin": "fileName", … "videoId": "dQw4w9WgXcQ" }`; every other file has `{ "origin": "unknown" }`. A second start changes no options file.
- [ ] An MP3 tagged by `yt-dlp --embed-metadata` (or with a `WXXX` link) gets `"origin": "tags"` with its link.
- [ ] Right-click a sound → Metadata: the dialog lists File, Origin, Link, Site, Video, Playlist and Chapter in one card; missing values show a faint italic "n/a". Link and Video open the video in a new tab.
- [ ] Right-click a playlist → Metadata: one card per track, numbered as on the Tracks tab, in one scrolling list.
- [ ] A track downloaded from a YouTube playlist links its Playlist, with "in playlist" opening the video inside it; a chapter download links its Chapter to the video at the chapter's start.
- [ ] Long values end in "…" with the full value as a tooltip, and can be selected and copied.

**Trash**
- [ ] With an empty `.trash/`, the header has no Trash button. Deleting something brings it, right of the waveform progress, reading "Trash · 0.1 MB" or more; it follows every deletion, also in a second tab.
- [ ] The Trash dialog lists Playlists, each followed by its tracks indented beneath it, then Sound effects. Each row has a title, a muted line with the size (and the file path when it differs from the title) that ends in "…" when too long, with the full text as a tooltip, and Restore (grey) and Delete (red) buttons.
- [ ] Restore and Delete act after a half-second hold; "Restore all" and "Delete all" in the footer after two seconds. Letting go early does nothing.
- [ ] Restoring a sound brings its tile back with its title, volume and points; one whose name is taken comes back as `<name> (2).mp3` with the same title.
- [ ] Restoring a track puts it at the top level of its playlist, which keeps playing. When the playlist is gone, it comes back with its trashed settings (title, volume, fades) and only that track.
- [ ] Restoring a playlist whose name is free brings it back whole, subfolders included. When a playlist of that name exists, its tracks are added to it and its settings stay as they were.
- [ ] Deleting an item removes its files from `.trash/`; the last track of a trashed playlist takes the folder and its `.json` with it. "Delete all" removes `.trash/`.
- [ ] The dialog closes once the trash is empty. With a second tab, its open Trash dialog follows restores and deletions made in the first.
- [ ] No yellow Refresh button appears after restoring, also once waveforms exist for the restored files.
- [ ] Changing `.trash/` by hand shows up only after restarting the app.

**Customize dialog look**
- [ ] Both dialogs group their settings in cards (sound: Sound, Volume, Start and end, Fades; playlist: Playlist, Volume, Fades) with the title as a pill on the top border. A card is dimmed with a grey pill until it is hovered or something in it has focus; then it lights up and the pill turns amber (sound) or blue (playlist).
- [ ] Both dialogs keep Play, centered and filled in the dialog's color, and the save status at the right in a footer below the scrolling body; the dialog's rounded corners show at the bottom. A card whose title is too long for its pill ends it in "…" with the full title as a tooltip.
- [ ] Text fields are filled: a background with an underline that takes the dialog's color on focus and turns red when invalid. The title field's floating label sits at the top, and drops into the middle when the field is emptied and left. The dB and seconds fields that open from the readouts show their unit inside the field.

**Customize a playlist**
- [ ] Right-click a playlist → Customize: the dialog shows the title, "Folder: …", the volume and Play.
- [ ] Play starts the playlist like a tile click; the button turns into Stop and back when it stops from the footer.
- [ ] Changing the volume while it plays changes the loudness at once, without clicks, and the next track keeps the new volume.
- [ ] Renaming updates the tile and the player bar while typing; the tile moves into sorted order only when the dialog closes, and the footer order never changes.
- [ ] The playlist's `.json` file keeps its `includedSubdirectories` after saving.
- [ ] The dialog opens on the "Playlist" tab. The arrow keys and clicks switch to "Tracks (N)" and back; Play and the save status stay visible on both.
- [ ] On "Tracks", each row shows number, title and duration. One row opens at a time; clicking the open row closes it.
- [ ] Renaming a track updates its row, the footer (if it is playing) and the footer's track list while typing, without moving any track. It survives a reload.
- [ ] Each row has a play button before its number. Pressing it starts that track at once (no fade), without opening or closing the row, and the button turns into a stop button. Pressing another row's button switches to that track.
- [ ] Pressing the stop button stops the playlist at once. The playlist's stop mode applies: with Pause, playing it from the tile continues there.
- [ ] A track started from the tile, the footer or its next button shows as playing in the dialog, and the row follows when the playlist moves on to the next track by itself.
- [ ] A paused track shows the play button; pressing it resumes the track rather than restarting it.
- [ ] The track list runs edge to edge between the tab bar and the Play row, and the last track is fully visible, not covered by the Play row, when scrolled to the bottom.
- [ ] Hovering anywhere on a header, including the play button, tints the whole row blue; the open row's header has a stronger tint and a blue title.
- [ ] An open row shows three cards, "Start and end", "Volume" and "Track", that light up on hover or focus like those on the first tab.
- [ ] Track volume. The Volume card has the gain widget (bars, orange boost, dB readout, typing, double-click resets). Changing it while the track plays changes the loudness at once, without a click or a restart of the track, and survives closing the dialog and reloading the page.
- [ ] A track whose volume is not 0.0 dB shows a small bubble in its header with the change (`−6.0 dB` in cyan, `+3.5 dB` in orange); it follows the widget live and disappears at 0.0 dB.
- [ ] Row headers show no duration. A track whose points differ from the whole file shows a small blue "Cropped" bubble; Reset in its card removes the bubble.
- [ ] Track start and end points. In a track's "Start and end" card, a stopped track has the two handles, the fields and Reset, in blue. Dragging a handle, typing a value and Reset all change the points as they do for a sound, and the card's readout says "Plays 0:07 of 0:10"-style lengths. The change survives closing the dialog and reloading the page.
- [ ] Play a track whose points are set: it starts at the start point and ends at the end point, then the next track starts. The footer shows time from 0:00 to the trimmed length, and its progress bar covers only that part.
- [ ] While the track plays, the handles disappear, the fields and Reset are disabled, and the card's bar is a seek bar: the part that has played is bright and the rest dimmed, and pressing it seeks within the trimmed part (the footer follows). Pressing the grey outside the points seeks to the nearest point.
- [ ] With a crossfade set, the playing track's bar shows a lighter stretch at its end where the crossfade starts, as the footer's does (relative to the end point), and none while the track repeats.
- [ ] Pause the track: the handles come back. Dragging one (or typing a value) stops the playlist, the footer bar empties, and playing the track again starts at the new start point.
- [ ] A stopped playlist that remembers a position ("Resumes at 0:07", stop mode Pause): changing that track's points makes it resume from the new start point instead.
- [ ] Changing the points of the track that is currently playing is impossible (no handles, fields disabled), but another track's points can be edited while it plays, and take effect when that track starts.
- [ ] With track looping on, a trimmed track repeats between its points without a gap, and the footer's time wraps to 0:00 at each repeat.
- [ ] The footer's Previous after more than 3 s into a trimmed track restarts it at the start point.
- [ ] Opening the dialog while a track is already playing shows its button and bar in the right state at once.
- [ ] A playlist with many tracks scrolls inside the dialog, with the tabs and the Play row staying in place.

**Crossfade**
- [ ] The first start of a new library prints "Measuring the duration of N audio files…"; the next start doesn't. Touching a file (`touch`) only re-hashes it; replacing it with another recording updates its `duration`.
- [ ] The Crossfade slider stops at 10 s or half the shortest track, whichever is less; typing a longer value is clamped to the limit shown in the note.
- [ ] With a crossfade set, the next track starts that long before the current one ends, and the two overlap smoothly: the new track starts silent and rises while the old one falls. Seeking near the end starts it at once.
- [ ] The footer's progress bar shows the crossfade section at its end in a lighter blue, and the next track takes over where it starts. It changes right away when the crossfade setting changes (even while paused), and disappears with the crossfade off.
- [ ] Next, Previous and picking a track crossfade; the "(Instant)" menu items cut over.
- [ ] Stop during a crossfade silences both tracks; Pause silences the old one, and Resume continues only the new one.
- [ ] A playlist with a single track crossfades into its own start.
- [ ] Crossfades keep happening with the window in the background.

**Fade in and fade out**
- [ ] With a fade-in, a tile click, Play, and picking a track while stopped all start silent and rise; "Play (Instant)" starts at full volume.
- [ ] With a fade-out, a tile click, the footer's Stop and Stop all fade out, and the bar and the tile's "Playing" disappear at once. "Stop (Instant)" cuts.
- [ ] Stopping during a fade-in turns it around smoothly, without a jump.
- [ ] Stopping during a crossfade lets the old track finish its fade while the new one fades out.
- [ ] Starting again during a fade-out plays the new start over the fading old one.
- [ ] Pause and Resume are immediate; pausing during a fade-in resumes at full volume, and pausing during a crossfade stops the old track.

**Playlists**
- [ ] Several playlists at once; next, previous, jump, seek, pause and stop on each.
- [ ] Tracks advance on their own, including while the window is in the background.
- [ ] Mashing "next" never leaves a stray track playing.
- [ ] Seeking in a long MP3 works (Range requests).

**Playback order** (use the fixture's six-track "Music Order" playlist)
- [ ] The playlist dialog's Playback order card offers Ordered (checked by default), Random and Shuffle, each with its description. A choice is saved (`"order"` in `Music Order.json`) and survives a reload.
- [ ] Ordered plays Order 1 to 6 and wraps to Order 1. Random never plays the same track twice in a row. Shuffle plays all six once, in a mixed order, before any repeats, and the next round never starts with the track that just played.
- [ ] Previous steps back through the tracks played, and Next then replays the same ones in the same order. On the first track played, Previous restarts it, in every order.
- [ ] Choosing a track from the footer's track list plays it and starts over from there: in Ordered, Previous then goes to the track listed before it; in Shuffle and Random, Previous restarts the chosen track.
- [ ] Changing the order while the playlist plays keeps the current track playing; Next then follows the new order, and Previous restarts the current track.
- [ ] With a crossfade, the track that fades in is the one Next would have played; the progress bar's crossfade marker still appears in Random and Shuffle.

**Track looping** (use "Music Order", whose tracks are 10 s long)
- [ ] "Repeat the current track" in the Playback order card is saved (`"trackLooping"`) and survives a reload.
- [ ] With it on, the playing track starts over at its end, with no gap for an Ogg file and at most a tiny one for an MP3, and the time and progress bar go back to the start. Next, Previous and the track list still move on, and the new track repeats in turn.
- [ ] Turning it on mid-track makes that track repeat; turning it off lets it finish and move on in the playlist's order.
- [ ] With a crossfade set, a repeating track has no crossfade marker and no crossfade at its loop point, but Next still crossfades. Turning it on during a crossfade makes the incoming track repeat.

**What stopping remembers** (use "Music Order")
- [ ] The playlist dialog's "When stopped" card offers Pause, Reset track and Reset playlist (checked by default), each with its description. A choice is saved (`"stopMode"`) and survives a reload.
- [ ] Reset playlist: stopping and playing again starts at the first track, and the idle tile shows the track count as before.
- [ ] Pause: stop a few seconds into track 3. The tile gets a dashed left border and reads "Resumes at m:ss", with the track named in its tooltip; playing it again continues from that spot, and the border goes away.
- [ ] Reset track: the same, but the tile reads "Resumes track 3" and the track starts over. Previous after resuming still goes back through the tracks played.
- [ ] Stop (Instant) remembers as well. With a fade-out, resuming continues from where Stop was pressed, fades in with the playlist's fade-in, and Play (Instant) starts at full volume.
- [ ] Changing the mode while stopped updates the tile at once (Pause to Reset track drops the time, Reset playlist drops the tile's resume look) and never brings it back.
- [ ] The tile's context menu shows Reset only while the tile remembers something; choosing it returns the tile to its track count, and the next Play starts at the first track.
- [ ] Choosing a track in the footer's track list, and a playlist that stops on its own (track looping and playlist looping can't end it; use a single broken track), leave nothing remembered.

**Interface**
- [ ] Clicking outside a context menu doesn't trigger the tile underneath; Esc closes it.
- [ ] Context menus and the track list open fully on screen, also near the window edges and the first time.
- [ ] The footer shows "No playlist playing" when idle and keeps the same height once music starts; it wraps at 3 bars and scrolls after 6.
- [ ] Give a sound, a playlist and a track long titles without spaces, and a sound a long file name without spaces. In a narrow and a wide window, tile titles break mid-word and end in an ellipsis after 3 lines; the player bar, the track list, the dialog title, the Tracks tab's rows and the `File: …` hint end in an ellipsis on one line, the hint with the full name as a tooltip.

**Volume**
- [ ] Each header volume widget affects only its own category; none goes above `0.0 dB`, and they have no boost block.
- [ ] Volumes survive a page reload and a server restart.

**Long session**
- [ ] Compare the tab's memory in Activity Monitor at the start and after an hour of play; it should not keep growing.

**Debug view**
- [ ] A bug button sits at the right end of the header, after the volume controls. Pressing it opens a panel right below it, above the board, the footer, dialogs and menus. Pressing it again closes it. After a reload it starts closed.
- [ ] Press a sound several times: each press is a row, oldest at the top and newest at the bottom, with an amber `SFX` badge, the sound's title, a status and its volume in dB. Existing rows never move.
- [ ] The status goes `loading`, then `playing`; a sound with a fade-in shows `fading in` while its volume climbs from `−∞ dB` to its gain, and one with a fade-out shows `fading out` while it drops.
- [ ] A sound's volume equals its Customize volume (`0.0 dB` at the default, `−6.0 dB` after setting that), and ignores the Master and Sound Effects sliders.
- [ ] When a sound ends the row turns `ended` and dims, and disappears 5 seconds later. Stop All and a ninth press show `stopped` and also linger 5 seconds.
- [ ] Start a playlist: a blue `Music` row appears. Pause shows `paused`, resume `playing`. Next and Previous with a crossfade show the old track `fading out` and the new one `fading in` at the same time, volumes moving in opposite directions, and the old row `ended`/`stopped` afterwards.
- [ ] A playlist's volume in the panel is its gain times the track's; changing the playlist volume while it plays updates the row.
- [ ] With the panel open, the playlist dialog and its test playback still work, and the panel stays on top of the dialog. Esc closes the panel only when no dialog or menu is open.
- [ ] A track that fails to load (for example a file removed from the temp directory after the scan) shows `error`; hovering the status shows the message.
