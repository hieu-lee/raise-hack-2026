# DriftRadar report for DriftRadar sample app

Total issues: 4

- **high** Primary button uses a near-token blue literal: Replace the literal button background with var(--color-primary-600).
- **medium** Repeated 44px pill radius is untokenized: Promote the repeated 44px radius into a named token or replace it with --radius-card.
- **critical** Focus ring regressed from the system color: Use the shared focus-ring token for keyboard focus states.
- **low** Dark preview surface intentionally diverges for contrast: Keep the exception documented; promote it only if this surface spreads.
