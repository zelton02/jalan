# jalan

A transit app for Malaysia — *how do I get from here to there, and what do I do next.*

Built as the first consumer of [`keystone`](https://github.com/zelton02/keystone), the design-system engine. The point of
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

## Data pipeline

The app runs on Malaysia's official GTFS feeds, not mock data.

```bash
npm run ingest                                  # download 3 feeds -> data/jalan.db
npm run next -- --stop KG31 --dir north         # next MRT at Bukit Dukung
npm run next -- --feed ktmb --stop Kajang --at 08:00
npm run next -- --stop KG31 --dir north --json  # machine-readable
npm run route -- --from 3.0417,101.8014 --to 3.1344,101.6863 --at 08:00
npm run route -- --from 3.0417,101.8014 --to 3.1344,101.6863 --date 2026-10-21 --at 07:00
npm run live -- --route U5900                     # live vehicles + inferred delay
npm run board -- --q UTAR                         # find stops
npm run board -- --stop "bus|1004189"             # next departures at a stop
```

The router (round-based RAPTOR over precomputed patterns) plans any A→B point. `npm run ingest`
rebuilds the `patterns` / `pattern_trips` tables in the same atomic swap as the raw GTFS tables.

See [`DATA.md`](./DATA.md) for sources, refresh cadence, and the known limitations
(frequency-based rail feed, no official delay feed, dirty fields).

## Run

Clone both repos side by side — the token/lint scripts expect `../keystone`:

```bash
git clone https://github.com/zelton02/keystone
git clone https://github.com/zelton02/jalan
cd jalan
npm install
npm run tokens   # regenerate src/styles/tokens.css from design/theme.json
npm run dev
npm run audit    # token drift check
npm run build
```

## Data

Routes, stops, and times come from the official `data.gov.my` GTFS feeds (see
[`DATA.md`](./DATA.md)). Line colours approximate the real Klang Valley lines but are not
official brand assets. Fares are not published in GTFS, so the app does not show them.
