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
  With no params it plans the Sungai Long residence → KL Sentral. `at=YYYY-MM-DDTHH:MM` plans a
  date (service-day aware: a 01:00 trip belongs to the previous service day).
- The search screen has a BILA / WHEN picker; the results header then reads
  “Berlepas Sel, 20 Okt · 07:00”. A date outside a core feed's calendar shows a warning instead of
  silently planning a degraded route.
- `npm run route -- --from ... --to ... --date 2026-10-21 --at 07:00`
- Live bus status: `ingest/live.mjs` infers each vehicle's run from the pattern's frequency
  windows (RT `trip_id` is often a stale template), and `/api/live?route=U5900` returns the
  vehicles + median delay. Ride legs in `/api/plan(s)` carry `live: {vehicles, delay_min, feed}`.
  Ambiguous matches are dropped, not guessed.
- The Journey screen shows “LIVE LEWAT 3 MIN · 2 BAS” with a footnote saying it is a route
  estimate, not this trip.
- Departure board: `/api/stops?q=` searches the stop index (exact token beats a token prefix, so
  “UTAR” beats “CYBERJAYA UTARA”); `/api/departures?stop=bus|1004189` expands every frequency
  window into actual runs, drops patterns where the stop is the terminus, and shows route,
  destination, countdown and scheduled time. The “Jadual hentian” screen polls every 30 s.
- History: `/api/punctuality?route=U5900` returns median delay per hour (p25/p75 and the bucket
  count) from the collected positions. The Journey screen shows “BIASA +1′ · 15 SAMPEL” under the
  leg when the hour has at least 8 buckets; the footnote states how many days of history exist.
  As of 2026-10-19 that is **1 day** — treat it as a pipeline that improves, not a verdict.
- The Journey screen has a map: GTFS shapes for each ride leg (sliced between boarding and
  alighting, loop-safe), OSRM footpaths for walks, live vehicle dots, and tap-a-step to zoom.
  Results cards carry a compact preview map.
- Search is type-ahead: stops from the local index appear instantly, place suggestions (Google
  Places when keyed, Nominatim otherwise) slide in under them, and picking a result fills the
  field with coordinates (so "Bandar Utama" is the station, not the suburb). Keyboard: ↑/↓ +
  Enter, Esc closes.
- Production is `https://zhng.tech` (Caddy + Let's Encrypt behind Cloudflare). The search screen has
  a star on each field: it saves the current value as Rumah / Kerja in localStorage, chips fill
  them back, and the last five successful searches appear under BARU-BARU / RECENT.
- Realism pass (2026-10-19): OSRM foot walking for the first/last mile, station access times for
  big interchanges, mode-aware transfer penalties, and a 90 s boarding buffer. Same five routes vs
  Google at 17:00: Mid Valley 23 vs 31, 1 Utama 43 vs 52, Bukit Dukung→KLCC 64 vs 66,
  Home→KLCC 66 vs 73. Home→KL Sentral is still 58 vs Google's best 78 (we take 590 + 750, Google
  prefers T453 + KGL).
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

1. **History depth**: only one day is collected so far; the hourly median becomes meaningful at
   ~2 weeks. Meanwhile add a day-of-week split and surface p25/p75 as “biasa 1–7 min”, not a
   single number.
2. **Cross-state connection quality**: the ETS reaches Bukit Mertajam 11:57 and CT14 leaves 16:54.
   Check whether Butterworth + ferry is better, or whether the Penang feed simply lacks trips.
3. **Calibrate the realism table**: the station walk minutes were set from one comparison, not
   from measurements. Log a few real trips and adjust the big interchanges; add stations as they
   show up in failed comparisons.

## Known gaps

- Walking is straight-line × 1.3 ÷ 75 m/min: no street network, no station egress time. A final
  walk under 30 s is folded into the arrival instead of shown.
- Corridor prune: stops farther than `max(8 km, 35% × direct distance)` from the straight line are
  never expanded. A legitimate wide detour can be hidden by this.
- Frequency trips use the pattern's template offsets; a per-trip offset difference of a minute is
  not modelled.
- `kota-bharu` and `kuala-terengganu` are empty upstream.
- Fares are absent from GTFS; do not promise them.
- Alternatives are up to 3, found by banning the previous itinerary's first pattern. That is a
  heuristic, not k-shortest: a genuinely different second-best route that starts on the same first
  vehicle is invisible.
- Calendar coverage is uneven: KTMB ends 2026-11-02, mrtfeeder 2026-11-15, rail 2026-12-31, bus
  2027-03-31. Planning New Year or CNY 2027 works only partially and says so in a warning; it is
  not a booking-grade answer.
- No rail realtime — positions are schedule-derived and must never be labelled live.

## Reading order for a new session

1. this file
2. `BACKLOG.md` (decisions waiting for a build slot)
3. `DATA.md` (feeds, limitations, realtime availability)
4. `AESTHETIC.md` (the design contract — do not drift)
