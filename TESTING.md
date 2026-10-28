# Soundboard — Testing

How the app is tested: the automated suite that runs in Node, and the manual checks in real browsers. [`DESIGN.md`](DESIGN.md) §11 summarizes the approach.

## Running the tests

- `npm test` runs every `*.test.js` with the built-in runner (`node --test`). A single file: `node --test test/backend/http/server.test.js`. Several: pass a glob in quotes, such as `node --test "test/frontend/*.test.js"`. A bare directory path does not work.
- `npm run check` runs type-checking, lint and the tests. It must pass before every commit.

## Principles

- **Test first** for all domain and logic code: backend, metadata, library, HTTP, and everything in `public/app/logic/`.
- **No automated DOM tests.** The UI components and `WebAudioEngine` are kept thin and checked in real browsers (below). Pure helpers used by the UI (`format`, `menus`, `position`) are unit-tested.
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
| `http-client.js` | `rawRequest()` sends a path exactly as given (for path traversal tests, which `fetch` would normalize); `findFreePort()`. |

## What the suite covers

| Area | Tests |
|---|---|
| Metadata | Every ID3 version and text encoding, extended headers, unsynchronization (tag-wide and per frame), group and data-length flags, compressed and encrypted frames, padding, the ID3v1 fallback; Ogg Vorbis and Opus, comments split across pages, multiplexed streams, the 1 MB limit; truncated and random data never throwing; every file in the example fixture. |
| Library | Classification (hidden files, symlinks, orphans, unsupported formats, case rules), scanning built trees and the fixture, natural sorting with deterministic ties, validation messages, atomic writes that keep unknown keys, the settings store's serialized writes. Tree snapshots and baselines (what counts, recorded hashes, new, gone, touched and replaced files with and without hashing). The change watcher with a fake `fs.watch` and the fake clock: the quiet second, quick checks, own writes, the 30 s fallback, refreshes taking turns with comparisons, plus one run with the real `fs.watch`. |
| Bootstrap | First and later runs with a fake prompter: nested directories accepted or declined (declining writes nothing), metadata titles accepted or declined, `.soundboard` written last, validation errors gathered before anything is asked, empty playlists left alone, the example fixture end to end. Refreshes: new files, nested directories merged but not recorded (and asked about at the next start), validation errors, a missing `.soundboard`. |
| CLI | Arguments and ports, colors and `NO_COLOR`, the prompter (including typed-ahead answers and closed input), reporter output, `main` from usage errors to serving and stopping, port in use, `--verbose`. |
| HTTP | A real server on a random port: static files and MIME types, path traversal attempts, the library and settings API with its error codes, media with every range form, `HEAD`, `416`, clients disconnecting mid-stream, request logging. The event stream, `POST /api/changes/check` and `POST /api/refresh` with each status, shared refreshes, and a save sent during a refresh reaching the new library. |
| Frontend logic | Event emitter; order strategies; transitions and rules; volume; settings sync and options sync (debounce, one save at a time, flush, settling, failures); library model; command validation; buffer cache (sharing, eviction, in-use protection); sound player (instances, both caps, cancelling pending decodes, errors); playlist player (every state transition, stale callbacks from leaky voices, previous/next/jump rules, seeking, progress, errors and the consecutive-error limit, fades with non-zero rules, the retiring cap); the `Soundboard` facade, including external changes and refreshing with a fake `ServerEvents`; `HttpBackendApi` against the real server. |
| Playlist invariant | 400 seeded random command sequences, with and without fades, in all three playback orders, with broken and leaky tracks: afterwards, at most one live voice while active, none and no timers while idle (DESIGN.md §8). |

## Checking the tests themselves

When new tests pass on the first run, deliberately break the behavior they are meant to protect and confirm they fail, then restore the code. This has caught several tests that passed for the wrong reason.

`scripts/mutate.js` does this in one command and always puts the file back:

```sh
node scripts/mutate.js <file> <find> <replace> <test file or quoted glob>...
node scripts/mutate.js public/app/logic/options-sync.js "if (entry.saving || !options) {" "if (!options) {" test/frontend/options-sync.test.js
```

`<find>` must occur exactly once in the file. It prints `CAUGHT:` with the failing tests and exits 0, or `SURVIVED:` and exits 1 when the tests still pass.

## Browser smoke tests

The real page has been driven in headless Chromium over the DevTools protocol, with real mouse input (`Input.dispatchMouseEvent`) and Node's built-in `WebSocket`, against the real server and a copy of the example fixture. That script is not committed yet ([`ROADMAP.md`](ROADMAP.md)). Lessons for whoever writes or commits it:

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
- [ ] Opening a track in the playlist dialog, and a sound's dialog, shows its waveform above the Start and end slider in the accent color, filling the height even for a quiet file; the handles stand over the sound they cut at, and the part outside them is dimmed.
- [ ] A playing playlist's footer bar shows the waveform of the part that plays behind a thin progress bar. It follows track changes and changes to the track's points, the seek click still works, and the crossfade stretch is still visible.
- [ ] Dragging a handle, resizing the window and a high-density display keep the waveform sharp and aligned. A track still waiting for its waveform shows none, and the waveform appears by itself when it is made.
- [ ] Replacing an audio file (or touching its content) makes its waveform be made again; deleting a `.wf` file does too, after a reload.
- [ ] While a track plays its waveform stays still above the seek bar. A file the browser can't decode counts as failed in the indicator and the rest carry on.
- [ ] Safari: decoding works, and the tab's memory stays flat while hundreds of waveforms are made.

**External changes**
- [ ] Copying an audio file into the folder shows the yellow "External Changes – Refresh" button about a second after the copy ends; a large file copied slowly shows it only once the copy is done. Clicking it shows "Refreshing…", then the page reloads to the splash, and after the click the new file is there.
- [ ] Deleting a file, and editing an options file by hand, show the button too. Replacing a file with an identical copy does not.
- [ ] Customizing a sound, playlist or track and moving the volume sliders never show the button. A change made right before clicking Refresh is still there after the reload.
- [ ] Changing a file while another window or tab is in front shows the button as soon as the page is back in front.
- [ ] A broken options file makes Refresh open "Could not load the changes" with the file and its problem; nothing is reloaded and the button stays. After fixing the file, Refresh works.
- [ ] A new folder inside a playlist is played after a refresh, without a question; restarting the server from the terminal then asks about it.
- [ ] Renaming `.soundboard` away and clicking Refresh covers the page with the restart message, and clicks do nothing.
- [ ] Safari: the button appears and the refresh works as above.

**Customize dialog look**
- [ ] Both dialogs group their settings in cards (sound: Sound, Volume, Start and end, Fades; playlist: Playlist, Volume, Fades) with the title as a pill on the top border. A card is dimmed with a grey pill until it is hovered or something in it has focus; then it lights up and the pill turns amber (sound) or blue (playlist).
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
- [ ] Give a sound, a playlist and a track long titles without spaces, and a sound a long file name without spaces. In a narrow and a wide window, tile titles break mid-word and end in an ellipsis after 3 lines; the player bar, the track list, the dialog title and the Tracks tab's rows end in an ellipsis on one line; the `File: …` hint wraps inside the dialog.

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
