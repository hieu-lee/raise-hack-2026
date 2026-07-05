# AI-Native Taste Gate

DriftRadar keeps deterministic capture, token parsing, and rule-based drift detection as the source of truth. When `ai.enabled` is true, Codex SDK powers codebase-aware setup and repo patch suggestions through the Codex harness. When `OPENAI_API_KEY` is also set, the OpenAI API adds screenshot-only vision findings before `report.json` is finalized.

## Configuration

```json
{
  "ai": {
    "enabled": true,
    "model": "gpt-5.4-mini",
    "reasoningEffort": "medium",
    "sourceRoots": ["sample-app", "dashboard/src"]
  }
}
```

- `enabled`: opt in to AI enrichment during `driftradar scan`
- `model`: defaults to `gpt-5.4-mini`
- `reasoningEffort`: `low` | `medium` | `high` (OpenAI API calls use `reasoning_effort`; Codex setup and code suggestions use `gpt-5.4-mini` with medium thinking)
- `sourceRoots`: directories searched for repo-aware CSS and markup patches

Legacy `ollama.enabled` still counts as OpenAI API enrichment enabled for backward compatibility, but Codex is the provider for codebase reading.

## Dynamic project setup

Run DriftRadar against a project folder without hand-writing `driftradar.config.json`:

```bash
pnpm exec tsx src/cli/index.ts scan --project /path/to/project
```

The CLI asks Codex SDK (`gpt-5.4-mini`, medium thinking, read-only sandbox) to read the folder with a `/goal` prompt and return a structured setup contract:

- whether the folder has a browser UI that can run locally
- a safe runtime contract: either static HTML/CSS/JS served by DriftRadar itself, or explicit `npm run`/`pnpm run`/`yarn run`/`bun run` commands
- a nested `runtime.workingDirectory` when the runnable UI lives below the repo root
- install commands for package-script projects
- local `baseUrl`
- routes to capture
- CSS or JSON token files
- UI source roots for repo-aware patches
- relevant test commands

If Codex reports that the project is backend-only, mobile-only, cloud-only, missing tokens, or otherwise not runnable on the local machine, DriftRadar exits with `DriftRadar cannot work with this project: ...`.

The contract is validated before anything runs:

- every returned file and source root must stay inside the project folder
- `baseUrl` must use a loopback host (`localhost`, `127.*`, or `::1`) with an explicit port; routes may be relative or same-origin absolute URLs
- package-script projects must have the selected package-manager binary available locally; when present, `packageManager` metadata, version constraints, and lockfiles must not conflict
- install/run commands must be simple package-manager commands, not shell chains or workspace filter commands
- token files must parse as DriftRadar design tokens; unrelated JSON/config/theme files are rejected or pruned when a valid token file remains
- sensitive project files such as credentialed package-manager config, git credentials, and symlinks escaping the project are rejected before Codex setup

Install commands are run with package-manager lifecycle scripts disabled and a scratch HOME/cache. Package-script UI commands currently require macOS `sandbox-exec`; DriftRadar rejects package-script scans on platforms where that runtime sandbox is unavailable. When the sandbox is available, UI commands may only bind to loopback hosts and cannot use the user's normal HOME or arbitrary outbound network during server startup. Static projects are served by DriftRadar's internal loopback-only file server.

### Setup Output Shape

Codex returns JSON shaped like this. This is an internal contract, but it is useful when debugging why a repo did or did not scan:

```json
{
  "canRun": true,
  "reason": "Vite dashboard with Tailwind tokens",
  "projectName": "Example Dashboard",
  "packageManager": "pnpm",
  "runtime": {
    "type": "package-script",
    "staticRoot": null,
    "workingDirectory": "apps/web"
  },
  "installCommand": "pnpm install",
  "runCommand": "pnpm run dev --host 127.0.0.1 --port 5173",
  "baseUrl": "http://127.0.0.1:5173",
  "routes": [{ "id": "home", "url": "/", "label": "Home" }],
  "tokenFiles": ["apps/web/src/index.css"],
  "sourceRoots": ["apps/web/src"],
  "testCommands": ["pnpm run build"],
  "notes": []
}
```

For static HTML projects, `runtime.type` is `"static-site"`, `packageManager` is `"static"`, `runtime.staticRoot` points at the served folder, `runtime.workingDirectory` is `null`, and `installCommand`/`runCommand` are `null`.

## Scan modes

`captureMode` controls how the deterministic step captures pages:

- `"demo"` (default) — the zero-setup sample-app fixture generator; matches golden fixtures used by tests
- `"real"` — actual Playwright capture, real token analysis (`ingestTokenFiles`), and the real drift classifier against `baseUrl`/`routes`/`tokenFiles`. Use this to scan a real product or third-party repo (see `docs/demo-real-repo.md`).

## Scan workflow

1. **Deterministic scan** — token validation, demo or real Playwright capture, rule-based issues
2. **Repo-aware fixes (always deterministic, Codex-refined when `ai.enabled`)** — map `selectorHint` values to files under `sourceRoots` and attach `sourceFile`, `cssBefore`/`cssAfter`, `tsxBefore`/`tsxAfter`; Codex SDK refines the patch text through the Codex harness
3. **Vision drift (AI)** — full screenshots are sent to the vision model to catch visual/content inconsistencies CSS rules miss (inconsistent casing, misaligned badges, uneven spacing rhythm). Known-issue context sent to the model is deduped by title and capped at 12 entries per route so a busy route doesn't crowd out room for genuinely new findings
4. **Report write** — enriched issues flow through `buildReport()` into `report.json`

If the API key is missing or `ai.enabled` is false, step 3 is skipped and the deterministic report is returned unchanged (repo fixes still run).

## Structured outputs

Every OpenAI API JSON call in the scan pipeline (vision drift) uses OpenAI's
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
(`response_format: { type: "json_schema", json_schema: { strict: true, schema } }`) instead of
freeform JSON mode. This guarantees the model's response matches the schema exactly — every field
present, enums constrained to valid values, `cropBox` either a complete `{x,y,width,height}` object
or `null` — so malformed model output can't crash the strict-schema report writer. Defensive
sanitizing (e.g. `sanitizeCropBox`) is kept as a second line of defense, not the primary guard.
Codex SDK calls use its `outputSchema` support with local structured JSON schemas.

## Issue contract extensions

`suggestedFix` now supports:

- `tsxBefore`, `tsxAfter` — markup patches from HTML/TSX/JSX sources
- `sourceFile` — repo path containing the patch

Issues may include `aiEnriched: true` when a screenshot finding or Codex patch was model-assisted.

## Dashboard copilot

Live API mode exposes:

`POST /api/runs/:runId/copilot`

```json
{
  "message": "Why is this token misuse?",
  "issueId": "issue-token-blue",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Response:

```json
{ "reply": "...", "model": "gpt-5.4-mini" }
```

The Issues workbench renders a Cursor-style copilot panel when connected to a live backend.

## Commands

```bash
export OPENAI_API_KEY=...
pnpm demo:backend   # scan with repo fixes + optional AI enrichment
pnpm demo:serve     # API + copilot
pnpm --dir dashboard dev
```

## Design principles

- Rules own **what** is wrong and the baseline reasoning; Codex owns code-aware setup and patch suggestions
- Structured JSON outputs are validated for categories, severities, and properties before merging into issues
- Deterministic `observedValue`, `expectedValue`, and token names are never invented by the model
- Offline demos still work with zero API usage
