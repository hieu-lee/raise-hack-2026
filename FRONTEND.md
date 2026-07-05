# FRONTEND.md

## Project: DriftRadar dashboard

Build the local DriftRadar dashboard for the completed backend handoff. The frontend reads a generated scan report, explains design-system drift findings, and helps a team decide what to fix, promote, or accept. This is a hackathon demo surface: fast, clear, offline-first for deterministic scans, with optional OpenAI copilot when the local API and `OPENAI_API_KEY` are configured.

## Backend handoff status

Frontend implementation may start now.

Backend capabilities completed or available for frontend work:

- CLI commands exist: `driftradar validate`, `driftradar scan`, `driftradar serve`, and PR export support.
- Local read-only API exists at `http://localhost:4317` when `pnpm demo:serve` or equivalent backend serve command is running.
- Sample app and deterministic demo scan path exist.
- Frontend handoff fixture exists at `fixtures/golden/frontend-handoff-run/**`.
- Backend handoff docs exist at `docs/backend-handoff.md`.
- Generated report includes issues (with optional `aiEnriched`, `tsxBefore`/`tsxAfter`, `sourceFile`), screenshots or screenshot placeholders, DOM artifacts, observations JSONL, and PR-comment export fixture.
- Backend is read-only for scan artifacts. Issue review status stays client-only. `POST /api/runs/:runId/copilot` is the only interactive AI endpoint and is localhost-only.

Overall demo deadline: `2026-07-05T19:00:00+02:00`.

## Required tools/libraries

- Vite
- React
- TypeScript
- CSS Modules or plain CSS with CSS variables; prefer plain CSS for speed
- Vitest
- React Testing Library
- Playwright for browser smoke checks
- ESLint and Prettier
- Optional: Zod only if reusing backend schemas is trivial; otherwise copy a small TypeScript contract from `report.json`
- No external UI kit
- No hosted fonts
- No analytics
- No auth
- No required network access except the local backend API

## Non-negotiable workflow

- Every step below has exactly one owner. Do not edit another owner’s files without a handoff note in the PR or commit message.
- Format code and commit after every completed feature. Minimum command before each commit: `pnpm --dir dashboard format && pnpm --dir dashboard test`.
- Start with the committed golden fixture, then verify against live `driftradar serve`.
- Keep UI state client-only. Do not add scan mutation endpoints beyond the documented copilot route.
- Optimize for a crisp demo over a complete product.
- Prefer robust rendering of partial data over strict assumptions. Optional report fields may be missing.
- Do not edit backend source files for frontend convenience. If a backend issue is found, document it and build a frontend fallback.
- Do not introduce sign-up-only services, hosted fonts, analytics, or auth. OpenAI copilot is optional and only used when the user configures `OPENAI_API_KEY` server-side.

## Frontend data sources

### Live API mode

Default local API base URL:

- `http://localhost:4317`

Required endpoints implemented by backend:

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:runId/report`
- `GET /api/runs/:runId/issues`
- `GET /api/runs/:runId/issues/:issueId`
- `GET /api/runs/:runId/assets/*`
- `GET /api/runs/:runId/export/pr-comments`
- `POST /api/runs/:runId/copilot` (localhost only; optional OpenAI triage chat)

Client behavior in live mode:

1. Request `/api/health`.
2. Request `/api/runs`.
3. Pick newest run unless a run ID is present in the URL query string.
4. Request `/api/runs/:runId/report`.
5. Resolve screenshot or DOM asset paths through `/api/runs/:runId/assets/<relativePath>`.
6. Fetch export markdown from `/api/runs/:runId/export/pr-comments` on the Export screen.

### Fixture mode

Backend handoff fixture source:

- `fixtures/golden/frontend-handoff-run/**`

Frontend fixture runtime path:

- `dashboard/public/fixtures/frontend-handoff-run/**`

Dev 2 should copy the committed backend handoff fixture into `dashboard/public/fixtures/frontend-handoff-run/**` during scaffold work. Keep it tiny. Do not modify the backend-owned golden fixture in `fixtures/golden/**`.

Client behavior in fixture mode:

1. If live API health fails, show a visible fixture-mode banner.
2. Load `/fixtures/frontend-handoff-run/report.json`.
3. Resolve screenshot assets relative to `/fixtures/frontend-handoff-run/`.
4. For export, first try a fixture markdown file if present; otherwise generate client-side fallback markdown from `report.issues`.

### Disconnected mode

If both live API and fixture report fail:

- Do not render a blank screen.
- Show a clear setup panel:
  - Run `pnpm install`.
  - Run `pnpm demo:backend`.
  - Run `pnpm demo:serve`.
  - In another terminal, run `pnpm --dir dashboard dev`.

## Report fields the frontend can rely on

Treat `report.json` as the source of truth for the dashboard. The UI should tolerate missing optional fields.

Required top-level fields expected from the completed backend:

- `schemaVersion`
- `runId`
- `projectName`
- `createdAt`
- `configSummary`
- `summary`
- `tokens`
- `pages`
- `issues`

Required summary fields:

- `totalIssues`
- `countsByCategory`
- `countsBySeverity`
- `driftScore`

Issue fields expected by UI:

- `id`
- `title`
- `category`
- `severity`
- `confidence`
- `routeId`
- `viewport`
- `state`
- `elementId`
- `selectorHint`
- `property`
- `observedValue`
- `expectedValue`
- `nearestToken`
- `evidence`
- `reasoning`
- `suggestedFix`
- `status`

Issue categories:

- `token_misuse`
- `new_pattern_candidate`
- `accidental_regression`
- `acceptable_exception`

Issue severities:

- `critical`
- `high`
- `medium`
- `low`

Important frontend assumptions:

- Backend-generated `issue.status` is always `open` at generation time.
- Any reviewed, accepted, hidden, or copied state is frontend-only local storage keyed by `runId` and `issueId`.
- `nearestToken`, `expectedValue`, `evidence.cropBox`, `evidence.tokenDistance`, `evidence.occurrenceCount`, `suggestedFix.cssBefore`, and `suggestedFix.cssAfter` may be absent.
- Screenshots may be unavailable or intentionally tiny in fixture mode. Always render a useful placeholder.
- The export endpoint returns markdown text. Do not assume JSON for export.

## Explicit assignments for Dev instances

- Instance 2: Dev 2 owns frontend scaffold, fixture wiring, API client, shared types, app shell, routing, run landing, and their colocated tests.
- Instance 3: Dev 3 owns overview, score cards, filters, shared filtering utilities, lightweight charts, and their colocated tests.
- Instance 4: Dev 4 owns issue workbench, issue list, issue detail, screenshot viewer, code snippets, issue badges, and their colocated tests.
- Instance 5: Dev 5 owns export panel, copy actions, client-local review state, review action components, review status badges, demo callouts, and their colocated tests.
- Instance 6: Dev 6 owns cross-feature tests, browser smoke checks, accessibility sweep, responsive polish, frontend scripts, demo checklist, and README.

Progress:

- Dev 3 complete: F3 overview/summary cards/lightweight bar charts and F4 reusable filters/query-state utilities are implemented with colocated tests. Added a minimal dashboard scaffold, fixture copy, workspace entry, and shared report types only because no Dev 2 scaffold existed in this worktree.

## Frontend ownership map to minimize merge conflicts

- Dev 2 owns: `dashboard/package.json`, `dashboard/index.html`, `dashboard/vite.config.ts`, `dashboard/tsconfig*.json`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/api/**`, `dashboard/src/types/**`, `dashboard/src/layout/**`, `dashboard/src/screens/RunLanding/**`, `dashboard/public/fixtures/**`.
- Dev 3 owns: `dashboard/src/screens/Overview/**`, `dashboard/src/components/ScoreCard/**`, `dashboard/src/components/Filters/**`, `dashboard/src/components/SummaryBar/**`, `dashboard/src/lib/filtering/**`.
- Dev 4 owns: `dashboard/src/screens/Issues/**`, `dashboard/src/components/ScreenshotViewer/**`, `dashboard/src/components/CodeSnippet/**`, `dashboard/src/components/IssueBadge/**`.
- Dev 5 owns: `dashboard/src/screens/Export/**`, `dashboard/src/components/CopyButton/**`, `dashboard/src/components/ReviewActions/**`, `dashboard/src/components/ReviewStatusBadge/**`, `dashboard/src/components/DemoCallout/**`, `dashboard/src/state/**`.
- Dev 6 owns: `dashboard/tests/**`, `dashboard/scripts/**`, `dashboard/src/test/**`, `dashboard/src/styles/**`, `dashboard/README.md`.

Rules to avoid overlap:

- Colocated test files are owned by the same owner as the component or module folder.
- Dev 3 owns all reusable filtering logic. Dev 4 imports from `dashboard/src/lib/filtering/**` and must not create separate filter utilities under `dashboard/src/screens/Issues/**`.
- Dev 5 review UI must live under `dashboard/src/components/ReviewActions/**` and `dashboard/src/components/ReviewStatusBadge/**`, not under `dashboard/src/screens/Issues/**`.
- Mounting Dev 5 review components into Dev 4 issue screens requires an explicit Dev 4 handoff note. Keep it to the smallest import and render call.
- Dev 6 should prefer CSS-only polish in `dashboard/src/styles/**` and tests in `dashboard/tests/**`. If Dev 6 must edit feature files for accessibility labels, include a handoff note from the owner.

## Required screens

### 1. Run landing screen

Purpose: prove this is a local DriftRadar scan report, not a generic dashboard.

Content:

- Project name
- Run ID
- Created time
- Report schema version
- Backend connection badge: live API, fixture mode, or disconnected
- Summary stats:
  - Total issues
  - Drift score
  - Routes or page captures scanned
  - Screenshots captured if derivable from `pages`
  - Tokens loaded if derivable from `tokens`
- Primary action: View issues
- Secondary action: View overview
- Setup command hint when no live run exists

States:

- Loading API
- Live run found
- API unavailable with fixture fallback
- No runs found
- Fixture missing or invalid

Acceptance:

- A judge can immediately tell which project was scanned and whether data is live.
- Backend failure never produces a blank screen.

### 2. Overview screen

Purpose: let judges understand the business value in ten seconds.

Content:

- Drift score hero card from `report.summary.driftScore`
- Counts by severity from `report.summary.countsBySeverity`
- Counts by category from `report.summary.countsByCategory`
- Top affected routes derived from `issues`
- Token coverage snapshot from `report.tokens` counts where available
- Three highest-priority findings sorted by severity and confidence
- Short explanation of how DriftRadar classifies drift

States:

- Zero issues
- Mixed severities
- Fixture mode banner
- Missing token metadata fallback

Acceptance:

- Counts match `report.summary` exactly.
- Top findings link to the issue workbench with the issue selected.

### 3. Issue workbench screen

Purpose: triage and inspect every finding.

Content:

- Left issue list with severity, category, property, route, state, and confidence
- Filter controls for severity, category, property, route, state, and text search
- Sort controls for severity, confidence, route, category, and issue title
- Detail panel for selected issue
- Local review badges after Dev 5 handoff is mounted

States:

- No filter results
- Issue selected
- Issue filtered out, then first visible issue selected
- Missing screenshot asset
- Client-local status changed

Acceptance:

- Selecting an issue updates the detail panel.
- Filtering and sorting are deterministic.
- Keyboard selection works for issue rows.

### 4. Issue detail panel

Purpose: show taste and actionability.

Content:

- Issue title
- Category, severity, confidence, property, route, viewport, and state
- Deterministic reasoning from backend
- Screenshot preview with crop highlight when `evidence.cropBox` exists
- Observed value, expected value, nearest token, token distance, occurrence count, and selector hint when present
- Suggested fix:
  - Type
  - Human instruction
  - Before CSS snippet if present
  - After CSS snippet if present
- Related issue IDs when present
- Client-only actions after Dev 5 handoff:
  - Mark reviewed
  - Accept exception
  - Reset local state for issue
  - Copy fix

States:

- Token misuse
- New pattern candidate
- Accidental regression
- Acceptable exception
- Screenshot unavailable
- No suggested CSS snippet
- No nearest token

Acceptance:

- All four issue categories have readable detail views.
- Missing screenshot shows a designed placeholder, not just a broken image icon.
- Suggested fix is concrete when backend provided concrete snippets.

### 5. Export screen

Purpose: make the economic value concrete by producing PR-ready output.

Content:

- Markdown PR comment preview from backend export endpoint in live mode
- Fixture or client-generated fallback markdown in fixture mode
- Copy all button
- Download markdown button
- Summary by severity and category
- Command hint to rerun after fixes:
  - `pnpm demo:backend`
  - `pnpm demo:serve`

States:

- Export loaded from live backend
- Export endpoint unavailable, client fallback generated
- Copy success
- Copy failure
- No issues

Acceptance:

- Export works in both live API mode and fixture mode.
- Copied markdown contains concrete suggested fixes when report data includes them.

## Styling requirements

- Define dashboard tokens in `dashboard/src/styles/tokens.css` and use them everywhere.
- Use a restrained design-system feel: neutral surface, strong severity accents, clear spacing, readable monospace snippets.
- Use system UI fonts and system monospace only.
- Light mode is required. Dark mode is optional only after all required screens pass.
- Severity colors must not be the only signal; include labels, text prefixes, or icons.
- Keep layout responsive down to 390px width.
- Code snippets may scroll horizontally internally, but the page itself should not horizontally overflow.
- Do not use external icon libraries unless already installed for another required reason. Text labels are enough.

## Development steps

### F1. Frontend scaffold, fixture wiring, and API client — Owner: Dev 2

Status: Completed by Dev 2.

Files: `dashboard/package.json`, `dashboard/index.html`, `dashboard/vite.config.ts`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/api/**`, `dashboard/src/types/**`, `dashboard/src/layout/**`, `dashboard/public/fixtures/**`.

Tasks:

1. Create Vite React TypeScript app under `dashboard`.
2. Add scripts for `dev`, `build`, `test`, `format`, `lint`, and `smoke` placeholder.
3. Copy backend handoff fixture from `fixtures/golden/frontend-handoff-run/**` into `dashboard/public/fixtures/frontend-handoff-run/**`.
4. Define TypeScript interfaces for report, issue, summary, page, token metadata, evidence, and suggested fix based on the actual fixture.
5. Implement API client with three modes: live, fixture, disconnected.
6. Implement asset URL resolver for live API and fixture mode.
7. Implement export markdown fetcher that returns text and can fail cleanly.
8. Implement app shell with top navigation, connection badge, and screen routing.
9. Add colocated tests for API mode selection, fixture loading, asset URL resolution, and shell render.
10. Format code and commit after this feature.

Acceptance:

- `pnpm --dir dashboard dev` starts.
- App loads fixture report with no backend running.
- App loads live report when backend API is running.
- Asset URL resolver produces correct URLs for both live and fixture modes.

### F2. Run landing screen — Owner: Dev 2

Status: Completed by Dev 2.

Files: `dashboard/src/layout/**`, `dashboard/src/screens/RunLanding/**`.

Tasks:

1. Render project name, run ID, created time, schema version, drift score, and scan stats.
2. Add live, fixture, disconnected, and no-runs connection states.
3. Add clear setup instructions for no runs found or disconnected state.
4. Add navigation actions to Overview and Issues.
5. Add tests for live, fixture, no-runs, and disconnected states.
6. Format code and commit after this feature.

Acceptance:

- Judge can immediately tell which scan is being viewed.
- API failure does not blank the app.

### F3. Overview screen and summary cards — Owner: Dev 3

Files: `dashboard/src/screens/Overview/**`, `dashboard/src/components/ScoreCard/**`, `dashboard/src/components/SummaryBar/**`.

Tasks:

1. Build drift score hero card.
2. Build severity and category count cards.
3. Show top affected routes derived from issues.
4. Show top three findings sorted by severity and confidence.
5. Show token coverage snapshot from report token metadata where available.
6. Add zero-issue and missing-token-metadata states.
7. Add colocated tests under Dev 3-owned paths only.
8. Format code and commit after this feature.

Acceptance:

- Overview explains the scan result in under ten seconds.
- Counts match `report.summary` exactly.

### F4. Filters and query-state model — Owner: Dev 3

Files: `dashboard/src/components/Filters/**`, `dashboard/src/lib/filtering/**`.

Tasks:

1. Implement reusable filter controls for severity, category, property, route, state, and text search.
2. Store filter state in URL query params where practical.
3. Add sort options by severity, confidence, route, category, and title.
4. Provide pure utility functions in `dashboard/src/lib/filtering/**` for Dev 4 to consume.
5. Add tests for filter parsing, matching, sorting, and no-results behavior.
6. Format code and commit after this feature.

Acceptance:

- Filters are deterministic and shareable by URL.
- Issue screen can use filter utilities without duplicating logic.
- No filter utilities are created under Dev 4-owned paths.

### F5. Issue list and workbench layout — Owner: Dev 4

Status: Completed by Dev 4 in `hackathon/frontend/agent-4-20260703170208`.

Handoff notes:

- Dev 4 added a minimal dashboard scaffold because no Dev 2/3 frontend files were present in this worktree yet; Dev 2 can replace or extend `dashboard/src/api/**`, `dashboard/src/types/**`, app shell, and package config during integration.
- Dev 4 added `dashboard/src/lib/filtering/issues.ts` only to satisfy the required Dev 3 filter utility contract for the issue workbench. Dev 3 can own or revise it later without changing Dev 4 component imports.
- Issue rows expose an empty `[data-review-status-slot]` for Dev 5 review badges.

Files: `dashboard/src/screens/Issues/**`, `dashboard/src/components/IssueBadge/**`.

Tasks:

1. Build issue workbench with issue list and detail region.
2. Render issue list rows with severity, category, property, route, state, and confidence.
3. Integrate Dev 3 filter utilities from `dashboard/src/lib/filtering/**`.
4. Add keyboard selection for issue rows.
5. Add no-results state.
6. Add stable render seams for later Dev 5 review status and actions, but do not implement local storage here.
7. Add colocated tests under Dev 4-owned paths only.
8. Format code and commit after this feature.

Acceptance:

- Selecting an issue updates the detail panel.
- Filtering does not lose selection unless selected issue is filtered out; then first visible issue is selected.
- Review-state integration remains out of this step except for documented seams.

### F6. Issue detail, screenshot viewer, and snippets — Owner: Dev 4

Status: Completed by Dev 4 in `hackathon/frontend/agent-4-20260703170208`.

Handoff notes:

- Issue detail exposes an empty `[data-review-actions-slot]` for Dev 5 review actions and does not implement local review state.
- Dev 4 added `dashboard/src/styles/tokens.css` and `dashboard/src/test/setup.ts` as minimal shared scaffold so the owned components can render and test; Dev 6 can move or expand them during polish.

Files: `dashboard/src/components/ScreenshotViewer/**`, `dashboard/src/components/CodeSnippet/**`, `dashboard/src/screens/Issues/IssueDetail.tsx`.

Tasks:

1. Show reasoning, observed value, expected value, nearest token, confidence, and evidence metadata.
2. Render screenshot from live asset URL or fixture asset URL.
3. Draw crop highlight overlay when `evidence.cropBox` exists.
4. Show before and after CSS snippets when present.
5. Render human instruction from `suggestedFix.humanInstruction`.
6. Render related issues by ID when present.
7. Leave review actions to Dev 5. If adding a placeholder helps, expose a small render prop or empty container and document it in the handoff note.
8. Add colocated tests for screenshot missing state, crop overlay, and snippet rendering.
9. Format code and commit after this feature.

Acceptance:

- All four backend issue categories have readable detail views.
- Missing screenshot is handled gracefully.
- Issues without CSS snippets still show human suggested fix text.

### F7. Export screen and copy actions — Owner: Dev 5

Files: `dashboard/src/screens/Export/**`, `dashboard/src/components/CopyButton/**`.

Progress: complete in `dashboard/src/screens/Export/**` and `dashboard/src/components/CopyButton/**`. The implementation loads live or fixture export markdown, falls back to client-generated markdown, supports copy/download actions, and includes colocated tests.

Tasks:

1. Fetch PR comment markdown from backend export endpoint in live mode.
2. Load fixture export markdown if available in fixture mode.
3. Generate client-side fallback markdown from report if endpoint or fixture markdown fails.
4. Implement copy all button with success and failure states.
5. Implement download markdown action using a local blob.
6. Show summary by severity and category.
7. Add colocated tests under Dev 5-owned paths only.
8. Format code and commit after this feature.

Acceptance:

- Export screen works in live API mode and fixture mode.
- Fallback markdown includes issue title, severity, route, reasoning, and suggested fix when available.

### F8. Client-local review state and demo callouts — Owner: Dev 5

Files: `dashboard/src/state/**`, `dashboard/src/components/ReviewActions/**`, `dashboard/src/components/ReviewStatusBadge/**`, `dashboard/src/components/DemoCallout/**`.

Progress: complete in Dev 5-owned paths. Review state is stored in browser local storage by `runId` and `issueId`, review actions and status badges are reusable for Dev 4 mount points, demo callouts cover scan/classify/suggest/export, and colocated tests cover storage and component behavior.

Tasks:

1. Store issue review state in local storage by `runId` and `issueId`.
2. Support statuses: generated, reviewed, accepted_exception, hidden.
3. Build review action components: mark reviewed, accept exception, hide locally, reset issue state.
4. Build review status badge component.
5. Mount review components into issue detail and, if needed, issue rows only through explicit Dev 4 handoff. Do not create files under `dashboard/src/screens/Issues/**`.
6. Add demo callouts explaining scan, classify, suggest, and export.
7. Add unit tests for local storage helpers and component tests for review actions.
8. Format code and commit after this feature.

Acceptance:

- Refreshing the browser preserves local review state.
- Reset returns an issue to generated state.
- Backend report data is never mutated.
- Dev 5-owned review components stay in Dev 5-owned paths.

### F9. Frontend tests, accessibility, and responsive polish — Owner: Dev 6

Files: `dashboard/tests/**`, `dashboard/src/test/**`, `dashboard/src/styles/**`, `dashboard/README.md`.

Tasks:

1. Add cross-feature React Testing Library coverage under `dashboard/tests/**` for landing, overview, issue detail, filters, and export fallback where colocated tests are not enough.
2. Add shared test utilities under `dashboard/src/test/**`.
3. Verify accessible labels for nav, filters, buttons, review actions, screenshot viewer, and export preview. If feature-file edits are required, include owner handoff notes.
4. Verify keyboard navigation through issue list and copy actions.
5. Polish responsive layout for 1440x900 desktop and 390x844 mobile, preferably through `dashboard/src/styles/**`.
6. Document frontend run commands, fixture mode, live API mode, and troubleshooting in `dashboard/README.md`.
7. Format code and commit after this feature.

Acceptance:

- `pnpm --dir dashboard test` passes.
- Basic keyboard-only walkthrough is possible.
- Mobile width does not horizontally overflow except internal code snippet scroll areas.

### F10. Browser smoke checks and demo script — Owner: Dev 6

Files: `dashboard/tests/browser/**`, `dashboard/scripts/**`, root demo docs if needed.

Tasks:

1. Add Playwright browser smoke test that opens landing, overview, issue workbench, issue detail, and export.
2. Test fixture mode with no backend server running.
3. Test live API mode when backend is available on `http://localhost:4317`.
4. Add `pnpm demo:frontend` script or a documented equivalent command.
5. Create a short demo checklist:
   - Start sample app and backend scan.
   - Serve latest backend run.
   - Open dashboard.
   - Filter to token misuse.
   - Open a screenshot-backed issue.
   - Copy suggested fix.
   - Open export and copy PR comment.
   - Rerun after fixed sample route and show issue reduction if time allows.
6. Run full frontend verification before demo deadline.
7. Format code and commit after this feature.

Acceptance:

- Browser smoke passes on a fresh machine after backend handoff.
- Demo checklist can be followed in under five minutes.

Dev 6 progress:

- Added cross-feature contract tests in `dashboard/tests/**` and shared test helpers in `dashboard/src/test/**` against the backend handoff fixture.
- Added browser smoke coverage under `dashboard/tests/browser/**`; it runs when `DRIFTRADAR_DASHBOARD_URL` points at a running dashboard.
- Added responsive/accessibility CSS foundations in `dashboard/src/styles/**`.
- Added `dashboard/README.md`, `pnpm demo:frontend`, `pnpm smoke:frontend`, and a short demo checklist. The frontend demo command starts the dashboard dev server once the Dev 2 scaffold package is merged, and prints the checklist before that scaffold exists.

## Browser checks

Required before demo:

- Chromium latest via Playwright
- Desktop viewport 1440x900
- Mobile viewport 390x844
- Fixture mode with no backend server running
- Live mode with backend server at `http://localhost:4317`

Manual checks:

- Reload page on each screen.
- Disconnect backend and verify fixture or disconnected state.
- Open an issue with screenshot evidence and verify asset path resolves.
- Open an issue without screenshot evidence and verify placeholder.
- Change filters and reload URL.
- Copy suggested fix.
- Copy PR comment and paste into a text editor.
- Use keyboard Tab and Enter through the primary flow.

## Frontend done criteria

- Dashboard opens locally with no auth and no external services.
- Fixture mode works with only `pnpm --dir dashboard dev`.
- Live API mode works against `http://localhost:4317`.
- All required screens and major states are implemented.
- Issue detail clearly explains drift and suggested fix.
- Screenshots and missing screenshots both render cleanly.
- Export markdown is copyable and downloadable.
- Client-local review state is implemented through Dev 5-owned paths with any issue-screen mount covered by an explicit Dev 4 handoff.
- `pnpm --dir dashboard format && pnpm --dir dashboard test && pnpm --dir dashboard build` pass.
- Browser smoke passes for fixture mode and live mode when backend is running.
