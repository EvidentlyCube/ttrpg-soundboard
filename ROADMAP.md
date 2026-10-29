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

### Playwright UI tests

**Goal.** The UI gets automated tests that run in a real browser, against the real server and the real page, with the fake audio engine and the fake clock from the unit tests standing in for sound and time. A test reads like a script a game master could follow, and it is deterministic: nothing sleeps, because time only moves when the test says so.

```js
test('a playlist starts from its tile and keeps time in the footer', async ({ soundboard, splash, playlists, footer, audio }) => {
	await soundboard.open();
	await splash.click();
	await soundboard.waitUntilLoaded();

	await playlists.click('Music MP3');
	await footer.expectPlayersCount(1);
	await audio.expectPlaying('Track one');

	await audio.advance(1000);
	await footer.player('Music MP3').expectTime('0:01 / 3:00');
});
```

**Design changes.**
- **§11 Testing** and `TESTING.md` ("No automated DOM tests" is the principle being replaced): the UI components get automated tests in Chromium; only `WebAudioEngine` stays manual, because the fake engine replaces it here. `CLAUDE.md` says the same in its Testing section ("No automated tests for DOM/UI components"); that file is the owner's, so the proposed wording goes to the owner in the final step rather than being edited quietly.
- **§1.1 Constraints**: one more dev dependency, `@playwright/test`. It is already in `node_modules` but not in `package.json` (see the first open question).
- **§10 Project structure, §10.1 Type-checking projects, §10.2 Scripts**: `test/browser/`, a type-check project for it, and the `npm run test:browser` script.
- **§6 Frontend architecture** is unchanged, and so is all production code: the page is wired to the fakes by the test, not by an option in `main.js`.

**How it works.**

*The page under test.* The real server runs on a temporary copy of the example fixture (or a tree the test builds), exactly as `scripts/browser-smoke/harness.js` does now. The browser loads the real `index.html` and the real UI modules. Playwright's `page.route` intercepts two kinds of requests:
- `/app/main.js` is answered with `test/browser/support/test-main.js`, a copy of the composition root that passes `FakeAudioEngine`, `FakeWaveformDecoder` and one shared `FakeClock` to `Soundboard` instead of the browser ones. The real `HttpBackendApi` and `EventSourceServerEvents` stay, so saves, the library and the event stream are the real thing.
- `/test-support/*` is answered from `test/helpers/`, so the browser runs the very same `fake-audio-engine.js`, `fake-clock.js` and `fake-waveform-decoder.js` as the unit tests. They import nothing at run time, so they load unchanged.

The entry module puts `{ clock, engine }` on `window.soundboardTest`. Only the `audio` driver below touches it.

*Fixtures* (Playwright's `test.extend`, in `test/browser/support/fixtures.js`). A test asks for what it needs by name and everything is set up and torn down around it:

| Fixture | What the test gets |
|---|---|
| `library` (option) | What the server serves. `'example'` by default; `test.use({ library: { 'Rain': { 'a.mp3': … } } })` builds a tree with `createTmpTree`. |
| `soundboard` | Opens the page on a fresh server and library. `open()`, `waitUntilLoaded()`, `reload()`, plus `startAndWaitUntilLoaded()` for tests where the start is not the point. Stops the server and removes the temp tree afterwards. |
| `splash`, `header`, `playlists`, `sounds`, `footer` | Page objects, one per area of the screen (§9.0 to §9.2). |
| `dialogs` | One page object per dialog: `soundEditor`, `playlistEditor`, `trash`, `metadata`, … |
| `audio` | The fake engine and clock: the only way a test touches time or sound (below). |
| `disk` | The audio folder on disk, for tests that care about files: `expectOptions('Explosion', { gain: 0.5 })`, `addFile(…)`. |

*Page objects* (`test/browser/pages/`). One class per area, written in the words of the screen. Every action waits for what it needs, and every assertion is a method that starts with `expect` and retries until it holds, so a test never says `waitFor` or `sleep`. Locators use roles and visible names (the tile is the button called "Combat"; the stop control is "Stop all Explosion"); a `data-*` attribute is added to the UI only where no role and name will do, and each addition is listed in the step that makes it.

```js
splash.click()                      splash.expectVisible()
playlists.click('Combat')           playlists.expectPlaying('Combat')   playlists.expectIdle('Tavern')
playlists.rightClick('Combat')      sounds.click('Explosion')           sounds.stop('Explosion')
sounds.expectPlaying('Explosion')   sounds.expectDisabled('Ogg tune', 'cannot play Ogg')
footer.expectPlayersCount(2)        footer.expectEmpty()                footer.player('Combat') → { pause(), resume(), next(), previous(),
                                                                          stop(), openTrackList(), jumpTo('Boss'), seekTo(0.5),
                                                                          expectTrack('Battle'), expectTime('0:01 / 3:00'), expectPaused() }
header.setVolume('music', -6)       header.expectVolume('music', '-6.0 dB')
```

*The `audio` driver* (`test/browser/support/audio.js`). It speaks about sounds by title, the way the screen does, and turns that into the fake engine's URLs through the library.

```js
await audio.advance(1000);                       // time passes: ms, then let the page settle
await audio.script('Battle', { duration: 30 }); // how long a track is; also loadDelay, playError, loadError
await audio.expectPlaying('Battle');            // a live voice for it
await audio.expectNothingPlaying();
await audio.expectPlayingCount(3, { bus: 'sfx' });
await audio.expectVoice('Battle', { gain: 0.5, startAt: 1.2 });
await audio.suspend();  await audio.resume();   // the system takes the audio device: the "paused" splash and back
```

`advance` runs `clock.advance(ms)` in the page and then waits one macrotask, so promise callbacks (decoded buffers) have run before the next line. Because the clock is the one `Soundboard` uses, `audio.advance(500)` is also what makes a debounced save happen, and `audio.advance(2000)` ends an error ring.

*Where things live and how they run.*
```
test/browser/
  playwright.config.js    one project per browser; the server is started by the fixtures, not by the config
  support/                fixtures.js, test-main.js, audio.js, disk.js, server.js
  pages/                  splash.js, header.js, playlists.js, sounds.js, footer.js, player-bar.js
  pages/dialogs/          sound-editor.js, playlist-editor.js, …
  specs/                  start.spec.js, sounds.spec.js, playlist-playback.spec.js, …
```
- `npm run test:browser` runs them; `npm run test:browser -- specs/sounds.spec.js -g "overlap"` runs part. Failure traces and screenshots go to a temp directory, never the repository.
- Specs end in `.spec.js`. `node --test` would otherwise pick up everything under `test/`, so step 1 narrows `npm test` to the existing suites.
- Chromium only by default. Firefox and WebKit (already installed for Playwright) are extra projects: `--project=webkit` gives a cheap layout check close to Safari, though not Safari's audio.
- One server and one temp library per test: starting is a few milliseconds, tests stay independent, and they run in parallel.

**Open questions.**
1. **The dependency.** `CLAUDE.md` limits dev dependencies to type-checking and linting tools and says to ask first. `playwright` is already in `node_modules` here, but `package.json` doesn't list it. *Recommended:* add `@playwright/test` as a dev dependency, pinned to the installed version. It is test tooling only and no runtime or app code imports it.
2. **Wiring the fakes: route or option?** *Recommended:* the route approach above, with no production change; `test-main.js` is a ten-line copy of `main.js`, and the manual checklist still exercises the real one. The alternative is to let `main.js` take its ports from an optional global, which puts test hooks in production code.
3. **Where `npm run check` stands.** *Recommended:* `check` stays as it is, and `npm run test:browser` is a separate command that needs the Playwright browsers, as `npm run smoke` does. Each step's commit needs both green. The cost is one more command to remember; the benefit is that `check` stays fast and works on a machine without browsers. (Type-checking and linting of `test/browser/` do join `check`.)
4. **Where the tests live.** *Recommended:* `test/browser/`, as `CLAUDE.md` says tests live under `test/`, with `npm test` narrowed to `test/backend`, `test/frontend` and `test/helpers`. The alternative is a top-level `e2e/` and no change to `npm test`.
5. **Locators.** *Recommended:* roles and visible names first, and a `data-*` attribute only where needed, since the UI already shows state through `data-*` attributes (`CLAUDE.md`). Nothing but `data-*` attributes is ever added to the UI, never ids or classes for tests. Each is listed in the step that adds it, for the owner's review.
6. **Bare functions or objects.** The sketch in the request used `clickOnSplash()` and `playlists.click()` side by side. *Recommended:* objects only (`splash.click()`), since they read the same, the area comes first, and autocompletion lists what each area can do. The few steps every test begins with get one-line helpers on `soundboard` (`startAndWaitUntilLoaded()`).
7. **What happens to `scripts/browser-smoke/`.** *Recommended:* nothing now. Those scripts check the real `WebAudioEngine` (fades, crossfades, loops, clip points), which these tests can't. The UI-only ones can be ported later, one proposal at a time, and deleted when covered; several already fail against the current UI (TESTING.md).
8. **Checking that the tests can fail.** `scripts/mutate.js` runs `node --test`. *Recommended:* for this suite, break the UI by hand once per spec file and confirm the spec fails, noting it in the commit summary. Teaching `mutate.js` to run another command is a separate, small change if the owner wants it.

**Plan.** Each step is written test-first where a test exists to be written, and committed once `npm run check` and `npm run test:browser` pass.
1. **Tooling.** Add `@playwright/test`, `playwright.config.js`, the `test:browser` script, a type-check project and lint coverage for `test/browser/`, and narrow `npm test`. One spec, `page loads and shows the splash`, against the real server with the real `main.js`. *Checked by:* the spec passing; `npm test` still passing and not picking the spec up; the spec failing when `index.html` is broken.
2. **Fakes in the page.** `test-main.js`, the two routes, and the `soundboard` and `library` fixtures; the `splash` page object. *Checked by:* a spec that clicks the splash and sees the board with the fixture's playlists; a spec that proves no media request is made.
3. **Audio driver and the first page objects.** `audio`, `playlists`, `sounds`, `footer` and `header`, with the spec from the sketch above, plus overlapping sounds, Stop on a sound, and the "No playlist playing" footer. *Checked by:* the specs; breaking `FakeClock.advance` fails them.
4. **Player bar.** `player-bar` with pause, resume, previous, next, stop, the track list and its jumps, seeking, and the time display moving with `audio.advance`. Add any `data-*` the bar needs.
5. **Errors and the system.** A track that fails to load, the red ring on a tile and its 2 s end, an unsupported-format tile disabled with its tooltip, `audio.suspend()` bringing back the "paused" splash and `resume()` removing it with playlist state kept.
6. **Dialogs and saving.** The `dialogs` fixtures and `disk`: Customize a sound (title, gain, points, fades) and a playlist, the debounced save made by `audio.advance(500)` and read back with `disk.expectOptions`, a rename that moves its tile only when the dialog closes, and Esc handling.
7. **External changes and the header.** `disk.addFile` brings the External Changes button, which reloads on click; volume sliders; the waveform indicator (with the fake decoder); the trash button and dialog.
8. **Documentation.** `TESTING.md` (the principle, a section on the browser suite, the helper table, the checklist items now covered), `DESIGN.md` §1.1, §10 and §11, the proposed wording for the Testing section of `CLAUDE.md` shown to the owner, and this proposal removed from `ROADMAP.md`. *Own commit,* reviewed like any design change.

Later proposals (not part of this one): adding/downloading dialogs with a fake process runner, move and trash flows, and porting the UI-only smoke scripts.

---

## Known issues

Fix these before starting the next feature.

None yet.

---

## Backlog

In the owner's order: work from the top. Each entry becomes a proposal (above) before any code is written.

**Decided for all of them.** Customization changes apply immediately and are saved with a 500 ms debounce, as the sound Customize dialog does (DESIGN.md §6.4, §9.7). Re-sorting on screen waits until the dialog closes. Playback state is never remembered across a page reload, so F5 always gives a clean start.

### Customizable playlist looping

`PlaybackRules.playlistLooping` is always on "for now" (DESIGN.md §8.2). An option lets a playlist stop after its last track instead, for one-shot sequences such as a boss intro.

- **Seam:** the rule already exists and the play history honors it (§8.1). It needs a playlist option (§2.3, §5.1, §5.2), a command and a control in the playlist dialog (§9.7).

### Panic Stop

A large **Panic Stop** button with a space of its own in the footer (DESIGN.md §9.1), always in the same place so the layout never shifts.

- **Behavior:** one click starts fading everything out, playlists and sound effects alike. A second click stops everything immediately, including voices still fading out.
- **Seam:** `'instant'` transitions already cut every voice of a playlist (§6.1, §8); `stopSound` is instant (§7). The fade is new for sounds and has no per-playlist rules, so the proposal decides how long it lasts (one global duration, or each playlist's own fade-out) and what the button shows while fading.

### Live volume

A small volume bar for a temporary volume, on the playlist tiles and sound tiles and in the footer's player bars.

- **Behavior:** the footer's bar and the playlist tile's bar are the same value, kept in step. It is temporary: never saved, back at full on a reload, and separate from the saved `gain` (DESIGN.md §6.4), which the Customize dialogs set. It multiplies with it.
- **Seam:** voices already have a gain stage of their own next to the fade stage (§6.3). Open for the proposal: whether sound effects get one value per sound, and whether a tile's bar is always visible or appears on hover.

### Reload guard

Reloading or closing the page asks for confirmation (`beforeunload`) while anything is playing, since a reload stops all audio (DESIGN.md §6.7).

- **Notes:** the page's own reload after a refresh of external changes (§9.1) must not ask. The UI listens to `playlist.stateChanged` and `sound.activeChanged` to know whether anything plays.

### Protect the API from other web pages

Any page open in the same browser can send simple cross-site requests to `127.0.0.1`, for example a `text/plain` `POST` to `/api/trash/delete`, and DNS rebinding reaches every endpoint (DESIGN.md §5.2).

- **Notes:** require `application/json` on requests with a body, and reject requests whose `Host` is not the server's own address (`localhost`, `127.0.0.1` and whatever LAN access later adds). Applies to `readJsonBody` and the waveform upload (`src/http/router.js`). LAN access builds on this (see below).

### Ogg Opus files

`.opus` is listed among the unsupported extensions (DESIGN.md §2.1), though `ogg.js` already reads Opus titles and durations (§4.2, §4.3). Safari on the target MacBook plays Ogg Opus (§12).

- **Notes:** accept `.opus` as a supported extension and format, with a content type for streaming (§5.2), and let downloads keep an Opus stream instead of re-encoding it to Vorbis (§5.4, which today keeps only `.mp3` and `.ogg`). `canPlay` still checks the format (§6.3). Open for the proposal: what a download of a YouTube video produces (`.opus` or `.webm`), and existing `.ogg` files that hold Opus.

### Error handling

Show every problem found at startup in one place. If there are any, a button in the page header says that there are issues to handle, and opens a dialog listing all of them.

- **Today:** warnings go to the terminal only (DESIGN.md §3.1: unsupported files, orphan options files, symlinks, empty playlists), and the browser learns nothing. The refresh dialog (§9.1) lists invalid options files, but only after a refresh.
- **Includes:** files whose duration can't be measured. Bootstrap stores `"duration": null` for them (§3.5), but the UI assumes every sound has one: the sound dialog leaves out its Start and end section for such a sound, and crossfades skip such tracks. Reporting them is the first step; reading the duration in the browser on first play is an option for later.
- **Notes:** the server needs to keep the list and send it (a field of `/api/library` or an event), and the same list should cover problems that appear later (failed downloads, failed saves, tracks that fail to play).

### Basic mobile design

Make the page usable on a phone or tablet.

- **Changes:** DESIGN.md §1.1 currently targets desktop browsers only, with "no special handling" for touch, and §9 lays the page out for a laptop screen.
- **Notes:**
  - The header's three volume controls collapse into a hamburger menu on narrow screens. Today they have a fixed width and make the page scroll sideways below about 1030 px, which also affects a narrow desktop window.
  - The footer's three bars per row, the tile grid and the dialogs need narrow layouts.
  - Audio unlocking and playback in Safari on iOS need checking.
  - Context menus get **no** touch gesture: long press stays unused (see "Decided against").
  - Design specific to the remote player belongs to "LAN access and remote control" below, not here.

### Playwright browser tests

Replace the committed smoke scripts (`scripts/browser-smoke/`, [`TESTING.md`](TESTING.md)), several of which check earlier versions of the UI, with Playwright tests.

- **Notes:**
  - The tests run against a mock of the playback library that Playwright controls: a fake `AudioEngine` and clock in the page (DESIGN.md §6.3), so that the UI is time-independent. A test advances time, ends a track or fails a voice on purpose, and never waits for real audio.
  - Real-browser checks of `WebAudioEngine` itself stay manual (or a separate small suite), since the mock replaces it.
  - Port what the smoke scripts cover, then remove them. It needs Playwright as a dev dependency, which needs the owner's approval (CLAUDE.md) and stays out of `npm run check`.

### Browser test coverage still to write

What the Playwright suite (`test/browser/`) does not check yet, collected when the first suite was finished. It covers the splash, playing and controlling playlists and sounds, errors, a suspended system, the sound and playlist Customize dialogs (title, volume, start point, fades, order, repeat, when stopped, crossfade, saving), external changes, the header volumes, the waveform indicator and the basics of the trash. Everything below is open. Each group is a candidate for its own proposal. The part that only a real browser can check stays in the manual checklist ([`TESTING.md`](TESTING.md)), and so does `WebAudioEngine`.

- **Player bar and playlist playback.**
  - The tile menu's instant items (Play, Next and Stop "(Instant)"), Reset, and Stop All on a sound.
  - A playlist set to "Reset track" or "Reset playlist" when stopped: the "Resumes track 3" status, and starting again from the beginning.
  - Repeat the current track, and the random and shuffle orders (with a seeded `random` passed through `test-main.js`).
  - Previous restarting a track that has played for a while, instead of going back.
  - Seeking with the keyboard, and seeking while paused.
  - The crossfade band on the progress bar, and the fade levels on the engine's gain ramps (`FakeVoice.gainRamps`).
  - Times from an hour on (`h:mm:ss`), and `--:--` while the duration is unknown.
  - A track that is disabled in the track list (unsupported format), and the track list scrolling to the current track.
  - The footer layout: three bars per row, two rows, then scrolling.
  - A ninth instance of a sound replacing the oldest, and the difference between small (buffered) and large (streamed) sounds.
- **Sound dialog.**
  - Dragging the start and end handles, pressing the bar, the handles never crossing or coming closer than 10 ms, and the keyboard on the handles (arrows, Shift, Home and End).
  - The start and end fields: `1,25 s`, clamping, nonsense marked red, Esc restoring the field.
  - The fade-out and fades longer than the part that plays (the pulsing red bands).
  - The volume widget: dragging, double-click to reset, the arrow, Home and End keys, `-inf`, nonsense marked red, Esc cancelling the edit only, and the orange boost state above 0 dB.
  - The volume changing a sound that is already playing, and a copy already playing keeping the points it started with.
- **Playlist dialog and tracks.**
  - The Tracks tab: customizing, playing, cropping and changing the volume of a single track, renaming tracks, and the track settings saving (`track.saved`, `track.saveFailed`).
  - Moving a track, and deleting a track or the whole playlist from the dialog, and the dialog closing when its playlist goes away.
  - Adding tracks from the Tracks tab, and the dialog coming back on that tab.
  - The fade-in and fade-out fields, and the crossfade limit note ("Up to … half the shortest track").
- **Add dialog, Download dialog and downloads.** All of it, which needs the fake process runner behind the test server (`downloads: { tools, run }`): lookups and their errors, chapters and playlists, progress and the log, one job at a time, cancelling, dismissing, `503` without the tools, and new tiles appearing at once, including tracks added to a playlist that is playing.
- **Move dialog and moves.** Moving a sound to a playlist and a track to sound effects, name clashes, and the open Customize dialog closing.
- **Trash.**
  - Restoring a playlist or a track (a playlist recreated from its options, tracks flattened), and the ` (2)` name clashes.
  - Restore all and Delete all (held for 2 s), the dialog closing once the trash is empty, and the errors shown in it.
  - Deleting a playlist that is playing, and a deleted sound that is playing stopping.
- **Metadata dialog.** All of it: the rows, source links and their rebuilding for YouTube, the origin and chapter fields, and saving.
- **App menu and waveforms.**
  - ☰ → "Regenerate Waves" counting every sound and track, and its stop button.
  - Failed waveforms counted in the indicator ("2 failed"), and one that cannot be decoded not stopping the rest.
  - Making none again on a second page load, and the waveform appearing in an open dialog when it is made.
- **External changes beyond the basics.**
  - A refresh that fails: the "Could not load the changes" dialog with each problem, and the missing `.soundboard` bringing the "needs a restart" splash back for good.
  - The check when the window gets the focus back.
  - Replacing a file with an identical copy not showing the button, and a change made just before clicking Refresh surviving the reload.
  - The button's "Refreshing…" state.
- **Start-up and the system.**
  - `app.startFailed`: "Could not start the soundboard. Click to retry." and retrying.
  - An open popup closing when the system suspends audio, and an open Customize dialog staying underneath the splash.
  - The empty library line ("none found in this folder").
  - The debug view and its button.
  - The context menu closing on a click outside it and on Esc, and Esc taking the topmost dialog first.
- **The suite itself.**
  - Firefox and WebKit projects in `playwright.config.js` (the browsers are installed), at least for layout checks.
  - Narrow-window layouts, once "Basic mobile design" is done.
  - A visual check of the waveform canvases.
  - Whether `finishWaveforms()` and the other real-time waits can be made deterministic.
  - Why the engine's `unlock` runs twice on start (the splash spec only asserts "at least once").

### Switching scenes

Changing the mood in one action instead of stopping one playlist and starting another by hand. For example, starting a playlist fades out the others in its group, or a saved scene stores a set of playlists and volumes.

- **Notes:** write the proposal at the end, once Panic Stop and Live volume exist, since both are building blocks (a fade of everything, a temporary volume per playlist).

### Sound variants

For future consideration: a sound that picks one of several files at random on each press (a sword hit with five takes), and a per-sound choice of what a second press does (overlap, restart, or stop).

- **Seam:** `SoundPlayer` starts a new instance on every press (DESIGN.md §7).

### LAN access and remote control

Open the app on a phone on the same network to choose what plays, while the PC does the playing. This merges the earlier "LAN access" and "Remote control" entries. It builds on "Basic mobile design", and the design specific to the remote (what its page shows, how it differs from the player) belongs here.

- **Seam:** commands and events are plain serializable objects and every command goes through `dispatch()`, which validates it (DESIGN.md §6). The server holds no playback state. Deletions, moves, downloads and the trash are deliberately not commands, so a remote limited to playback follows from the architecture.
- **Notes:**
  - Would add a `--host` option (DESIGN.md §1), a command relay (`POST /api/commands`), an event stream of playback state, and a "player" and "remote" role for pages.
  - Open: whether the remote is a separate page or a role of the same page. Today every open tab is an independent player, so the proposal must say which tab is the player and what happens when a second player connects.
  - Needs "Protect the API from other web pages" first, and a way to keep other people on the network out (for example a token in the link), since anything on the LAN could otherwise run downloads and delete files.

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
