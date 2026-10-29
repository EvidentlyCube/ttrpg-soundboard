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

### LAN access and remote control

**Goal.** The splash offers two choices. **Host** is today's app: it plays the audio. **Remote** is a small page for a phone on the same network: it shows the playlist and sound buttons, a Panic Stop button, and one control row per playing playlist (Previous, Pause/Play, Next, with the track and playlist titles). It never plays audio and never calls `start()` on the audio side; it only sends commands to the host page, and shows the state the host reports back. Everything else (volumes, errors, Debug, the ☰ menu, context menus, progress, Customize, downloads, trash) stays on the host's page. The two roles are kept completely apart: a remote never becomes a host, and a page can only be one of them.

**Design changes.**
- §1 and §1.1: a `--lan` option opens the server to the LAN; "Trust" and "Touch" rows change.
- §5.2: new relay routes and event messages, the request guard learns the access token and a remote-only allowlist for requests from other machines.
- §5 (new subsection): the relay (`RemoteRelay`): it keeps the latest state snapshot of the host and hands commands on. It is the only playback-related thing the server ever holds, and it holds it only in memory.
- §6: `commands.js` keeps its role (the relay forwards the commands as they are, validated by `dispatch()` on the host). New `RemoteLink` (host side) and `RemoteController` (remote side) in `logic/`, new `BackendApi` and `ServerEvents` methods. §6.2 gets the snapshot as data, not as new facade events.
- §9.0: the splash gets two buttons. §9.1 (new §9.15): the remote page.
- §3 and §10: the new CLI option, the new files, the type-check project for the remote UI.

**How it works.**
1. *Roles.* The splash has two buttons. "Host" calls `soundboard.start()` as now. "Remote" skips audio entirely and starts the `RemoteController`. The choice is not remembered: F5 shows the splash again, like every other start.
2. *Which tab is the host.* A page that starts as Host opens its event stream as `role=host`. The **first** host keeps the role for as long as its page is open: a host started later (a second tab, a phone) is an ordinary independent host as today, not controlled by the remotes, and never takes the role over. This way sound can only start coming from another device when you start Host on that device yourself, and only when no other host is there. When the host's page closes, the role is free again for the next page that starts as Host; nobody inherits it by itself. With no host, the remote shows "No host connected" and its buttons are disabled.
3. *Commands.* The remote sends `POST /api/remote/commands` with one command. The relay checks that it is one of the allowed types and forwards it to the host's stream as a `command` message; the host runs it through `dispatch()`. Allowed from a remote: `panic.stop`, `sound.play`, `playlist.toggle`, `playlist.next`, `playlist.previous`, `playlist.pause`, `playlist.resume`. Nothing that customizes, deletes or moves is relayable.
4. *State.* The host's `RemoteLink` listens to the facade's events and sends a snapshot (`PUT /api/remote/state`): the panic state, the playlists in start order that are playing or paused with their state, track title and index, and the sounds with live instances. It sends a new one on every relevant change, never on `playlist.progress` or `voices.changed`. The relay stores the latest and sends it to every remote stream (also on connect).
5. *Library.* The remote reads `GET /api/library` for titles and ids, and refetches it when the host says the library changed (the snapshot carries a `libraryVersion`).
6. *Security.* `--lan` binds `0.0.0.0` and prints a link with a random token (`http://192.168.1.20:3000/?token=…`). The token is kept in a cookie after the first visit. Requests that don't come from loopback need the token, and may only reach static files, `GET /api/library` and the `/api/remote/…` routes; every other route, `/media` included (the remote plays nothing), answers `403` to them. The `Host` check accepts the LAN address as well. Without `--lan` nothing changes.
7. *Remote page.* A top row with the Panic Stop button (same fade/now behavior, driven by the snapshot's panic state), then the playlist and sound buttons (tap = play; active ones highlighted), then the stack of players with the three buttons and the titles. No header, no footer bars, no progress, no volume, no menus. Buttons are large for touch.

**Open questions.**
1. *Names of the splash buttons.* Recommended: **Play here** ("this device plays the sound") and **Remote control** ("control a soundboard on another device"). The code calls the roles `host` and `remote`.
2. *More than one remote, more than one host.* **Decided:** any number of remotes, one host. Every remote gets every state message, so they all stay in sync with the host. The first host page keeps the role (above); no warning (a warning for two tabs is "decided against").
3. *What a tap on a playlist button does.* Recommended: `playlist.toggle`, which starts it, or pauses/resumes it when already active (check what `toggle` does today and keep the same). A tap on a sound plays it; stopping sounds is Panic Stop's job.
4. *Security.* Recommended: the token above, and the read-only/remote-only allowlist for non-loopback requests. Alternative: none (trust the LAN), which lets anything on the network delete files and run downloads.
5. *Bind address.* **Decided:** the flag is `--lan`. Alone it means all interfaces and prints every LAN address it finds as a link; `--lan <address>` binds one.
6. *HTTPS.* Not needed: the remote plays no audio, so it needs no secure context. The token travels in clear text on the LAN; acceptable?
7. *Remote on the same machine without `--lan`.* Recommended: allowed (a second tab, loopback, no token), which also makes the whole thing testable with Playwright.
8. *Stale state.* If the host closes, the relay tells the remotes at once ("No host connected"). If the host's page sleeps, commands are lost; the remote doesn't queue them.

**Plan.**
1. Relay core (`RemoteRelay`, `src/http/` or `src/remote/`) — keeps the first host (no takeover, no fallback), forwards allowed commands, stores and broadcasts the snapshot, drops the host when its stream closes; unit tests with fake streams.
2. Routes and event messages — `PUT /api/remote/state`, `POST /api/remote/commands`, the `role` query on `/api/events`, `command`, `remote.state` and `remote.host` messages; HTTP tests including `400`/`403`/`409` (no host).
3. `--lan` and the token — CLI option, binding, printed links, guard changes (`Host` names, token cookie, allowlist for non-loopback requests); tests for each refused request.
4. Snapshot and `RemoteLink` (host side) — builds snapshots from facade events, runs relayed commands through `dispatch()`; tests with the fake engine and fake `BackendApi`.
5. `RemoteController` (remote side) — keeps the library, snapshot and connection state, sends commands, emits events; tests with fakes.
6. Splash with the two buttons and the mode switch in `main.js`/`App` — Playwright.
7. Remote page UI (`ui/remote/`): buttons, Panic Stop, stack of player bars — Playwright against the test server with a host page and a remote page open together.
8. Manual checks in `TESTING.md` (a real phone on the LAN), then `DESIGN.md` update in its own commit and removal of this proposal and the backlog entry.

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
  - Design specific to the remote page belongs to "LAN access and remote control" below, not here.

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
  - Would add a `--lan` option (DESIGN.md §1), a command relay (`POST /api/commands`), an event stream of playback state, and a "host" and "remote" role for pages.
  - Open: whether the remote is a separate page or a role of the same page. Today every open tab is an independent host, so the proposal must say which tab is the host and what happens when a second host connects.
  - Builds on the request guard (DESIGN.md §5.2): the list of accepted `Host` names (`LOOPBACK_HOSTS`) is where the LAN address goes. It also needs a way to keep other people on the network out (for example a token in the link), since anything on the LAN could otherwise run downloads and delete files.

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
