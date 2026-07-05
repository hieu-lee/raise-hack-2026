# DriftRadar Handoff

## One-Line Pitch

DriftRadar is a local design-system taste gate: it scans a runnable UI, reads the project's real design tokens, captures screenshots and DOM styles, finds design drift, and turns findings into a local report with suggested fixes.

## Motivation

Design systems drift because teams ship one-off colors, spacing, radii, shadows, and component variants faster than humans can review every screen. The cost shows up as repeated design QA, inconsistent user experience, brand refresh pain, and slow frontend cleanup.

DriftRadar is meant to become the local PR/design QA check for that problem. It does not try to replace designers. It gives designers and engineers a shared, evidence-backed list of where the product no longer matches its own system, what looks like a token misuse, what might deserve promotion into the system, and what can probably be accepted.

## What The Product Does

- Runs as a local CLI with no auth requirement.
- Accepts either an explicit `driftradar.config.json` or an arbitrary project folder via `scan --project`.
- Uses Codex SDK with the Codex harness to inspect a project folder and decide whether it has a browser UI that can run locally.
- Rejects backend-only, mobile-only, cloud-only, unsafe, or untokenized projects with a clear `DriftRadar cannot work with this project: ...` message.
- Starts runnable UIs safely:
  - static HTML/CSS/JS projects are served by DriftRadar's internal loopback file server
  - package-script projects run through validated package-manager scripts inside the macOS `sandbox-exec` runtime sandbox
- Parses CSS custom-property tokens, Tailwind v4 `@theme` tokens, and W3C/flat JSON token files.
- Captures routes with Playwright across configured viewports and states.
- Classifies issues into `token_misuse`, `new_pattern_candidate`, `accidental_regression`, and `acceptable_exception`.
- Writes local JSON artifacts under `.driftradar/runs/<runId>`.
- Serves a local dashboard API and a React dashboard for browsing runs, reviewing evidence, and guarded local fix actions.
- Uses Codex harness for repo-aware code patch suggestions.
- Uses OpenAI API only for screenshot vision enrichment and live helper endpoints when `OPENAI_API_KEY` is configured.

## Current Architecture

- CLI entrypoint: `src/cli/index.ts`
- Main scan pipeline: `src/cli/scan-pipeline.ts`
- Dynamic project setup: `src/ai/project-setup.ts`
- Codex harness and repo patching: `src/ai/codex-harness.ts`, `src/ai/enrich-scan.ts`
- Sensitive-file preflight: `src/ai/sensitive-files.ts`
- Token ingestion: `src/tokens/ingest-tokens.ts`
- Capture and DOM sampling: `src/capture/**`
- Drift analysis/classification: `src/analyze/**`, `src/classify/**`, `src/metrics/**`
- Report writing/export/API: `src/report/**`, `src/storage/**`, `src/server/**`, `src/export/**`
- Dashboard app: `dashboard/**`
- Demo docs: `docs/demo-real-repo.md`
- AI workflow docs: `docs/ai-workflow.md`
- Tool/command reference: `docs/tools.md`

## What Is Done

- Core TypeScript CLI with `validate`, `scan`, and `serve`.
- Config validation through Zod.
- Demo and real capture modes.
- Playwright capture with screenshots, DOM samples, route metadata, and warnings.
- Token ingestion for CSS variables, Tailwind v4 `@theme`, dark-theme selectors, JSON tokens, typography, spacing, radii, colors, and shadows.
- Deterministic drift classifier and report builder.
- Local artifact storage under `.driftradar/runs/<runId>`.
- Local API for reports, issues, assets, PR-comment export, copilot, and mutation-token-protected fix/PR actions.
- React dashboard with fixture fallback and live API mode.
- Codex-backed `scan --project` dynamic setup for arbitrary folders.
- Structured Codex setup contract with runtime, working directory, install/run commands, local base URL, routes, token files, source roots, and suggested tests.
- Safety gates for non-local URLs, unsafe shell commands, package-manager mismatches, lockfile conflicts, invalid token files, credentialed config, and symlinks escaping the project.
- Codex-backed repo-aware patch suggestions.
- Optional screenshot vision enrichment via OpenAI API.
- Real-repo demo guide and big-repo gauntlet documentation.
- Broad unit coverage around project setup, sandbox command validation, package-manager handling, token ingestion, AI enrichment, and scan pipeline behavior.

## Known Constraints

- Package-script `scan --project` currently requires macOS `/usr/bin/sandbox-exec`. Static-site scans are not tied to that runtime sandbox.
- Large repos may be rejected by design if they lack DriftRadar-parseable token files, require private infrastructure, select incompatible package managers, or cannot expose a safe loopback UI.
- Screenshot AI is optional and depends on `OPENAI_API_KEY`.
- Codex setup and repo patching need Codex SDK auth through `CODEX_API_KEY` or `OPENAI_API_KEY`.
- Drift score can hit its floor quickly on large first-time scans; raw issue counts and category breakdown are more useful for the demo story.
- The dashboard is a hackathon-quality local workbench, not a multi-user product. Issue review state is client-local, and source mutations are guarded by a local mutation token from the API.

## What Is Left

### AI-Native Roadmap

1. Style evolution propagation from recent commits.
   - Goal: compare recent commits on `main`, `master`, or `prod` against the current branch, detect when a page moved to a new visual direction, infer the new style language from code diffs plus before/after screenshots, and suggest equivalent updates for older components. Example: if the landing page moves to liquid glass, DriftRadar should find remaining flat legacy cards, panels, and buttons and propose matching glass-style patches.
   - Verify: create a fixture repo where one page has been restyled and sibling pages still use the old style; run DriftRadar against the branch; the report should name the inferred style direction, list the stale components, and produce source-aware patches that make at least one stale component screenshot match the new style family.

2. DOM plus screenshot joint reasoning.
   - Goal: reason over computed styles, DOM semantics, token usage, and screenshots together. The model should catch cases where code technically uses tokens but the rendered result still feels wrong because elevation, radius, density, contrast, or hierarchy conflicts with the surrounding UI.
   - Verify: add a test page with a token-compliant but visually wrong card or button; deterministic-only checks should not be enough to classify it, but AI joint reasoning should produce an issue with both DOM evidence and screenshot evidence. A matched good component on the same page should not be flagged.

3. Cross-page style consistency agent.
   - Goal: inspect clusters of page screenshots and identify when one route feels visually out of family with the rest of the product. This should catch mixed-era UIs: one page modern/glassy, another dense admin, another legacy flat UI.
   - Verify: scan a fixture with three routes where two share a visual direction and one intentionally diverges; the report should produce a route-level consistency finding with screenshots for all three routes and a clear explanation of the mismatch.

4. Component family detection.
   - Goal: group visually similar UI elements across pages even when they come from different files or component names, then flag duplicate component families such as three card treatments, two primary button styles, or inconsistent empty states.
   - Verify: seed a fixture with card/button variants implemented in separate files; DriftRadar should cluster them into one component family, show the variants side by side, and recommend one shared token/component primitive.

5. Patch plans instead of one-off fixes.
   - Goal: when drift repeats across many elements, produce a migration plan rather than hundreds of isolated patches. The plan should say whether to add a token, update a primitive component, or touch call sites, then order the work.
   - Verify: run against a fixture with many repeated literal values; the report should include one grouped migration plan with affected files, suggested token/component change, representative call-site patches, and an expected issue-count reduction after applying the plan.

6. Visual style memory.
   - Goal: remember accepted exceptions and project-specific design preferences across runs so future scans become more project-native instead of generic. Accepted one-off marketing art should stay accepted; rejected legacy styling should keep being flagged.
   - Verify: mark an issue as accepted in one run, rescan the same project, and confirm the finding is either suppressed or downgraded with a stored rationale. Then change the same pattern on a different route and confirm DriftRadar still flags it when it no longer matches the accepted context.

7. AI demo narrator.
   - Goal: generate a short judge-facing story after each scan: what the project is, what DriftRadar found, why it matters economically, the best issue to open in the dashboard, and the safest fix to demo.
   - Verify: after a real scan, the run artifacts should include a demo script or summary markdown that references actual issue counts, route names, screenshots, and source files from that run. It must not contain generic claims that are not grounded in `report.json`.

### Hackathon-Critical Gaps

1. Inspectable Codex setup artifact.
   - Goal: save the structured Codex setup response and validation decisions for every `scan --project` run, including rejection reasons for unsupported repos. This makes the dynamic setup feature explainable on stage.
   - Verify: a successful run writes a setup artifact under the run directory with runtime, working directory, commands, routes, token files, source roots, and validation status. A rejected project writes or prints a comparable rejection artifact with the exact blocker.

2. Recorded big-repo gauntlet.
   - Goal: make the big-repo demo independent of live upstream changes by pinning repo SHAs, recording expected outcomes, and keeping terminal logs or small summarized artifacts.
   - Verify: one script or doc section can clone the pinned repos, run the gauntlet, and compare outcomes against expected `scans` or `safe rejections`. The demo should still work if upstream `main` changes after the hackathon.

3. Dashboard visual QA pass.
   - Goal: make the dashboard feel polished on the exact screens judges will see: overview, issue detail with screenshot evidence, source patch panel, guarded apply actions, export, and copilot.
   - Verify: Playwright smoke checks capture desktop and mobile screenshots for a live report and the committed fixture report; no text overlaps, empty panels, broken image placeholders, or offscreen controls are allowed.

4. Guided apply and PR workflow hardening.
   - Goal: make local source mutations feel trustworthy. Before applying fixes or preparing a PR, DriftRadar should check branch state, dirty files, target files, rollback path, and conflict risk.
   - Verify: tests cover clean tree, dirty tree, missing file, already-applied patch, conflicting patch, rollback, and PR-prep paths. In the dashboard, the user can see exactly what will change before the mutation token is used.

5. Cross-platform package-script runtime story.
   - Goal: remove or clearly bridge the macOS-only `sandbox-exec` limitation for package-script `scan --project` runs so more judges and teammates can reproduce the demo.
   - Verify: on a non-macOS environment, a package-script project either runs inside an equivalent sandbox or fails before setup with an actionable message that points to static-site scanning and macOS package-script support. Static-site scans should continue to pass cross-platform.

6. Better large-repo scoring.
   - Goal: make first scans of mature repos more useful than a floor-level drift score. Large codebases should get severity, confidence, route coverage, and pattern-grouping summaries that separate urgent issues from expected legacy noise.
   - Verify: scan TailAdmin or another pinned large repo and confirm the summary highlights top fix themes, route hotspots, grouped repeated patterns, and a non-trivial priority order instead of relying only on raw total issue count.

## Best Demo

Use TailAdmin as the happy path and the big-repo gauntlet as proof that DriftRadar is not hard-coded to the sample app.

1. Build DriftRadar.

   ```bash
   cd /Users/hieu.leduc/hackathons/driftradar-local-ai-taste-gate-for-design-systems
   pnpm install
   pnpm build
   pnpm exec playwright install chromium
   export CODEX_API_KEY=sk-...
   export OPENAI_API_KEY=sk-...
   ```

2. Clone and preinstall the target app.

   ```bash
   mkdir -p /tmp/driftradar-demo
   cd /tmp/driftradar-demo
   export TAILADMIN_DEMO_REV=21dc917cb6cb22b5f1d12e5af57359a849d19aa8
   git clone https://github.com/TailAdmin/free-react-tailwind-admin-dashboard.git tailadmin
   git -C tailadmin checkout "$TAILADMIN_DEMO_REV"
   cd tailadmin
   npm install --ignore-scripts
   ```

3. Run the zero-config scan from this repo.

   ```bash
   cd /Users/hieu.leduc/hackathons/driftradar-local-ai-taste-gate-for-design-systems
   pnpm exec tsx src/cli/index.ts scan --project /tmp/driftradar-demo/tailadmin
   ```

4. Narrate what happened:

   - Codex inspected an arbitrary repo with a `/goal` prompt.
   - DriftRadar validated the setup before running anything.
   - The app started locally on loopback.
   - Playwright captured real screens.
   - The deterministic engine compared real DOM styles to real Tailwind v4 tokens.
   - Codex added repo-aware patch suggestions.
   - Optional OpenAI vision added screenshot-only findings.

5. Serve the run and open the dashboard.

   Terminal A:

   ```bash
   cd /Users/hieu.leduc/hackathons/driftradar-local-ai-taste-gate-for-design-systems
   node dist/cli/index.js serve --run <runId> --output-dir /tmp/driftradar-demo/tailadmin/.driftradar --port 4317
   ```

   Terminal B:

   ```bash
   cd /Users/hieu.leduc/hackathons/driftradar-local-ai-taste-gate-for-design-systems
   pnpm --dir dashboard dev -- --port 4520
   ```

6. In the dashboard, show:

   - Overview: real project name, drift score, categories, severities.
   - Issues: filter by `new_pattern_candidate` or `token_misuse`.
   - Evidence: screenshot plus selector, observed value, nearest token, reasoning.
   - Suggested fix: source file, before/after CSS or TSX, and guarded `Apply fix` / `Apply all` / `Create PR` actions when project readiness allows it.
   - Copilot: ask "What are the top 2 things to fix first?" if `OPENAI_API_KEY` is configured.

7. Run the big-repo gauntlet from `docs/demo-real-repo.md`.

   The point is not that every famous repo scans. The point is that DriftRadar can inspect any folder and safely choose one of two outcomes:

   - full scan with report and source-aware fixes
   - clear rejection explaining why the project cannot be run locally or lacks parseable design tokens

## Commands To Know

```bash
pnpm test
pnpm build
pnpm exec prettier --check .
pnpm exec tsx src/cli/index.ts validate --config fixtures/config/valid.json
pnpm exec tsx src/cli/index.ts scan --project /path/to/project
pnpm demo:backend
pnpm demo:serve
pnpm --dir dashboard dev
```

## Where To Read Next

- `docs/demo-real-repo.md`: exact zero-config real-repo demo and big-repo gauntlet.
- `docs/ai-workflow.md`: Codex/OpenAI split, dynamic setup contract, and AI enrichment flow.
- `docs/tools.md`: command reference.
- `docs/backend-handoff.md`: backend artifact/API contract.
- `FRONTEND.md`: dashboard handoff and UI contract.
