# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the Vite/Three.js client. Keep rendering and game presentation in `src/game/`, input and render-loop infrastructure in `src/core/`, networking in `src/net/`, audio in `src/audio/`, and asset loaders/materials in `src/assets/`. The authoritative Socket.IO room server lives in `server/`; shared protocol types belong in `src/net/protocol.ts`. Static models and audio are under `public/assets/`, while licenses and design records live in `docs/`. Tests mirror their concern under `tests/game/`, `tests/server/`, and top-level browser specs.

## Build, Test, and Development Commands

- `npm install` installs dependencies; Node.js 20.19 or newer is required.
- `npm run dev` starts Vite on port 5189 and the room server on 5191.
- `npm run build` type-checks with `tsc` and creates the production Vite bundle.
- `npm test` runs rule/server tests, then all Playwright browser tests.
- `npm run test:rules` runs fast deterministic `node:test` suites.
- `npm run test:browser` runs Playwright integration and visual coverage.
- `npm run test:balance` executes the automated balance simulation.
- `npm run verify:visual` checks the focused visual snapshot suites.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, single quotes, semicolons, and trailing commas in multiline structures. Use `PascalCase` for classes, interfaces, and class-focused filenames (`MatchEngine.ts`); use `camelCase` for functions, variables, and utility modules. Keep authoritative rules deterministic and independent from Three.js presentation. There is no separate linter; `npm run build` is the required static check, including unused-symbol errors.

Use the domain terms defined in `CONTEXT.md` (for example, “capture,” “reset,” and “sensor doll”) rather than introducing synonyms.

## Testing Guidelines

Name unit tests `*.test.ts` and browser tests `*.spec.ts`. Add regression coverage beside the affected game or server module. Playwright uses desktop Chrome at 1280×720 and stores committed baselines in `tests/deterministic-states.spec.ts-snapshots/`. Update snapshots only after visually reviewing intentional changes. No numeric coverage threshold is configured; meaningful behavior coverage is expected.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit style: `feat: add ...`, `fix: prevent ...`, or another precise lowercase type. Keep commits scoped to one behavior. Pull requests should explain player-visible and architectural effects, list verification commands, link the issue or design note, and include screenshots or recordings for visual changes.

## Agent Workflow

Because `.codegraph/` is present, run `codegraph explore "<question or symbols>"` before searching or reading files to locate code and understand call paths. Preserve unrelated working-tree changes and asset license records.
