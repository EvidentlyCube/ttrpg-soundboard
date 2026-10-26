# Soundboard

A local soundboard for running RPG sessions. A Node.js server scans a directory of MP3/OGG files and streams them to a vanilla-JS web app, which plays everything in the browser: overlapping sound effects plus several music playlists at once.

Project documents:
- **`DESIGN.md`** describes the app as it is. Read the relevant section before changing anything.
- **`ROADMAP.md`** holds feature proposals and the backlog of planned features.
- **`TESTING.md`** holds the test strategy, the test helpers and the manual browser checklist.

## Commands

- `npm start -- <dir>`: run the app against an audio directory
- `npm run dev -- <dir>`: same, restarting on code changes
- `npm test`: all tests. Single file: `node --test test/backend/foo.test.js`; several: a quoted glob (a bare directory path does not work)
- `npm run typecheck`, `npm run lint`, `npm run lint:fix`
- `npm run check`: typecheck + lint + test

To try the app by hand, use `test_fixtures/example_soundboard`. **Copy it to a temp directory first**, because the app writes `.json` files into the directory it's given and the fixture must stay pristine.

## Hard rules

- **No runtime dependencies.** App code imports only Node built-ins and its own modules. Dev dependencies are limited to type-checking and linting tools (`DESIGN.md` §1.1). The one exception is the vendored Tailwind browser build in `public/vendor/` (`DESIGN.md` §9.6). Ask before adding anything else.
- UI styling uses Tailwind utility classes. Anything updated several times a second goes through inline `style` or text, never class changes; state is shown with `data-*` attributes and Tailwind's `data-*` variants.
- Node 24.14, ES modules only, plain `.js`, no build step. The browser loads source files directly.
- `public/app/logic/**` must not use the DOM, `window`, audio APIs or Node APIs. Its type-check project enforces this; never loosen that config to make an error go away.

## New features

Follow the process in `ROADMAP.md`:

1. Write a proposal in `ROADMAP.md` under "Proposals", using its template: goal, the `DESIGN.md` sections it changes, open questions with recommended answers, and a step-by-step plan. Commit it on its own.
2. Wait for the owner's review and answers before writing code.
3. Implement one plan step at a time, test-first. Commit each step once `npm run check` passes, summarize it, and wait for the go-ahead before the next step.
4. Finally update `DESIGN.md` to describe the new behavior, in its own commit, and remove the proposal (and its backlog entry, if any) from `ROADMAP.md`.

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

- TDD: write the test first for all domain and logic code. No automated tests for DOM/UI components or `WebAudioEngine`; those are checked with the manual checklist in `TESTING.md`. When new tests pass on the first run, break the code on purpose to confirm they can fail.
- Add new manual checks to `TESTING.md` when a feature changes something only a browser can verify.
- Tests live in `test/`, mirroring the source layout. Use `describe`/`it` from `node:test` with `node:assert/strict`. Names describe behavior (`it('ignores ended from a superseded track')`).
- Tests never write into `test_fixtures/`. Copy to a temp directory first.

## Git

- Work on `main`.
- Commit as you go, one commit per completed step, and **only when `npm run check` passes**.
- Commit messages are a short imperative summary (`Add ID3 title parser`).
