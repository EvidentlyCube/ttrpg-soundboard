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

### Approve LAN devices instead of typing a token

**Goal.** Starting with `--lan`, the user opens the app on the server (the machine that runs it), then opens one unchanging address on the phone (`http://192.168.1.20:3000/`) and taps nothing else. Opening that page *starts pairing*: the phone shows a short code and "Waiting for approval". Every page on the server (host or standalone) shows the request: the phone's address and the same code. The user chooses **Allow** or **Deny**, and on Allow the phone opens the remote page by itself and stays approved for the rest of the run.

Kept deliberately simple, for home networks:
- **One code per address.** A second tab (or a reload) from the same address gets the same code and the same pending request, not a new one.
- **Flooding bans at once.** An address that makes more than 5 pairing requests within a minute is banned immediately, with no prompt. A banned address gets `403` for everything until the server restarts.
- The run token link stays as it is today (it still works with no page open). Wrong tokens count toward the same limit, so guessing the 6 digits gets an address banned after 5 tries.

The code is not a secret; it lets the user see that the request on the screen is the one on the phone. The address is the identity of the device: on a home IPv4 network that is one device. Traffic is still plain HTTP, so this is for a home network, not a hostile one (as in `DESIGN.md` §5.2 today).

**Design changes.**
- **§1 (command line) and the Trust row of the constraints table in §1.1:** `--lan` prints one plain address per network address, then the fallback link with the token. Requests from other machines need approval or the token.
- **§5.2, "LAN access":** `checkAccess` also lets through the cookie of an approved device (`soundboard-device`, `HttpOnly`, `SameSite=Strict`, a random secret per device, stored on the server only as a hash). Without a valid cookie or token, a request from another machine reaches only the *connect* routes and files: `GET /` answers the connect page instead of the remote page, plus the vendored Tailwind file, the favicon and the connect script. Banned addresses (matched after turning `::ffff:a.b.c.d` into `a.b.c.d`) get `403` for everything. New routes under `/api/access/`:
  - `POST /api/access/requests` starts pairing for the caller's address, or finds the one already pending, and answers `{ status, code }`. This is the only request that counts toward the limit.
  - `GET /api/access/requests/mine` (polled once a second by the connect page, not counted) answers `{ status: 'none' | 'pending' | 'allowed' | 'denied' | 'banned', code? }`. The answer that first reports `allowed` also sets the device cookie.
  - `POST /api/access/requests/answer { address, decision: 'allow' | 'deny' }` is **for requests from this machine only**, like deletions and downloads today.
- **§5.2 events:** the stream of a page carries `access.requests { requests: [{ address, code }] }`, the full list of pending requests, on connect and after every change. Remotes and unapproved devices never receive it. The first answer wins; the other pages see the request disappear.
- **New §5.6 "Access control" (`src/http/access-control.js`):** `AccessControl` holds the pending requests (one per address, with a three-digit code that no other pending request uses), the approved devices and the banned addresses. Time and randomness are injected. A request expires after 2 minutes. More than 5 counted requests from an address within 60 s bans it. Everything lives in memory: a restart forgets approvals and bans, and a phone with an old cookie simply asks again.
- **§6.1 and §6.10:** `Soundboard` gets `accessRequests()`, `answerAccessRequest(address, decision)` and the event `access.requestsChanged { requests }`. `BackendApi` and `ServerEvents` get the matching method and message, with fakes.
- **New §9.16 "Connection requests":** on the server, a non-blocking banner at the top of the page, one card per request (address, code, **Allow**, **Deny**). On the phone, the connect page (`public/connect.html`, a small state machine in `public/app/logic/access-requester.js`) shows the code, "Waiting for approval…", and the outcomes "Denied", "Expired, try again" and "Blocked". On `allowed` it reloads into the remote page.
- **§10 (project structure)** and the CLI output in §1 are updated. The routes table in §5.2 gets the new routes.
- **TESTING.md:** manual checks on a real phone (pairing, two tabs, deny, flooding, restart).

**Open questions** (answered by the owner; what was decided).
1. *Wording.* The machine running the app is called the **server**, not the laptop.
2. *Complexity.* As simple as possible: pairing starts when the page opens, one code per address, more than 5 requests per minute from an address bans it at once. No request ids, no device names, no devices list, no manual Ban button.
3. *Still open, with recommended answers.* (a) Approvals and bans do not survive a restart. (b) With no page open on the server the phone shows "Open Soundboard on the server to answer", and the terminal prints one line per new request (`Connection request from 192.168.1.50, code 482`). (c) Interfaces named `docker*`, `br-*`, `veth*`, `virbr*` and `lo` are left out of the printed addresses.

**Plan.**
1. `AccessControl` — requests, codes, device secrets, bans, the rate limit, expiry. Tests with a fake clock and a seeded random.
2. Access routes and `checkAccess` — tests with fake requests: unapproved devices reach only the connect page and its files; the cookie is set once on `allowed`; `answer` answers `403` to anything but this machine; banned addresses get `403` everywhere; the token link still works; wrong tokens count toward the limit.
3. Events to pages — `access.requests` on connect and after each change, never to remotes.
4. Connect page and `AccessRequester` — tests with a fake `ConnectApi` and clock for each outcome.
5. Facade, `BackendApi`, fakes and the banner UI.
6. CLI — plain addresses, the terminal line for a request, virtual interfaces left out.
7. Manual checks in `TESTING.md`.
8. `DESIGN.md` update in its own commit, and this proposal removed.

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
