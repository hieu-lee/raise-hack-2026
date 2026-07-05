# DriftRadar Tools

## Installed Now

- Node.js: runtime, pinned by `package.json` to Node 20+.
- pnpm: package manager. Run `pnpm install`.
- TypeScript: backend compiler. Run `pnpm build`.
- Commander: `driftradar` CLI commands.
- Zod: config and report contract validation.
- Vitest: colocated unit tests. Run `pnpm test`.
- ESLint: lint checks. Run `pnpm lint`.
- Prettier: formatting. Run `pnpm format`.
- Playwright: browser capture and dashboard smoke checks.
- PostCSS and `postcss-safe-parser`: CSS token parsing.
- culori: color normalization and distance.
- fast-glob: repo-aware source discovery for AI fixes.
- pngjs and pixelmatch: PNG metadata and visual comparison helpers.
- Express: local dashboard API, including `POST /api/runs/:runId/copilot`.
- Vite + React: dashboard UI with copilot panel (`pnpm --dir dashboard dev`).
- Codex SDK: `@openai/codex-sdk` + Codex harness for dynamic project setup and code-aware patch suggestions.
- OpenAI API (optional): `OPENAI_API_KEY` + `ai.enabled` for screenshot vision drift and live helper endpoints such as copilot.

## Deferred By Contract

- better-sqlite3 is not installed. JSON artifacts are the required storage contract; SQLite is allowed only as a derived cache if JSON becomes too slow.

## Useful Commands

- `pnpm install`: install dependencies.
- `pnpm format`: format source, fixtures, and docs.
- `pnpm lint`: run ESLint.
- `pnpm test`: run Vitest.
- `pnpm build`: compile TypeScript to `dist`.
- `pnpm validate:fixture`: validate `fixtures/config/valid.json` through the TypeScript CLI.
- `pnpm build && pnpm driftradar validate --config fixtures/config/valid.json`: verify the compiled CLI binary.
- `export OPENAI_API_KEY=...`: enable AI enrichment and dashboard copilot.
- `pnpm demo:backend`: serve the static sample app, run validate plus scan (repo fixes + optional AI), and print the report path.
- `pnpm exec tsx src/cli/index.ts scan --project /path/to/project`: ask Codex to derive a runnable UI setup, then run the real scan pipeline. Static HTML folders are served internally; JS app folders run through validated package scripts inside the macOS `sandbox-exec` runtime sandbox.
- `pnpm demo:serve`: serve the newest `.driftradar/runs/<runId>` report API on port 4317.
- `pnpm --dir dashboard dev`: run the developer dashboard.
- `pnpm sample-app`: serve only the static sample app on port 4173.

See `docs/ai-workflow.md` for the AI-native taste gate workflow.
See `docs/demo-real-repo.md` for the zero-config `scan --project` demo and big-repo gauntlet.
