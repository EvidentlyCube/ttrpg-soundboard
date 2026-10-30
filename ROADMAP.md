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

**Goal.** Starting with `--lan`, the user opens the app on the laptop, then opens one unchanging address on the phone (`http://192.168.1.20:3000/`) and taps nothing else. The phone shows a short code (three digits) and "Waiting for approval". Every page on the laptop (host or standalone) shows a request: the phone's address, a device name when one can be told, and the same code. The user compares the codes and chooses **Allow**, **Deny** or **Ban this address**. On Allow the phone opens the remote page by itself and stays approved for the rest of the run, so reloading or coming back later needs no new approval. The long run token stays as a fallback link (it also makes a request unnecessary when no page is open).

What it protects against is the same as today: another device on the same network reaching the remote. The code is not a secret; it only lets the user tell two simultaneous requests apart. The secret is a random request id that only the requesting device holds, and the device secret that approval turns it into. Traffic is still plain HTTP on the LAN, so this is for a home network, not a hostile one (as in `DESIGN.md` §5.2 today).

**Design changes.**
- **§1 (command line) and the Trust row of the constraints table in §1.1:** `--lan` prints one unchanging address per network address, plus a fallback link with the long token (the 6-digit token goes back to 32 hex characters). Requests from other machines need approval or the token. Banned addresses get `403`.
- **§5.2, "LAN access":** `checkAccess` is rewritten around an access list. A request from another machine passes with the cookie of an approved device or the run token. Without either, only the *connect* routes and files are reachable: `GET /` answers the small connect page instead of `403`, plus the vendored Tailwind file and the favicon. New routes, all under `/api/access/`:
  - `POST /api/access/requests` creates (or resumes) a request and answers `{ id, code }`. The id is 128 random bits, kept by the phone in `sessionStorage`; it is the only way to collect the approval.
  - `GET /api/access/requests/:id` (polled once a second) answers `{ status: 'pending' | 'allowed' | 'denied' | 'expired' | 'banned' }`. The answer that first reports `allowed` also sets the device cookie (`HttpOnly`, `SameSite=Strict`).
  - `POST /api/access/requests/:id/answer { decision: 'allow' | 'deny' | 'ban' }` is **for requests from this machine only**, like deletions and downloads today. A remote can never approve itself or another device.
- **§5.2 events:** the stream of a page (`/api/events?page=…`) carries `access.requests { requests: [{ id, code, address, device, at }] }`, the full list of pending requests, sent on connect and after every change (the same "current state on every connect" rule as the other messages). Remotes and unapproved devices never receive it. The first page to answer wins; the others see the request disappear.
- **New §5.6 "Access control" (`src/http/access-control.js`):** `AccessControl` holds the pending requests, the approved devices (a random secret each, stored only as a hash) and the banned addresses. Time and randomness are injected. Limits: a request expires after 2 minutes; one pending request per address (a new one replaces the old); at most 5 pending requests in all (more get `429`); after a Deny the address waits 30 seconds before it can ask again. Codes are three digits not in use by another pending request. Banned addresses are matched after turning `::ffff:a.b.c.d` into `a.b.c.d`. Everything lives in memory: a restart forgets approvals and bans, and a phone with an old cookie simply asks again.
- **§6.1 and §6.10:** `Soundboard` gets `accessRequests()`, `answerAccessRequest(id, decision)` and the events `access.requestsChanged { requests }`. `BackendApi` and `ServerEvents` get the matching method and message, with fakes for the tests. Any page that is standalone or host receives them, because both are pages on the laptop.
- **New §9.16 "Connection requests":**
  - On the laptop, a banner stack at the top of the page, one card per request (address, device, code, **Allow**, **Deny**, **Ban**). It is not a modal, so the sounds stay usable during a session.
  - On the phone, the connect page (`public/connect.html`, its small state machine in `public/app/logic/access-requester.js`, testable with a fake `ConnectApi` and clock). It shows the code, "Waiting for approval…", and the outcomes "Denied", "Expired, try again" and "Blocked". On `allowed` it reloads into the remote page.
- **§9.15** is unchanged. §9.0 (splash) is not shown to an unapproved device.
- **§10 (project structure)** and the CLI output in §1 are updated for the new files. The routes table in §5.2 gets the new routes.
- **TESTING.md:** manual checks on a real phone (approval flow, two phones at once, deny, ban, restart).

**Open questions.**
1. *What does the cookie of an approved device hold?* The long run token for everyone, or a secret of its own per device? **Recommended: a secret per device.** One leaked cookie then costs one device, and the devices list (question 8) can revoke a single one. The run token stays only as the fallback link; it is accepted wherever a device secret is.
2. *Print the fallback link?* **Recommended: yes, always, on a second line below the plain address**, so the user has a way in when no page is open (for example a phone at the table before the laptop page is loaded). It exposes the token in the terminal only, as today.
3. *Banner or modal?* **Recommended: a non-blocking banner**, because a request can arrive in the middle of a session and a modal would steal focus and clicks from the sounds.
4. *How to name the device?* **Recommended: a short summary of the `User-Agent` ("iPhone · Safari", "Android · Chrome", "Windows PC · Firefox") plus the address, and nothing else.** Reverse DNS rarely answers on home networks and slows the request; a name typed by the phone's user is text from an untrusted device in the owner's face. Be aware that Android Chrome no longer reports the phone model, so "Android" is as specific as it gets.
5. *Should approvals and bans survive a restart?* **Recommended: no.** It matches "banning only lasts while the server runs", needs no file in the user's audio directory, and re-approving once per session is a few seconds.
6. *Limits.* Are 2 minutes to expire, 1 pending per address, 5 pending in all and a 30 s wait after Deny right? **Recommended as written.** They stop a device on the network from filling the user's screen with prompts, which is the one thing this design adds as an attack surface.
7. *No page open when a device asks.* **Recommended: the phone shows "Open Soundboard on the laptop to answer", and the terminal prints one line** (`Connection request from 192.168.1.50 (Android · Chrome), code 482`). The request waits out its 2 minutes and a page that opens in that time shows it. The terminal gets no yes/no prompt.
8. *A list of devices.* A mistaken Ban can otherwise only be undone by restarting. **Recommended: add a small "Devices" dialog in the ☰ menu** listing approved devices (Revoke) and banned addresses (Unban), as the last step, so it can be dropped without touching the rest.
9. *Printed addresses.* The links today include Docker and bridge interfaces (`172.18.0.1`), which no phone can use. **Recommended: skip interfaces named `docker*`, `br-*`, `veth*`, `virbr*` and `lo`**, in the same step that prints the new links.
10. *Banning an address that is not stable* (IPv6 privacy addresses change, and phones behind one NAT share one). **Recommended: accept it and say so in `DESIGN.md`.** On a home IPv4 network an address is one device, and the ban is only a convenience for the session.

**Plan.**
1. Restore the long token — the printed link carries 32 hex characters again; the CLI test is changed back.
2. `AccessControl` (requests, codes, device secrets, bans, limits, expiry) — unit tests with a fake clock and a seeded random: code uniqueness, expiry, one request per address, the cap of 5, the Deny wait, ban matching (including `::ffff:`), secrets stored only as hashes, an approved secret and the run token both verify.
3. Access routes and `checkAccess` — tests with fake requests: unapproved devices reach only the connect page and its files; the polling route sets the cookie only to the holder of the id; the `answer` route answers `403` to anything but this machine; banned addresses get `403` everywhere; the existing allow-list for approved devices is unchanged; the token link still redirects and sets a cookie.
4. Events to pages — `access.requests` is sent to page streams on connect and after each change, never to remotes; the first answer removes the request for every page. Tested through the server with a real stream.
5. Connect page and `AccessRequester` — tests with a fake `ConnectApi` and clock for each outcome; a Playwright test through the server with an injected "is this machine" check (`lan.isLocal`, default `isLoopbackAddress`) that makes the browser count as another machine.
6. Facade, `BackendApi`, fakes and the banner UI — facade tests first; Playwright tests for Allow, Deny, Ban, two requests with different codes, and a request that expires.
7. CLI — the plain address and the fallback link, the terminal line for a request, virtual interfaces left out; `main.test.js` updated.
8. *(optional, question 8)* Devices dialog with Revoke and Unban — facade and Playwright tests.
9. Manual checks in `TESTING.md`.
10. `DESIGN.md` update in its own commit (the sections above), and this proposal removed.

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
