# NEXT — where this project stands

A handoff note so a fresh session can continue without reading old chats. Update it when the state
changes, not when plans are made (plans belong in `BACKLOG.md`).

## Running services

| What | How | Notes |
| --- | --- | --- |
| GTFS refresh | cron `10 16 * * *` → `scripts/refresh.sh` | 16:10 UTC = 00:10 MYT; rebuilds the pattern tables before the atomic rename |
| Realtime collector | systemd `jalan-realtime` | 60s sampling → `data/realtime.db`, 60-day retention |
| API | `node ingest/api.mjs` → `127.0.0.1:8795` | `--at` pins the demo clock; drop it for live time |
| App preview | `npm run preview` → `:4173` | serves `dist/`, proxies `/api` to 8795 |

## What works

- 12 static feeds: 764,502 stop_times, 19,205 trips → **645 patterns** (23,217 pattern-stop rows).
- The router scans patterns in memory instead of querying SQLite per stop: **~45 ms median per
  plan** (was 2–3 s). The first request after boot is ~90 ms because the API warms the JIT.
- `npm run route -- --from 3.0417,101.8014 --to 3.1344,101.6863 --at 08:00 --rounds 3`
- `/api/plan?from=&to=&at=&rounds=` accepts an address (Nominatim, cached, 1 req/s) or `lat,lon`.
  With no params it plans the Sungai Long residence → KL Sentral.
- The UI searches any Malaysian address; the corridor gate is gone.
- `/api/plans` returns up to 3 itineraries, each forced to start on a different first vehicle;
  the results screen lists them with Tercepat / Alternatif tags.
- “Use my location” fills the origin with `lat,lon` and labels it “Lokasi saya”.
- The same route split across two trips at a terminal is shown as one leg with
  “Sambung di … · tunggu N min” instead of two board steps.
- 08:00 home → KL Sentral: **57 min** via 590 + LRT (beats the old MRT corridor).
- Bukit Dukung MRT → KL Sentral: **53 min**, reproducing the old corridor exactly
  (KGL 08:03→08:45, KJL 08:50→08:53).
- Cross-state works: Sungai Long → George Town, 641 min, 4 vehicles (ETS via Bukit Mertajam).

## Next task

Pick one:

1. **Cross-state connection quality**: the ETS reaches Bukit Mertajam 11:57 and CT14 leaves 16:54.
   Check whether Butterworth + ferry is better, or whether the Penang feed simply lacks trips.
2. **Realtime**: bus vehicle positions exist; rail returns 404. Keep positions schedule-derived
   until a feed is verified.
3. **Saved places**: the “recent” list on the search screen is static copy. Wire it to
   localStorage and add a home chip.

## Known gaps

- Walking is straight-line × 1.3 ÷ 75 m/min: no street network, no station egress time. A final
  walk under 30 s is folded into the arrival instead of shown.
- One itinerary only. RAPTOR keeps the best label per stop and discards the rest.
- Corridor prune: stops farther than `max(8 km, 35% × direct distance)` from the straight line are
  never expanded. A legitimate wide detour can be hidden by this.
- Frequency trips use the pattern's template offsets; a per-trip offset difference of a minute is
  not modelled.
- `kota-bharu` and `kuala-terengganu` are empty upstream.
- Fares are absent from GTFS; do not promise them.
- No rail realtime — positions are schedule-derived and must never be labelled live.

## Reading order for a new session

1. this file
2. `BACKLOG.md` (decisions waiting for a build slot)
3. `DATA.md` (feeds, limitations, realtime availability)
4. `AESTHETIC.md` (the design contract — do not drift)
