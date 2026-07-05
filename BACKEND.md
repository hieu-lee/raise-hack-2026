# BACKEND.md

## Project: DriftRadar backend

Build the local scan engine, data contracts, report API, and test fixtures for DriftRadar. No auth and no required model keys. Deterministic drift detection is always available offline. Optional OpenAI enrichment (`ai.enabled` + `OPENAI_API_KEY`) adds vision drift, ambiguous classification, repo-aware fixes, and dashboard copilot responses.

## Deadlines

- Backend feature complete: 2026-07-05T00:44:11.455668+02:00
- Overall demo deadline: 2026-07-05T19:00:00+02:00
- Frontend implementation must not start until backend contracts below are implemented, tested, and committed.

## Required tools/libraries

- Node.js 22 LTS or current stable 20+
- pnpm
- TypeScript
- Commander for CLI commands
- Zod for config and report contract validation
- Playwright for crawling pages, Storybook stories, screenshots, hover, focus, disabled, dark mode, and viewport variants
- PostCSS plus postcss-safe-parser for CSS parsing
- culori for color normalization and distance
- fast-glob for file discovery
- pngjs and pixelmatch for image metadata and visual comparison helpers
- better-sqlite3 only if JSON artifacts become too slow; JSON files are the required hackathon storage contract
- Express or Fastify for the local read-only dashboard API; prefer Express for speed
- Vitest for unit and integration tests
- ESLint and Prettier for formatting and linting

## Non-negotiable workflow

- Every step below has exactly one owner. Do not edit another owner’s files without a handoff comment in the PR or commit message.
- Format code and commit after every completed feature. Minimum command before each commit: `pnpm format && pnpm test`.
- Keep branches small: one feature, one commit or short commit stack.
- Prefer deterministic output over clever model behavior. The demo must run offline.
- No generated artifacts committed except tiny golden fixtures under owner-approved fixture paths.
- All backend paths are relative to repo root unless stated otherwise.
- Feature owners own colocated unit tests for their own source folders. Dev 6 owns only cross-feature integration tests, sample-app fixtures, golden frontend handoff fixtures, scripts, and docs.
- Capture code owned by Dev 3 must not import `src/storage/**`. B4 emits DOM JSON plus in-memory observation records only; B7 is the first step that serializes those records into `observations.jsonl`.

## Explicit assignments for Dev instances

- Instance 2: Dev 2 owns backend CLI, config, shared contracts, token ingestion, and their colocated tests and fixtures.
- Instance 3: Dev 3 owns browser capture, state capture, DOM sampling, element IDs, and their colocated tests and fixtures.
- Instance 4: Dev 4 owns observation normalization, metrics, drift classification, and their colocated tests and fixtures.
- Instance 5: Dev 5 owns storage, report assembly, suggestions, export, local API, and their colocated tests and fixtures.
- Instance 6: Dev 6 owns sample app, cross-feature integration tests, smoke scripts, golden handoff fixtures, and backend handoff docs.

## Ownership map to minimize merge conflicts

- Dev 2 owns CLI, config, shared schemas, token ingestion, and token/config fixtures: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.prettierrc`, `.eslintrc`, `src/cli/**`, `src/config/**`, `src/contracts/**`, `src/tokens/**`, `fixtures/config/**`, `fixtures/tokens/**`.
- Dev 3 owns browser capture, state capture, DOM sampling, element IDs, and DOM fixture HTML: `playwright.config.ts`, `src/capture/**`, `src/states/**`, `fixtures/html/**`, `artifacts/example-screenshots/.gitkeep`.
- Dev 4 owns observation extraction, metrics, drift analysis, classification, and classifier fixtures: `src/analyze/**`, `src/classify/**`, `src/metrics/**`, `fixtures/classify/**`.
- Dev 5 owns storage, report assembly, local API, export, suggestions, and API fixture runs: `src/storage/**`, `src/report/**`, `src/server/**`, `src/export/**`, `fixtures/api-runs/**`.
- Dev 6 owns sample app, integration tests, smoke scripts, frontend handoff fixtures, and docs: `sample-app/**`, `fixtures/sample-app/**`, `fixtures/golden/**`, `tests/integration/**`, `scripts/**`, `docs/**`.
- Colocated unit tests such as `src/tokens/token-ingest.test.ts` or `src/server/server.test.ts` are owned by the same owner as the source folder.
- Root `tests/**` is reserved for Dev 6 integration and smoke coverage only.
- Shared fixture changes outside the owner path require a handoff comment before editing.

## Backend contracts

### CLI contract

Required executable name: `driftradar`.

Required commands:

- `driftradar scan --config driftradar.config.json`
  - Runs token ingestion, capture, analysis, suggestion, and report writing.
  - Prints one final line: `Report ready: .driftradar/runs/<runId>/report.json`.
- `driftradar serve --run <runId> --port 4317`
  - Starts local read-only API for the dashboard.
  - Serves JSON and screenshot assets from `.driftradar/runs/<runId>`.
- `driftradar validate --config driftradar.config.json`
  - Validates config, token files, URLs, and output folder writability without running screenshots.

Optional only after required commands work:

- `driftradar export-pr --run <runId> --out pr-comments.md`

### Config contract

File: `driftradar.config.json`.

Required fields:

- `projectName`: display name.
- `baseUrl`: local app or Storybook URL.
- `routes`: array of route objects with `id`, `url`, and optional `label`.
- `tokenFiles`: array of CSS or JSON token files.
- `outputDir`: default `.driftradar`.

Optional fields:

- `viewports`: array of `{ name, width, height }`; default desktop 1440x900 and mobile 390x844.
- `states`: array from `default`, `hover`, `focus`, `disabled`, `dark`.
- `storybookMode`: boolean.
- `thresholds`: object with color, spacing, radius, typography, shadow tolerances.
- `ai`: object with `enabled`, `model`, `reasoningEffort`, `sourceRoots`; defaults to disabled. See `docs/ai-workflow.md`.
- `ollama`: deprecated alias; `enabled` still opts into AI when `ai.enabled` is unset.
- `captureMode`: `"demo"` (default, zero-setup fixture generator) or `"real"` (actual Playwright capture, token analysis, and drift classification against `baseUrl`/`routes`/`tokenFiles` — use this to scan a real product or third-party repo). See `docs/demo-real-repo.md`.

### Token contract

Token ingestion must output canonical `tokens.json` with:

- `sourceFiles`: input files and modified times.
- `colors`: token name, css variable, original value, normalized oklch, hex fallback.
- `spacing`: token name, css variable, px value.
- `radii`: token name, css variable, px value.
- `typography`: family, size, lineHeight, weight, letterSpacing.
- `shadows`: normalized offset, blur, spread, color.

CSS variables must be supported from `:root`, `[data-theme=dark]`, `.dark`, and media query dark mode blocks. JSON tokens may be a flat map or W3C-style token object.

### Capture contract

Capture emits or returns:

- `pages.json`: route, viewport, state, screenshot path, capturedAt, browser metadata.
- `screenshots/<routeId>/<viewport>/<state>.png`.
- `dom/<routeId>/<viewport>/<state>.json` with sampled elements and computed styles.
- In-memory `ObservationRecord[]` for the scan pipeline. Dev 3 does not write `observations.jsonl`; Dev 5 writes it in B7 when storage exists.

Each sampled element must include stable fields:

- `elementId`: deterministic hash from route, DOM path, role or class hint.
- `selectorHint`: short non-fragile selector for display only.
- `role`, `tagName`, `textSample`, `boundingBox`.
- `computed`: color, backgroundColor, borderColor, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, margin, padding, gap, borderRadius, boxShadow, opacity, cursor.

### Analysis and issue contract

Report issue categories:

- `token_misuse`: value is near an existing token but not using it.
- `new_pattern_candidate`: repeated untokenized value or component style appears three or more times.
- `accidental_regression`: visual or style drift appears isolated and inconsistent with surrounding system.
- `acceptable_exception`: off-token but justified by route context, browser constraint, or one-off external content.

Issue severity:

- `critical`: likely user-visible brand or interaction break.
- `high`: repeated inconsistency or likely wrong token.
- `medium`: isolated visual drift.
- `low`: acceptable exception or weak signal.

Canonical `report.json` fields:

- `schemaVersion`: start with `1`.
- `runId`, `projectName`, `createdAt`, `configSummary`.
- `summary`: totalIssues, countsByCategory, countsBySeverity, driftScore from 0 to 100.
- `tokens`: counts and source file summaries.
- `pages`: route capture summaries.
- `issues`: array of issue objects.

Canonical issue fields:

- `id`: stable deterministic hash.
- `title`: short human-readable label.
- `category`, `severity`, `confidence` from 0 to 1.
- `routeId`, `viewport`, `state`.
- `elementId`, `selectorHint`.
- `property`: color, spacing, radius, typography, shadow, interaction, or component-pattern.
- `observedValue`, `expectedValue`, `nearestToken` if any.
- `evidence`: screenshot path, optional crop box, tokenDistance, occurrenceCount, relatedIssueIds.
- `reasoning`: deterministic paragraph explaining why this is drift.
- `suggestedFix`: type, cssBefore, cssAfter, tsxBefore, tsxAfter, sourceFile, humanInstruction.
- `aiEnriched`: optional boolean when model-assisted classification or prose was applied.
- `status`: always `open` on generation.

### Storage contract

All run artifacts live under `.driftradar/runs/<runId>`.

Required files:

- `manifest.json`: run metadata, timings, command args, status.
- `tokens.json`: canonical tokens.
- `pages.json`: capture metadata.
- `observations.jsonl`: one element observation per line, serialized by Dev 5 storage from the capture and analysis handoff records.
- `issues.json`: raw issue list.
- `report.json`: dashboard-ready report.
- `screenshots/**`: PNG screenshots.
- `dom/**`: DOM and computed-style samples.

Do not require SQLite for the demo. If Dev 5 adds SQLite, it must be a derived cache named `index.sqlite` and JSON remains the source of truth.

### Local API contract

Base URL from `driftradar serve`: `http://localhost:4317` by default.

Required endpoints:

- `GET /api/health` returns status and server version.
- `GET /api/runs` returns available local runs, newest first.
- `GET /api/runs/:runId/report` returns canonical `report.json`.
- `GET /api/runs/:runId/issues` returns issue array plus summary.
- `GET /api/runs/:runId/issues/:issueId` returns one issue.
- `GET /api/runs/:runId/assets/*` serves screenshots and DOM artifacts read-only.
- `GET /api/runs/:runId/export/pr-comments` returns markdown suggestions.
- `POST /api/runs/:runId/copilot` accepts `{ message, issueId?, history? }` and returns `{ reply, model }`. Localhost clients only; requires `OPENAI_API_KEY` for live model replies.

Scan artifacts remain read-only. Issue review status stays in browser local storage. Copilot does not mutate run files.

## Development steps

### Dev 2 progress

- B1 Repo bootstrap, shared contracts, and CLI shell: complete.
- B2 Token ingestion: complete.

### B1. Repo bootstrap, shared contracts, and CLI shell — Owner: Dev 2

Files: root config files, `src/cli/**`, `src/config/**`, `src/contracts/**`, `fixtures/config/**`.

Tasks:

1. Create Node TypeScript project with pnpm, Vitest, ESLint, and Prettier.
2. Implement `driftradar` binary entry with commands `scan`, `serve`, and `validate` as stubs.
3. Define Zod schemas for config, tokens, captures, DOM samples, observation records, issues, and report.
4. Define shared TypeScript types for the capture-to-storage handoff, especially `ObservationRecord[]`. Do not define or import a storage writer in Dev 3 code.
5. Add `pnpm format`, `pnpm lint`, `pnpm test`, and `pnpm build` scripts.
6. Add config validation tests under `src/config/**` using valid and invalid fixtures under `fixtures/config/**`.
7. Format code and commit after this feature.

Acceptance:

- `pnpm build` passes.
- `driftradar validate --config fixtures/config/valid.json` exits 0.
- Invalid config exits nonzero with actionable messages.

### B2. Token ingestion — Owner: Dev 2

Files: `src/tokens/**`, `fixtures/tokens/**`.

Tasks:

1. Parse CSS variables from CSS files using PostCSS safe parser.
2. Parse flat and W3C-style JSON token files.
3. Normalize colors, spacing, radii, typography, and shadows into the token contract.
4. Preserve source file and original token names for explainability.
5. Add unit tests under `src/tokens/**` for CSS, JSON, duplicate tokens, dark mode tokens, and malformed input, using only `fixtures/tokens/**`.
6. Format code and commit after this feature.

Acceptance:

- `tokens.json` generated from token fixtures matches a small golden snapshot under `fixtures/tokens/golden/**`.
- Bad token files do not crash the scan; they produce validation errors.

### B3. Playwright crawler and state capture — Owner: Dev 3

Files: `src/capture/**`, `src/states/**`, `playwright.config.ts`, `artifacts/example-screenshots/.gitkeep`.

Progress: Complete in this assignment. Dev 3 added deterministic Chromium capture, state application, screenshot/page metadata output, warnings for failed routes, and colocated coverage.

Tasks:

1. Launch Chromium with deterministic viewport, reduced motion, and stable timezone.
2. Visit configured routes or Storybook story URLs.
3. Capture states: default, hover, focus, disabled, dark mode.
4. Save full-page screenshots using required path contract.
5. Emit `pages.json` with route, viewport, state, and asset metadata.
6. Add colocated capture tests under `src/capture/**` using mocks or tiny static inputs; do not use root `tests/**`.
7. Format code and commit after this feature.

Acceptance:

- Sample route produces screenshots for every configured viewport and state.
- Missing route is reported as a scan warning, not an unhandled crash.

### B4. DOM computed-style sampler — Owner: Dev 3

Files: `src/capture/dom-sampler.ts`, `src/capture/element-id.ts`, `src/capture/types.ts`, `fixtures/html/**`.

Progress: Complete in this assignment. Dev 3 added DOM sampling, stable element IDs, DOM JSON documents, in-memory observation records, HTML fixtures, and colocated coverage.

Tasks:

1. Sample visible interactive elements, text elements, buttons, links, cards, inputs, nav items, and elements with non-default background or border.
2. Extract computed styles listed in the capture contract.
3. Generate deterministic element IDs from route, DOM path, role, tag, and class hint.
4. Write `dom/**/*.json` files for sampled pages and return normalized observation records from the capture function using the shared contract from B1.
5. Do not write `observations.jsonl` in this step and do not import `src/storage/**`; Dev 5 owns JSONL persistence in B7.
6. Add tests for element ID stability under `src/capture/**` using static HTML fixtures under `fixtures/html/**`.
7. Format code and commit after this feature.

Acceptance:

- Re-running capture on unchanged sample app keeps at least 95 percent of element IDs stable.
- Hidden elements and zero-size nodes are excluded.
- B4 can run and test without the storage layer being implemented.

### B5. Observation normalization and metrics — Owner: Dev 4

Files: `src/analyze/**`, `src/metrics/**`.

Progress: Completed by Dev 4 in this worktree.

Tasks:

1. Convert raw computed styles into comparable observations for color, spacing, radius, typography, and shadow.
2. Implement token distance metrics: perceptual color distance, px deltas, typography family and weight comparison, shadow component distance.
3. Cluster similar-but-not-identical values with simple threshold clustering.
4. Detect repeated untokenized values appearing three or more times.
5. Add unit tests for near-token detection and cluster grouping under `src/analyze/**` or `src/metrics/**` only.
6. Format code and commit after this feature.

Acceptance:

- `#1E64D8` near `--color-primary-600` is detected when within threshold.
- Repeated 44px pill button radius or height is clustered as a new pattern candidate.

### B6. Drift classification engine — Owner: Dev 4

Files: `src/classify/**`, `fixtures/classify/**`.

Progress: Completed by Dev 4 in this worktree.

Tasks:

1. Classify observations into `token_misuse`, `new_pattern_candidate`, `accidental_regression`, or `acceptable_exception`.
2. Calculate severity and confidence using deterministic heuristics.
3. Generate concise deterministic reasoning for each issue.
4. De-duplicate related issues across states and viewports.
5. Add golden tests for all four categories under `src/classify/**`, using fixtures only from `fixtures/classify/**`.
6. Format code and commit after this feature.

Acceptance:

- Classifier produces stable issue IDs for unchanged input.
- Weak one-off drift is low severity or acceptable exception instead of noisy high severity.

### B7. Storage writer, report builder, and local API — Owner: Dev 5

Files: `src/storage/**`, `src/report/**`, `src/server/**`, `fixtures/api-runs/**`.

Progress: complete in `src/storage/run-storage.ts`, `src/report/report-builder.ts`, `src/server/server.ts`, and `fixtures/api-runs/**`.

Tasks:

1. Implement run directory creation and atomic JSON writes.
2. Write `manifest.json`, `tokens.json`, `pages.json`, `issues.json`, and `report.json`.
3. Serialize capture and analysis observation records into `observations.jsonl`; this is the only required JSONL writer for the demo.
4. Assemble canonical dashboard-ready report with summary counts and drift score.
5. Implement Express read-only endpoints from the API contract.
6. Add API tests under `src/server/**` using a fixture run directory under `fixtures/api-runs/**`.
7. Format code and commit after this feature.

Acceptance:

- `driftradar serve --run <runId>` serves report and screenshots locally.
- API returns 404 JSON errors for missing run or issue.
- A fixture run containing in-memory observation records is persisted as valid `observations.jsonl`.

### B8. Reconciliation suggester and PR comment export — Owner: Dev 5

Files: `src/report/suggestions.ts`, `src/export/**`.

Progress: complete in `src/report/suggestions.ts`, `src/export/pr-comments.ts`, and colocated tests.

Tasks:

1. For token misuse, suggest replacing observed literal with nearest token variable.
2. For new pattern candidates, suggest component or token promotion with occurrence count.
3. For accidental regressions, suggest reverting to nearest known route, state, or token value when available.
4. Build markdown export grouped by severity and route.
5. Expose `GET /api/runs/:runId/export/pr-comments`.
6. Add colocated tests under `src/report/**` or `src/export/**`; do not edit Dev 6 integration tests.
7. Format code and commit after this feature.

Acceptance:

- Example output includes concrete before and after CSS snippets.
- Export markdown is useful when pasted into a PR comment.

### B9. Sample app, intentional drift fixtures, and integration tests — Owner: Dev 6

Files: `sample-app/**`, `fixtures/sample-app/**`, `tests/integration/**`.

Tasks:

1. Build a tiny local sample app with tokens and intentionally drifted components.
2. Include routes for buttons, cards, form controls, nav, and dark mode.
3. Add sample config pointing at the local app under `fixtures/sample-app/**`.
4. Create integration test under `tests/integration/**` that runs validate, scan, and serve against the sample app.
5. Add golden `report.json` shape test without asserting fragile screenshot bytes.
6. Verify the full scan writes `observations.jsonl` through Dev 5 storage, not directly from Dev 3 capture.
7. Format code and commit after this feature.

Acceptance:

- Demo scan finds at least one issue in each required category.
- A clean or fixed sample route shows issue count decreasing after the intentional fix fixture is used.

### B10. Backend smoke script and frontend handoff package — Owner: Dev 6

Files: `scripts/**`, `fixtures/golden/**`, `docs/backend-handoff.md`.

Tasks:

1. Add `pnpm demo:backend` to start sample app, run scan, and print the report path.
2. Add `pnpm demo:serve` to serve the latest run on port 4317.
3. Document exact report fields the frontend can rely on.
4. Save one tiny golden run fixture for frontend development under `fixtures/golden/**`.
5. Verify all backend tests pass before the backend deadline.
6. Format code and commit after this feature.

Acceptance:

- Fresh clone can run `pnpm install && pnpm demo:backend && pnpm demo:serve`.
- Frontend has a stable fixture and API endpoint before starting implementation.

Progress, Dev 6:

- Complete: static sample app with buttons, cards, forms, nav, dark mode, and fixed drift route lives under `sample-app/**`.
- Complete: sample and fixed scan configs live under `fixtures/sample-app/**`.
- Complete: cross-feature integration coverage lives under `tests/integration/dev6-handoff.test.ts` and runs validate, scan, serve, golden report validation, JSONL handoff checks, and fixed-route issue reduction.
- Complete: backend smoke scripts are wired as `pnpm demo:backend`, `pnpm demo:serve`, and `pnpm sample-app`.
- Complete: frontend handoff fixture lives under `fixtures/golden/frontend-handoff-run/**`, including `report.json`, JSON artifacts, DOM sample, PR-comment export, and a tiny screenshot asset.
- Complete: frontend handoff docs live in `docs/backend-handoff.md`.
- Note: Dev 6 added a narrow deterministic CLI scan fallback for the sample app handoff. It now writes through Dev 5 storage/report/export code and serves through the shared read-only API server.

## Test plan

- Unit tests: config parsing, token normalization, metric distance, clustering, classification, suggestions. Each unit test lives beside the owning feature source.
- Integration tests: sample app scan produces report, local API serves report and assets, export endpoint returns markdown. These live under `tests/integration/**` and are owned by Dev 6.
- Contract tests: `report.json` validates against Zod schema and golden shape.
- Stability tests: run scan twice on unchanged sample app and verify stable issue IDs and mostly stable element IDs.
- Failure tests: missing URL, malformed CSS, missing token file, screenshot failure, unavailable port.
- Coordination test: capture can produce observation records without storage, and storage can serialize those records into JSONL later.

## Backend done criteria

- All required CLI commands work.
- Sample app scan produces screenshots, observations, issues, suggestions, and report.
- Local API serves the report with no auth.
- `pnpm format && pnpm lint && pnpm test && pnpm build` pass.
- Dev 6 has committed frontend handoff fixture before 2026-07-05T00:44:11.455668+02:00.
