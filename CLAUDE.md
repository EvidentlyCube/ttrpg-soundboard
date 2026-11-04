# TTRPG Soundboard

A local soundboard for running RPG sessions. A Node.js server scans a directory of MP3/OGG files and streams them to a vanilla-JS web app, which plays everything in the browser: overlapping sound effects plus several music playlists at once.

Project documents:
- **`DESIGN.md`** describes the app as it is. Read the relevant section before changing anything.
- **`ROADMAP.md`** holds feature proposals and the backlog of planned features.
- **`TESTING.md`** holds the test strategy, the test helpers and the manual browser checklist.
- **`ideas/`** holds long-term ideas and research notes, one file per topic. They are not plans; an idea becomes work only through a `ROADMAP.md` proposal.

## Commands

- `npm start -- <dir>`: run the app against an audio directory
- `npm run dev -- <dir>`: same, restarting on code changes
- `npm test`: all tests. Single file: `node --test test/backend/foo.test.js`; several: a quoted glob (a bare directory path does not work)
- `npm run typecheck`, `npm run lint`, `npm run lint:fix`
- `npm run check`: typecheck + lint + test
- `npm run pack`: the release zips into `dist/` (`DESIGN.md` §13). A release is a commit that only bumps `version` in `package.json`

To try the app by hand, use `test_fixtures/example_soundboard`. **Copy it to a temp directory first**, because the app writes `.json` files into the directory it's given and the fixture must stay pristine. The app only opens folders inside the home folder unless told otherwise, so allow the temp directory: `npm start -- --whitelisted-root /tmp/sb /tmp/sb`. Add `--no-open` when nobody will look at the browser.

## Hard rules

- **No runtime dependencies.** App code imports only Node built-ins and its own modules. Dev dependencies are limited to type-checking and linting tools (`DESIGN.md` §1.1). The one exception is the vendored Tailwind browser build in `public/vendor/` (`DESIGN.md` §9.6). Ask before adding anything else.
- UI styling uses Tailwind utility classes. Anything updated several times a second goes through inline `style` or text, never class changes; state is shown with `data-*` attributes and Tailwind's `data-*` variants.
- Node 24.14, ES modules only, plain `.js`, no build step. The browser loads source files directly.
- `public/app/logic/**` must not use the DOM, `window`, audio APIs or Node APIs. Its type-check project enforces this; never loosen that config to make an error go away.

## New features

Follow the process in `ROADMAP.md`:

1. Create the feature branch (see "Git"). Write a proposal in `ROADMAP.md` under "Proposals", using its template: goal, the `DESIGN.md` sections it changes, open questions with recommended answers, and a step-by-step plan. Commit it on its own.
2. Wait for the owner's review and answers before writing code.
3. Implement one plan step at a time, test-first. Commit each step once `npm run check` passes, summarize it, and wait for the go-ahead before the next step.
4. Update `DESIGN.md` to describe the new behavior, in its own commit, and remove the proposal (and its backlog entry, if any) from `ROADMAP.md`.
5. Propose the squash commit message, get the owner's approval, and squash the branch onto `main` (see "Git").

## DESIGN.md changes

`DESIGN.md` may be updated, but the owner reviews every change by hand. When implementation shows the design is wrong or incomplete:

1. Stop, then propose the change.
2. Make the edit in its own commit, separate from code.
3. Tell the user which sections changed and why.
4. Wait for their approval before building on it.

Never quietly diverge from the design in code. Code comments refer to design sections as `DESIGN.md §n.n`; when sections are renumbered, update those references in the same commit.

## Architecture

- Domain-driven separation. Backend: `cli/`, `library/`, `metadata/` and `http/` in `src/`. Frontend: `logic/` (domain), `audio/` and `api/` (adapters), `ui/` (DOM).
- The UI talks **only** to the `Soundboard` facade: it calls methods, then listens to events. Logic never calls the UI.
- External things sit behind interfaces with test fakes: `AudioEngine`, the clock, `BackendApi` and `Prompter`.
- Commands and events are plain, serializable objects. Future remote control depends on this.
- Playback rules (`DESIGN.md` §8): commands are synchronous and never `await`; every audio callback is tied to a generation number and ignored if stale; `stop()` releases all resources and is safe to call twice; `'instant'` transitions also kill fading-out voices.

## Code style

- Tabs for indentation, single quotes, semicolons, LF line endings, a trailing newline, and trailing commas in multi-line literals.
- Multi-line conditions put the operator at the **start** of the line:
  ```js
  if (
  	something
  	&& other
  	&& whatever
  ) {
  ```
- kebab-case file names, PascalCase classes, camelCase functions and variables, UPPER_SNAKE constants, `#private` fields.
- Classes for stateful domain objects. Plain functions for stateless logic.
- Named exports only, one main concept per file.
- JSDoc types on all public members. Code must pass `npm run typecheck`.
- Comments explain **why**, only where someone would reasonably ask why. No comments that restate the code.
- Custom error classes for domain failures. A plain `Error` only for bugs.
- American spelling in code, messages and docs.

## Testing

- TDD: write the test first for all domain and logic code. DOM/UI tests should use Playwright; When new tests pass on the first run, break the code on purpose to confirm they can fail.
- Add new manual checks to `TESTING.md` when a feature changes something only a browser can verify.
- Tests live in `test/`, mirroring the source layout. Use `describe`/`it` from `node:test` with `node:assert/strict`. Names describe behavior (`it('ignores ended from a superseded track')`).
- Tests never write into `test_fixtures/`. Copy to a temp directory first.

## Git

- Each feature or fix gets its own branch, created from `main` at the start of the session (`feature/<name>` or `fix/<name>`). The proposal is committed on it too.
- Commit as you go on the branch, one commit per completed step, and **only when `npm run check` passes**.
- Commit messages are a short imperative summary (`Add ID3 title parser`).
- When the feature or fix is finished, propose the squash commit message (see below) and revise it until the owner approves it. Then squash the branch onto `main` as a single commit with that message exactly as approved and delete the branch. Never merge or squash without the owner's approval of the message.
- A release (`version` bump only) is committed directly on `main`.

### Squash commit message

The branch's commits disappear in the squash, so the message keeps what would otherwise be lost: bugs found and fixed along the way, behavior that changed, and decisions or pitfalls a later reader would need. Go through `git log main..<branch>` and the conversation before writing it.

```
<Short imperative summary, like the other commits on main>

========================================================================

IMPORTANT

- <only when something is critical to know, such as an unfixed pitfall>

BUG FIXES

- <what was wrong, why, and how it was fixed>

BEHAVIOR CHANGES

- <what a user of the app now sees or does differently>

OTHER DETAILS

- <design decisions, internals, moved files, the DESIGN.md sections changed>

Co-Authored-By: <the attribution line>
```

- The summary line stands alone; the release notes list it as the feature's one line (`DESIGN.md` §13).
- The separator is a line of `=`, never `---`, which `git am` takes as the end of the message.
- Sections come in this order, in capitals. Leave out a section with nothing in it; `IMPORTANT` is usually absent.
- Bullets start with `- `, wrap at about 72 columns, continuation lines indented two spaces. Name files, functions and routes so they can be searched for.
- The last bullet of `OTHER DETAILS` lists the `DESIGN.md` sections that changed.
- Propose the whole message in a code block, and say why anything unusual is there. When a problem it describes can still be fixed on the branch, offer that before squashing.
- Squash with the message in a file, so nothing in it is rewritten: `git switch main`, `git merge --squash <branch>`, `git commit --cleanup=verbatim -F <file>`. Check that `git diff <branch> HEAD` is empty, then `git branch -D <branch>`.
