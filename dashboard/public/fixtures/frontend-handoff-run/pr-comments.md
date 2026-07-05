# DriftRadar report for DriftRadar sample app

Run: `frontend-handoff-run`
Drift risk: 56/100
Total issues: 4

## Review packet outcome

- Paste this into the PR to replace the design QA sync.
- Each finding includes severity, route, source hint, screenshot evidence, observed value, expected value, confidence, and suggested fix.
- Deterministic scan evidence is listed separately from reviewer-facing rationale.

## Focus ring regressed from the system color

- Severity: critical
- Category: accidental_regression
- Route: forms
- State: focus
- Confidence: 92%
- Source hint: `.primary-action:focus`
- Observed: `#ff4d4f`
- Expected: `var(--color-focus-ring)`
- Screenshot: `screenshots/forms/desktop/focus.png`
- Token distance: 12.4
- Reviewer rationale: The focus state is isolated and conflicts with the system focus token, so it is likely an accidental interaction regression.
- Suggested fix: Use the shared focus-ring token for keyboard focus states.
- Before: `outline-color: #ff4d4f;`
- After: `outline-color: var(--color-focus-ring);`

## Primary button uses a near-token blue literal

- Severity: high
- Category: token_misuse
- Route: buttons
- State: default
- Confidence: 90%
- Source hint: `.primary-action`
- Observed: `#1f6fe5`
- Expected: `var(--color-primary-600)`
- Screenshot: `screenshots/buttons/desktop/default.png`
- Token distance: 1.8
- Reviewer rationale: The button color is perceptually close to the primary token but uses a literal value, which makes brand refreshes harder to apply consistently.
- Suggested fix: Replace the literal button background with var(--color-primary-600).
- Before: `background: #1f6fe5;`
- After: `background: var(--color-primary-600);`

## Repeated 44px pill radius is untokenized

- Severity: medium
- Category: new_pattern_candidate
- Route: cards
- State: default
- Confidence: 86%
- Source hint: `.card`
- Observed: `44px`
- Expected: `promote compact pill radius token`
- Screenshot: `screenshots/cards/desktop/default.png`
- Reviewer rationale: The same off-token radius appears repeatedly, so it is probably a pattern to reconcile rather than a one-off typo.
- Suggested fix: Promote the repeated 44px radius into a named token or replace it with --radius-card.
- Before: `border-radius: 44px;`

## Dark preview surface intentionally diverges for contrast

- Severity: low
- Category: acceptable_exception
- Route: dark
- State: dark
- Confidence: 74%
- Source hint: `.dark-preview`
- Observed: `#0f172a`
- Expected: `#0f172a`
- Screenshot: `screenshots/dark/desktop/dark.png`
- Reviewer rationale: The dark preview panel is documented as a contrast exception and does not repeat across unrelated surfaces.
- Suggested fix: Keep the exception documented; promote it only if this surface spreads.
