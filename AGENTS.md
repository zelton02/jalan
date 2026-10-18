# AGENTS.md

Read `AESTHETIC.md` before writing any UI. If a rule and the code disagree, fix whichever is
wrong — do not fork a one-off at the call site.

- Tokens live in `design/theme.json`; `src/styles/tokens.css` is generated. Never edit it.
- `npm run audit` must pass before a change is done.
- New primitives need a proposal in `AESTHETIC.md`; inline forks are not allowed.
