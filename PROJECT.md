# DriftRadar: Local AI Taste Gate for Design Systems

Directory name: driftradar-local-ai-taste-gate-for-design-systems
Deadline: 2026-07-05T19:00:00+02:00
Backend deadline: 2026-07-05T00:44:11.455668+02:00

## Selected Idea

## Idea 3: DriftRadar: Local AI Taste Gate for Design Systems

Build a no-auth CLI plus small dashboard that scans a product or Storybook with Playwright, extracts CSS variables/design tokens, captures component screenshots across states, and detects where the UI has drifted from the design system. It clusters similar-but-not-identical colors, spacing, radii, typography, shadows, and interaction states, then labels each issue as likely token misuse, new pattern needing promotion, accidental regression, or acceptable exception. For each finding it explains the reasoning and suggests a concrete fix such as “replace #1E64D8 with var(--color-primary-600)” or “promote this repeated 44px pill button variant into Button/compact.”

- Business/economic value: High economic value because design-system drift creates repeated designer review cycles, frontend rework, inconsistent UX, and slower brand refreshes. DriftRadar can become a PR/design QA gate: before merge, teams get an actionable report of off-token styling and inconsistent interaction behavior without scheduling a design sync. The buyer story is clear for product teams with large component libraries: reduce design debt, shorten QA, make migrations measurable, and prevent one-off components from silently becoming the product’s real design system.
- External tools/API keys: Use only local/open-source tooling for the deterministic core: Node.js CLI, Playwright, PostCSS, culori, pixelmatch, JSON storage. Codex SDK (`gpt-5.4-mini`, medium thinking, Codex harness) reads arbitrary project folders for `scan --project`, decides whether a local browser UI can run, returns a structured runtime plan, and refines repo-aware TSX/CSS patch suggestions. Optional OpenAI API enrichment, enabled by `OPENAI_API_KEY`, stays focused on screenshot vision drift and live dashboard helper endpoints. Without the key, the product still runs with deterministic findings plus Codex-backed code setup/patching when the Codex harness is available.
- Prototype scope: Five parallel Codex agents can build it quickly: Agent 1 builds the CLI scanner that accepts token JSON/CSS and a list of URLs or Storybook stories; Agent 2 builds the Playwright screenshot/state capture layer for hover, focus, disabled, dark mode, and viewport variants; Agent 3 builds the drift engine for colors, typography, spacing, radii, shadows, and repeated untokenized patterns; Agent 4 builds the reconciliation suggester that maps drift to token replacements or component promotion proposals; Agent 5 builds the local dashboard/report with issue severity, screenshots, before/after CSS snippets, and exportable PR comments. Hackathon demo scope: run on a small sample app with intentional drift, show a ranked report, click an issue, see the reasoning and suggested patch, then regenerate the report after applying the fix.

## Topic

Static design tokens and component libraries are brittle contracts: the moment a brand evolves, a new team ships a component, or an interaction grows past its fortieth branching state, the system quietly fractures. Build an AI-native design system that reasons about consistency across a product's visual and interactive surface — detecting drift, proposing reconciliation, and keeping designers and engineers aligned without a synchronization meeting. The question isn't whether the model can read your tokens or trace a state graph; it's whether the system has enough taste to know when something is wrong.

Example projects:
- A CLI that diffs your Figma token file against your deployed CSS and surfaces semantic mismatches with proposed fixes.
- A visual regression tool that classifies diffs as intentional redesigns, accidental regressions, or platform-imposed constraints — explaining its reasoning and drafting a fix for anything flagged as a regression.
- A chat interface where a designer describes an intent and the system shows which existing tokens and components satisfy it versus which ones conflict.
