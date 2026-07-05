# Demo: Run DriftRadar on a Real External Repo (with AI)

This is the "big demo" — running DriftRadar's real scan engine (not the sample-app fixture) against
a real, popular open-source repo, with Codex discovering the project setup for you. Follow this to
reproduce the demo end-to-end, or to point DriftRadar at a different repo for your own walkthrough.

Estimated time: ~10 minutes setup, ~4-5 minutes per full scan after dependencies are installed.

## What you'll show

1. Clone a real, popular Tailwind CSS admin dashboard (TailAdmin)
2. Run `scan --project` with no hand-written config; Codex SDK reads the repo and returns the
   runtime, route, token, source-root, and test-command contract
3. Scan it for real with DriftRadar's Playwright capture, token parser, drift classifier, Codex
   repo-aware patch suggestions, and optional screenshot vision enrichment
4. Run a "big repo gauntlet" against well-known repos and show that DriftRadar either scans them or
   rejects them clearly when they are not safe/runnable local UI projects
5. Apply one of DriftRadar's own suggested fixes to the real repo's source code
6. Re-scan and show the issue disappear — proving the tool doesn't just find drift, it helps fix it

## Prerequisites

- Node.js 20+ and pnpm (this repo)
- Node.js 18+ and npm/pnpm/yarn/bun as needed by the target repo
- macOS with `/usr/bin/sandbox-exec` for package-script `scan --project` demos. Static-site
  projects can still be scanned on other platforms because DriftRadar serves them internally.
- Codex SDK auth through `CODEX_API_KEY` or `OPENAI_API_KEY`, with access to `gpt-5.4-mini`
- Optional `OPENAI_API_KEY` for screenshot vision enrichment and dashboard helper endpoints
- Playwright browsers installed once: `pnpm exec playwright install chromium`

## Step 1 — Build DriftRadar

```bash
cd driftradar-local-ai-taste-gate-for-design-systems
pnpm install
pnpm build
export CODEX_API_KEY=sk-...      # or export OPENAI_API_KEY=sk-...
export OPENAI_API_KEY=sk-...     # optional but best for the full AI demo
```

You can run the CLI either via the compiled build (`node dist/cli/index.js ...`) or directly via
`pnpm exec tsx src/cli/index.ts ...` — both work identically for `scan --project` and
`captureMode: "real"` scans.

## Step 2 — Clone the target repo

We use a pinned [TailAdmin](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard)
revision, a public React and Tailwind CSS dashboard, because its design system is declared as real
CSS tokens in `src/index.css` via Tailwind v4's `@theme { ... }` block — exactly what DriftRadar's
token ingester is built to read. Other Tailwind/React repos are good candidates, but they still need
a runnable local UI, parseable tokens, and matching local package-manager tooling.

```bash
mkdir -p /tmp/driftradar-demo && cd /tmp/driftradar-demo
export TAILADMIN_DEMO_REV=21dc917cb6cb22b5f1d12e5af57359a849d19aa8
git clone https://github.com/TailAdmin/free-react-tailwind-admin-dashboard.git tailadmin
git -C tailadmin checkout "$TAILADMIN_DEMO_REV"
cd tailadmin
npm install --ignore-scripts
```

The explicit install is optional; `scan --project` can install when dependencies are missing. For a
stage demo, preinstalling removes the slowest variable.

## Step 3 — Run the zero-config project scan

Back in the DriftRadar repo:

```bash
pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/tailadmin
```

What happens:

1. Codex reads the TailAdmin repo with a `/goal` prompt and returns a structured setup plan
2. DriftRadar validates the plan: local URL, package manager, package-manager version/binary,
   lockfiles, token files, source roots, and safe commands
3. DriftRadar starts the UI on a loopback port inside its runtime sandbox
4. Playwright captures the Codex-selected routes
5. The deterministic drift engine analyzes TailAdmin's real `src/index.css` Tailwind v4 `@theme`
   tokens
6. Codex refines repo-aware patch suggestions; the OpenAI API adds screenshot-only vision findings
   when `OPENAI_API_KEY` is set

When it finishes you'll see:

```
Codex setup: <project name>
Run command: <safe local UI command>
AI enrichment applied: <total> issues (<ai-enriched> AI-enriched)
Report ready: /tmp/driftradar-demo/tailadmin/.driftradar/runs/real-<timestamp>-<id>/report.json
```

If you see `AI enrichment skipped: fetch failed` instead, that's a transient network hiccup talking
to OpenAI — the deterministic report is still written safely; just re-run `scan`.

If you see `DriftRadar cannot work with this project: ...`, that is also a good demo moment. It
means Codex, validation, or the runtime sandbox found a blocker and DriftRadar refused to run an
unsafe or non-runnable setup.

## Optional — Manual Config Fallback

If you want a fully controlled route list for a rehearsed recording, write an explicit config and
use `scan --config` instead. The dynamic setup path above is the main feature; this fallback is for
repeatability.

```bash
mkdir -p /tmp/driftradar-demo/config
cat > /tmp/driftradar-demo/config/driftradar.config.json << 'EOF'
{
  "projectName": "TailAdmin (manual config)",
  "baseUrl": "http://127.0.0.1:4501",
  "routes": [
    { "id": "dashboard-home", "url": "/", "label": "Dashboard Home" },
    { "id": "buttons", "url": "/buttons", "label": "UI: Buttons" },
    { "id": "alerts", "url": "/alerts", "label": "UI: Alerts" }
  ],
  "tokenFiles": ["/tmp/driftradar-demo/tailadmin/src/index.css"],
  "outputDir": "/tmp/driftradar-demo/tailadmin/.driftradar",
  "viewports": [{ "name": "desktop", "width": 1440, "height": 900 }],
  "states": ["default", "hover", "focus"],
  "captureMode": "real",
  "ai": {
    "enabled": true,
    "model": "gpt-5.4-mini",
    "reasoningEffort": "medium",
    "sourceRoots": ["/tmp/driftradar-demo/tailadmin/src"]
  }
}
EOF

cd /tmp/driftradar-demo/tailadmin
npm run dev -- --host 127.0.0.1 --port 4501 --strictPort
```

Then, in the DriftRadar repo:

```bash
pnpm exec tsx src/cli/index.ts validate --config /tmp/driftradar-demo/config/driftradar.config.json
pnpm exec tsx src/cli/index.ts scan --config /tmp/driftradar-demo/config/driftradar.config.json
```

## Step 4 — Run the Big Repo Gauntlet

Use this when you want the demo to feel bigger than one hand-picked app. The point is not that
every famous repo scans. The point is that DriftRadar can inspect any folder and then make a safe
call: scan it, or explain why it cannot work locally.

```bash
cd /tmp/driftradar-demo
export TAILADMIN_DEMO_REV=21dc917cb6cb22b5f1d12e5af57359a849d19aa8
git clone https://github.com/TailAdmin/free-react-tailwind-admin-dashboard.git tailadmin-gauntlet
git -C tailadmin-gauntlet checkout "$TAILADMIN_DEMO_REV"
git clone --depth 1 https://github.com/ant-design/ant-design.git ant-design
git clone --depth 1 https://github.com/mui/material-ui.git material-ui
git clone --depth 1 https://github.com/tailwindlabs/tailwindcss.com.git tailwindcss-com
```

Then run one candidate at a time from the DriftRadar repo:

```bash
pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/tailadmin-gauntlet
pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/ant-design
pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/material-ui
pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/tailwindcss-com
```

TailAdmin is pinned because it is the live success path. The other gauntlet repos intentionally use
current upstream HEADs; run them before presenting and keep the logs, because their exact rejection
or scan outcomes can change as those projects change.

Narrate the outcomes like this:

| Repo            | What it proves                             | Good demo outcome                                                                                                                 |
| --------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| TailAdmin       | Tokenized app with a conventional local UI | Full scan, screenshots, report, repo-aware fixes                                                                                  |
| Ant Design      | Large design-system monorepo               | Either a full docs scan or a clear rejection if the repo does not expose DriftRadar-parseable token files in a safe local runtime |
| Material UI     | Large component-library monorepo           | Clear handling of nested workspaces, package managers, and token-file validation                                                  |
| tailwindcss.com | Real public docs site                      | Clear package-manager/version checks and local-runtime validation before any server is launched                                   |

For a polished live demo, run the gauntlet before presenting and keep the terminal logs. On stage,
show TailAdmin live, then flash the big-repo logs to prove DriftRadar is not hard-coded to the
sample app.

## Step 5 — Look at the results

```bash
export RUN_ROOT=/tmp/driftradar-demo/tailadmin/.driftradar
node -e "
const r = require(process.env.RUN_ROOT + '/runs/<runId>/report.json');
console.log(JSON.stringify(r.summary, null, 2));
"
```

From an actual run against unmodified TailAdmin, the report looked like this:

```json
{
  "totalIssues": 280,
  "countsByCategory": {
    "token_misuse": 1,
    "new_pattern_candidate": 95,
    "accidental_regression": 2,
    "acceptable_exception": 182
  },
  "countsBySeverity": { "critical": 0, "high": 54, "medium": 8, "low": 218 },
  "driftScore": 0
}
```

- `new_pattern_candidate` (95) — repeated colors, heights, radii with no matching token
- `acceptable_exception` (182) — isolated, one-off, or context-justified deviations
- `token_misuse` / `accidental_regression` (3 combined) — deterministic classifier matches where
  TailAdmin's token files provide enough comparable values; projects with sparse spacing/radius
  tokens will usually skew toward `new_pattern_candidate`
- **0 critical**, and **driftScore 0** — with 280 raw findings the severity-weighted score hits its
  floor almost immediately; this is an honest characteristic of scanning a large, established
  codebase for the first time, not a scoring bug (see `src/report/report-builder.ts`'s
  `driftScore()` if you want to tune the severity weights for less noisy real-world repos)

208 of 280 issues (74%) had a `suggestedFix.sourceFile` populated — a real repo-aware patch
DriftRadar found in TailAdmin's own source and, for many, had the model refine into a concrete
before/after diff.

## Step 6 — Serve the dashboard and explore live

```bash
node dist/cli/index.js serve --run <runId> --output-dir /tmp/driftradar-demo/tailadmin/.driftradar --port 4317
```

In another terminal:

```bash
pnpm --dir dashboard dev -- --port 4520
```

Open `http://localhost:4520`. You should see the "Live API" badge. Walk through:

- **Overview** — real drift score and category/severity breakdown for TailAdmin
- **Issues** — filter to `new_pattern_candidate`, pick one, see the real captured screenshot as
  evidence, the deterministic rule reasoning, and (for ~70% of issues) a concrete before/after CSS
  or markup patch with the exact source file path
- **Copilot** (right panel, live mode only) — ask it something grounded in the real scan, e.g.
  _"What are the top 2 things to fix first?"_ — it answers using the actual counts from this run,
  not a canned response

## Step 7 — Apply a real AI-suggested fix and prove the improvement

Pick a `new_pattern_candidate` issue with a populated `sourceFile` — for example the repeated
`color: #000000` finding on `button.dropdown-toggle` (402 raw DOM occurrences in our run). Its
`suggestedFix` pointed at `src/components/ecommerce/DemographicCard.tsx`:

```tsx
// before
<button className="dropdown-toggle" onClick={toggleDropdown}>
  <MoreDotIcon className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 size-6" />
</button>

// after (AI-suggested — the icon's SVG already uses fill="currentColor", so moving the
// color/hover classes onto the semantic <button> keeps the exact same rendered look)
<button
  className="dropdown-toggle text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
  onClick={toggleDropdown}
>
  <MoreDotIcon className="size-6" />
</button>
```

The same copy-pasted pattern also existed in `MonthlyTarget.tsx` and `MonthlySalesChart.tsx` —
apply the same fix there. The dashboard should render identically because this is a pure
design-system hygiene fix, not a visual regression.

Re-run the scan:

```bash
pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/tailadmin
```

If you used the manual-config fallback, re-run the `scan --config` command instead.

In our run, applying this fix made the specific `button.dropdown-toggle` / `color: #000000`
finding (the one anchored on `DemographicCard.tsx`) disappear entirely — confirmed by diffing
issues between the before-patch and after-patch reports. The icon now inherits its color from the
button's token-driven Tailwind classes instead of carrying its own untracked literal, and the
dashboard renders pixel-identical (the SVG uses `fill="currentColor"`, so this is a pure hygiene
fix with zero visual regression).

Be honest with your teammate about scope here: `color: #000000` is a _repeated pattern_ finding —
DriftRadar sampled one representative element out of ~400 raw DOM observations sharing that value
across the whole app, and the next scan may re-anchor the same "Promote repeated color pattern"
issue on a different element (we saw it re-anchor on `AppHeader.tsx` after our fix). That's
expected: fixing 3 copy-pasted instances doesn't eliminate every occurrence of a codebase-wide
pattern, which is exactly the point of DriftRadar's "promote to a token" suggestion over patching
one call site at a time — the real fix is a shared `text-*` token applied consistently, not a
whack-a-mole per-component patch.

## Troubleshooting

| Symptom                                                           | Cause                                                                                                                                                     | Fix                                                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `validate` fails with `no tokens found`                           | Token file uses `@theme {}` (Tailwind v4) and you're on an older DriftRadar build                                                                         | `pnpm build` again — `@theme` support was added; older builds only read `:root {}`                                                |
| `validate` fails on `currentColor`/`transparent`                  | Those are CSS keywords, not literal tokens                                                                                                                | Already handled — DriftRadar skips CSS-wide keywords and Tailwind's `--font-*: initial` namespace resets automatically            |
| Real capture crashes with `ReferenceError: __name is not defined` | Stale build predating the `tsx`/esbuild fix in `dom-sampler.ts`                                                                                           | `pnpm build`; the fix strips esbuild's dev-mode bookkeeping calls before `page.evaluate`                                          |
| `AI enrichment skipped: fetch failed`                             | Transient network/API hiccup                                                                                                                              | Re-run `scan`; the deterministic report is never lost                                                                             |
| Vision drift finds 0 issues on a busy route                       | The model was told about a lot of already-known issues for that route and judged nothing else was novel — this is real model behavior, not silent failure | Expected on very "noisy" routes; known-issue context sent to the model is capped at 12 deduped titles per route to keep this rare |
| Copilot panel missing in the dashboard                            | You're in fixture mode, not live                                                                                                                          | Confirm `driftradar serve` is running and the dashboard shows the green "Live API" badge                                          |

## Why this demo matters

This isn't a canned fixture walkthrough — every number in this guide came from actually running
DriftRadar against unmodified, real-world source code, hitting (and fixing) real bugs along the
way: a dev-mode Playwright crash, three token-parser gaps (Tailwind v4 `@theme` syntax, CSS
keywords, multi-layer shadows), a report-builder bug that silently discarded AI repo-fix evidence,
and a vision-model crash from an unvalidated `cropBox` shape (now closed at the source with OpenAI
Structured Outputs). What's left is a tool that finds real, actionable drift in a real codebase and
gives you a working patch, not just a lecture.
