# jalan Aesthetic Contract

> Read this before writing any UI. If a rule and the code disagree, fix whichever is wrong —
> do not fork a one-off at the call site.

## Stance

> **Signage, not a brochure.**

A transit app is read standing up, in the sun, in the rain, one-handed, while a bus is
arriving. It should behave like a good signboard.

Because of that, this product will never: illustrate · decorate · perform.

## Aphorisms

- Signage is better than storytelling
- One next step is better than a full plan
- Legible in sunlight is better than beautiful on Dribbble
- Icon + number is better than a sentence
- Offline is a state, not an error
- Grey is better than colour — until colour means something
- Fewer taps is better than fewer pixels

## Anti-rules

- Never looks like a travel or tourism app: no destination photography, no postcard framing.
- Never looks like an analytics dashboard: no stacked stat cards, no charts.
- Never uses a "Malaysia theme pack": no batik patterns, palm leaves, tropical gradients, flag stripes.
- Never uses glassmorphism, large soft shadows, or pill-shaped everything.

## The one extreme

**Only the next action may carry colour.**

Every screen has exactly one thing the user must do next. That thing — and nothing else — gets
`--color-action`. Everything else is ink, paper and hairlines.

If two things compete for colour, the screen is wrong, not the rule.

## Exceptions (explicit, narrow)

- **Transit line colour is data, not decoration.** It may appear only inside `LineBadge` and the
  route strip. Never as a background, heading colour, border, or button fill.
- **Disruption amber and failure red** are status, not accent. They appear only in `Alert` and
  only when the state is genuinely abnormal.

## Tokens

All values in `design/theme.json`; generated into `src/styles/tokens.css`.

- colour: `--color-ink`, `--color-ink-muted`, `--color-paper`, `--color-surface`,
  `--color-hairline`, `--color-action`, `--color-alert`, `--color-danger`
- space: `--space-1 … --space-16` (4px step)
- radius: `--radius-none|sm|md|lg|pill` (signage is square by default)
- type: `--type-size-xs … --type-size-2xl`, `--type-tracking-label`
- motion: `--motion-fast` (100ms), `--motion-base` (160ms)
- layout: `--layout-max-width`, `--layout-inset`, `--layout-tap-min`
- line: `--line-kajang`, `--line-kelana`, `--line-ampang`, `--line-ktm`, `--line-bus`

## Decision rules

- Mutually exclusive, ≤5 options → segmented row, not a select.
- More than 5 options → a full-screen list, not a dropdown.
- Confirmation → the single `ConfirmDialog` pattern; never `window.confirm`.
- Empty → `EmptyState` with one action, never a blank screen.
- Loading → skeleton rows with the same height as the real row; never a spinner-only page.
- Error → `Alert` inline above the affected content; never a modal.
- Time → tabular numerals, never proportional.

## Core primitives — when to use / when not to use

- `Button` — use for the single forward action; do not use for navigation back (use the header).
- `Field` — use for free text; do not use for choosing from a list.
- `LineBadge` — use wherever a line must be identified; do not use it as decoration or as a tag.
- `RouteRow` — use on the results screen only; do not reuse it inside the journey.
- `StepRow` — use for a single leg of a journey; do not nest steps.
- `Alert` — use for disruption/offline; do not use for success or promotion.

## Change protocol

1. Check existing primitives first.
2. If genuinely missing: propose, then change the primitive/token once.
3. Update this file in the same change.
4. Migrate call sites and delete the old path.
