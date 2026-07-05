# DriftRadar Dashboard

Local, no-auth dashboard for reviewing a DriftRadar scan report.

## Commands

- `pnpm demo:backend`: run the sample app scan and write `.driftradar/runs/<runId>/report.json`.
- `pnpm demo:serve`: serve the newest run on `http://localhost:4317`.
- `pnpm demo:frontend`: start `pnpm --dir dashboard dev` after the dashboard scaffold is present; before then it prints the demo checklist.
- `pnpm exec playwright test dashboard/tests/browser`: run browser smoke checks with `DRIFTRADAR_DASHBOARD_URL=http://localhost:<port>`.

## Modes

- Live API mode: start `pnpm demo:serve`; the dashboard loads `/api/health`, `/api/runs`, then the newest report. Copilot is available on the Issues screen.
- Fixture mode: stop the backend; the dashboard loads `public/fixtures/frontend-handoff-run/report.json` and shows a fixture banner.
- Disconnected mode: if both live API and fixture loading fail, show setup commands instead of a blank screen.

## AI Copilot

When connected to a live backend with `OPENAI_API_KEY` configured server-side:

1. Open **Issues** in the dashboard.
2. Select a finding — the copilot panel uses that issue as context.
3. Ask for classification rationale, patch suggestions, or PR comment drafts.

Set `ai.enabled: true` in `driftradar.config.json` before scanning to enrich reports with vision drift, ambiguous classification, and repo-aware TSX/CSS patches. See `docs/ai-workflow.md`.

## Demo Checklist

1. Run `pnpm demo:backend`.
2. Run `pnpm demo:serve`.
3. Run `pnpm --dir dashboard dev`.
4. Open the dashboard and confirm live or fixture mode is visible.
5. Filter to `token_misuse`.
6. Open a screenshot-backed issue and copy the suggested fix.
7. Open Export and copy the PR comment.
8. Optional: rerun against the fixed sample route and show fewer issues.

## Accessibility And Responsive Checks

- Primary navigation, filters, issue list, issue detail, screenshot evidence, review actions, and export preview need accessible names or landmarks.
- Keyboard users need to tab through the landing actions, filters, issue rows, review actions, copy fix, and export copy controls.
- Check 1440x900 and 390x844. The page should not horizontally overflow; code snippets may scroll internally.
- Severity colors must also include text labels.

## Troubleshooting

- No live data: run `pnpm demo:backend` once, then `pnpm demo:serve`.
- Fixture missing: copy `fixtures/golden/frontend-handoff-run/**` into `dashboard/public/fixtures/frontend-handoff-run/**` after the scaffold exists.
- Browser smoke skipped: set `DRIFTRADAR_DASHBOARD_URL` to the running Vite URL.
