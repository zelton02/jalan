# jalan

A transit app for Malaysia — *how do I get from here to there, and what do I do next.*

Built as the first consumer of [`sistem`](https://github.com/zelton02/sistem), the design-system engine. The point of
this repo is not the feature set; it is proving that a written aesthetic contract survives
contact with a real screen.

## The stance

> **Signage, not a brochure.**

A transit app is read standing up, in the sun, in the rain, with one hand, while a bus is
arriving. It should behave like a good signboard: high contrast, pictogram-first, bilingual,
legible at a glance — not like a travel magazine.

That stance produces the rules in [`AESTHETIC.md`](./AESTHETIC.md). Read it before touching UI.

## Screens

| Search | Results | Journey |
| --- | --- | --- |
| ![](pr-assets/screen-search.png) | ![](pr-assets/screen-results.png) | ![](pr-assets/screen-journey.png) |

## Run

Clone both repos side by side — the token/lint scripts expect `../sistem`:

```bash
git clone https://github.com/zelton02/sistem
git clone https://github.com/zelton02/jalan
cd jalan
npm install
npm run tokens   # regenerate src/styles/tokens.css from design/theme.json
npm run dev
npm run audit    # token drift check
npm run build
```

## Data

All routes, times, fares and line colours are **sample data**. Line colours approximate the
real Klang Valley lines but are not official brand assets.
