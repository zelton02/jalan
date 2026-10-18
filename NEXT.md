# NEXT — where this project stands

A handoff note so a fresh session can continue without reading old chats. Update it when the state
changes, not when plans are made (plans belong in `BACKLOG.md`).

## Running services

| What | How | Notes |
| --- | --- | --- |
| GTFS refresh | cron `10 16 * * *` → `scripts/refresh.sh` | 16:10 UTC = 00:10 MYT; log `data/ingest.log` |
| Realtime collector | systemd `jalan-realtime` | 60s sampling → `data/realtime.db`, 60-day retention |
| API | `node ingest/api.mjs --at 17:00` → `127.0.0.1:8795` | `--at` pins the demo clock; drop it for live time |
| App preview | `npm run preview` → `:4173` | serves `dist/`, proxies `/api` to 8795 |

## What works

- 12 static feeds ingested (all Malaysia; `kota-bharu` and `kuala-terengganu` are empty upstream).
- `npm run door -- --at 08:00` → full door-to-door: walk 4 min → T453 → MRT KG31 → Pasar Seni →
  LRT → KL Sentral, **86 min**.
- `/api/plan` serves that same plan; the UI renders legs, expandable station lists, and a
  schedule-derived "current station" dot.
- `/api/plan` origin is **hardcoded** to Sungai Long; the router does not exist yet.

## Next task

Replace the hardcoded corridor with a **RAPTOR-lite** search over SQLite:

1. origin/destination as coordinates (geocode once, cache the result);
2. 0 transfers, then 1, then 2;
3. acceptance: Sungai Long → KL Sentral still returns 86 min and the same departures;
4. then try Sungai Long → Penang (KTMB ETS + local buses at each end).

Keep the response shape identical to the current `/api/plan` payload so the UI does not change.

## Known gaps

- **No rail realtime** (`rapid-rail-kl` returns 404) — positions are schedule-derived; never label
  them live.
- Walking time is straight-line × 1.3 ÷ 75 m/min; transfer walking is a guess (Pasar Seni likely
  understated).
- Cross-state routing not built — only data is loaded.
- Crowd-sourced line status is designed but not built (`BACKLOG.md` #4).

## Reading order for a new session

1. this file
2. `BACKLOG.md` (decisions waiting for a build slot)
3. `DATA.md` (feeds, limitations, realtime availability)
4. `AESTHETIC.md` (the design contract — do not drift)
