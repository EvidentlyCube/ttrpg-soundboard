# Soundboard

A local soundboard for running RPG sessions. A Node.js server scans a directory of MP3/OGG files and streams them to a vanilla-JS web app, which plays everything in the browser: overlapping sound effects plus several music playlists at once.

**`DESIGN.md` is the specification.** Read the relevant section before working on a feature. Build in the order of its §13.

## Commands

- `npm start -- <dir>`: run the app against an audio directory
- `npm run dev -- <dir>`: same, restarting on code changes
- `npm test`: all tests. Single file: `node --test test/backend/foo.test.js`
- `npm run typecheck`, `npm run lint`, `npm run lint:fix`
- `npm run check`: typecheck + lint + test

To try the app by hand, use `test_fixtures/example_soundboard`. **Copy it to a temp directory first**, because the app writes `.json` files into the directory it's given and the fixture must stay pristine.

## Hard rules

- **No runtime dependencies.** App code imports only Node built-ins and its own modules. Dev dependencies are limited to type-checking and linting tools (`DESIGN.md` §1.1). Ask before adding anything else.
- Node 24.14, ES modules only, plain `.js`, no build step. The browser loads source files directly.
- `public/app/logic/**` must not use the DOM, `window`, audio APIs or Node APIs. Its type-check project enforces this; never loosen that config to make an error go away.

## DESIGN.md changes

`DESIGN.md` may be updated, but the owner reviews every change by hand. When implementation shows the design is wrong or incomplete:

1. Stop, then propose the change.
2. Make the edit in its own commit, separate from code.
3. Tell the user which sections changed and why.
4. Wait for their approval before building on it.

Never quietly diverge from the design in code.

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

- TDD: write the test first for all domain and logic code. No automated tests for DOM/UI components or `WebAudioEngine`; those are checked with the manual checklist in `DESIGN.md` §11.3.
- Tests live in `test/`, mirroring the source layout. Use `describe`/`it` from `node:test` with `node:assert/strict`. Names describe behavior (`it('ignores ended from a superseded track')`).
- Tests never write into `test_fixtures/`. Copy to a temp directory first.

## Git

- Work on `main`.
- Commit as you go, one commit per completed step, and **only when `npm run check` passes**.
- Commit messages are a short imperative summary (`Add ID3 title parser`).
