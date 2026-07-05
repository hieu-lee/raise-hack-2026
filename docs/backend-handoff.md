# Backend Handoff

## Demo Commands

- `pnpm demo:backend`: starts the static sample app, validates `fixtures/sample-app/driftradar.config.json`, runs a demo scan, and prints `Report ready: .driftradar/runs/<runId>/report.json`.
- `pnpm demo:serve`: serves the newest local run on `http://localhost:4317`.
- `pnpm sample-app`: serves only the static sample app on `http://127.0.0.1:4173`.

## Frontend Fixture

Use `fixtures/golden/report.json` for frontend development before live backend runs exist. It mirrors `fixtures/golden/frontend-handoff-run/report.json`. Screenshot and DOM assets are addressed through the same path shape as live runs:

- `fixtures/golden/frontend-handoff-run/screenshots/overview/desktop/default.png`
- `fixtures/golden/frontend-handoff-run/dom/overview/desktop/default.json`
- `fixtures/golden/frontend-handoff-run/pr-comments.md`

## Stable Report Fields

The frontend can rely on these `report.json` fields:

- `schemaVersion`: currently `1`.
- `runId`, `projectName`, `createdAt`.
- `configSummary.routes`, `configSummary.viewports`, `configSummary.states`, `configSummary.tokenFiles`.
- `summary.totalIssues`, `summary.countsByCategory`, `summary.countsBySeverity`, `summary.driftScore`.
- `tokens.counts` and `tokens.sourceFiles`.
- `pages[]`: `routeId`, `viewport`, `state`, `screenshotPath`, `capturedAt`, `browser`.
- `issues[]`: `id`, `title`, `category`, `severity`, `confidence`, `routeId`, `viewport`, `state`, `elementId`, `selectorHint`, `property`, `observedValue`, `expectedValue`, `nearestToken`, `evidence`, `reasoning`, `suggestedFix` (including optional `tsxBefore`, `tsxAfter`, `sourceFile`), `aiEnriched`, `status`.

Issue IDs are stable for unchanged route/category/property/value tuples. Screenshot bytes are not stable contract data; use paths plus issue evidence.

## Local API

`pnpm demo:serve` exposes the read-only API:

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:runId/report`
- `GET /api/runs/:runId/issues`
- `GET /api/runs/:runId/issues/:issueId`
- `GET /api/runs/:runId/assets/*`
- `GET /api/runs/:runId/export/pr-comments`

`POST /api/runs/:runId/copilot` accepts `{ message, issueId?, history? }` and returns `{ reply, model }` when `OPENAI_API_KEY` is configured.

The API returns JSON `404` errors for missing runs, issues, and assets. Copilot is the only mutation-style endpoint; issue review status stays in browser storage.

## Current Backend Scope

The scan pipeline (`src/cli/scan-pipeline.ts`) runs the deterministic demo generator, applies repo-aware fixes from `sourceRoots`, and optionally enriches issues through OpenAI when configured. See `docs/ai-workflow.md` for the full AI-native workflow.

Artifacts written per run: `manifest.json`, `tokens.json`, `pages.json`, `observations.jsonl`, `issues.json`, `report.json`, screenshots, DOM samples, and PR-comment markdown. Playwright capture and the full analyzer/classifier can replace the deterministic generator behind the same contract.
