# Data

Everything here is **static schedule data** from Malaysia's official open-data portal.
No scraping, no third-party APIs.

## Sources

| Feed | key | Region | Notes |
| --- | --- | --- | --- |
| Rapid Rail KL | `rail` | Klang Valley | LRT / MRT / Monorail / BRT |
| Rapid Bus KL | `bus` | Klang Valley | City buses |
| Rapid Bus MRT Feeder | `mrtfeeder` | Klang Valley | Feeder buses to MRT stations (e.g. T453) |
| Rapid Bus Penang | `penang` | Pulau Pinang | City buses |
| BAS.MY Kangar | `kangar` | Perlis | Stage buses |
| BAS.MY Alor Setar | `alor-setar` | Kedah | Stage buses |
| BAS.MY Kota Bharu | `kota-bharu` | Kelantan | **published empty** (headers only) |
| BAS.MY Kuala Terengganu | `kuala-terengganu` | Terengganu | **published empty** (headers only) |
| BAS.MY Ipoh | `ipoh` | Perak | Stage buses |
| BAS.MY Melaka | `melaka` | Melaka | Stage buses |
| BAS.MY Johor Bahru | `johor` | Johor | Stage buses |
| BAS.MY Kuching | `kuching` | Sarawak | Stage buses |
| KTMB | `ktmb` | National | Komuter / ETS |
| Vehicle positions (RT) | — | — | every 30s, **positions only** |

Endpoints follow `https://api.data.gov.my/gtfs-static/<path>`: Prasarana uses
`prasarana?category=rapid-rail-kl|rapid-bus-kl|rapid-bus-mrtfeeder|rapid-bus-penang`, BAS.MY uses
`mybas-<city>`, KTMB uses `ktmb`. `rapid-bus-kuantan` is gone (404).

Two feeds publish only headers: `mybas-kota-bharu` and `mybas-kuala-terengganu` return a valid zip whose
`stops.txt` / `trips.txt` / `stop_times.txt` contain no rows. They are ingested as empty rather than
treated as errors, so the gap shows up in the counts instead of crashing the refresh.

## Known limitations

1. **The rail feed is frequency-based, not a full timetable.** Each route carries one
   template trip per service pattern (MonFri / Sat / Sun) per direction, and
   `frequencies.txt` describes headways by time band. `ingest/next.mjs` expands them;
   do not assume `stop_times.txt` lists every train.
2. **Realtime has no trip updates or service alerts** (official: "in the pipeline for 2026").
   Delays must be inferred from vehicle positions, and must be labelled as estimates.
3. **Data quality is imperfect.** `stops.txt` contains literal `[object Object]` in some
   optional fields, and ~2% of `rapid-bus-kl` trips are removed from `stop_times.txt` by the
   publisher due to accuracy issues. Parsers must tolerate both.
4. **Fares are not in GTFS.** No fare_attributes.txt / fare_rules.txt in the rail feed.
5. **Timezone**: `Asia/Kuala_Lumpur`. Service days roll over around 04:00 local, and times
   can exceed 24:00:00.
6. **Stop names repeat across states.** 96 names exist in more than one feed (`HOSPITAL`,
   `TERMINAL`, …). Any stop lookup must either filter by `feed` or refuse to guess — `next.mjs`
   lists candidates and exits when a name spans feeds.

## Licence

Data is published by the Government of Malaysia under the Open Data Terms of Use 1.0.
Prasarana feeds are CC BY 4.0. Attribute "Data source: data.gov.my / Prasarana / KTMB"
in any public build.

## Refresh

`scripts/refresh.sh` rebuilds the database from every feed in `ingest/feeds.mjs` and swaps it in atomically:

- the new DB is built in `data/jalan.db.tmp`, then `rename()`d over `data/jalan.db` — a reader sees
  either the old complete file or the new complete file, never a half-built one;
- stale `-wal` / `-shm` sidecars from the previous file are removed after the swap;
- `ingest/api.mjs` checks the file mtime on every request and reopens when it changes, so a refresh
  needs no restart;
- cron runs the script daily at **16:10 UTC = 00:10 MYT** (KTMB publishes 00:01 MYT);
- output is appended to `data/ingest.log`.

Manual run:

```bash
scripts/refresh.sh          # same path cron uses
npm run ingest -- --force   # equivalent, without the log wrapper
```

### Stop-name cleaning

`stops.txt` carries rename artefacts such as `KL SENTRAL - REDONE`. Query results strip a trailing
` - REDONE` before display. Names are otherwise kept in the feed's uppercase form — they read like
platform signage, and title-casing mangles acronyms like `KL`.

### Realtime availability (verified 2026-10-19)

| Feed | Endpoint | Status |
| --- | --- | --- |
| Prasarana rail (`rapid-rail-kl`) | `/gtfs-realtime/vehicle-position/prasarana?category=rapid-rail-kl` | **404 — does not exist** |
| Prasarana bus KL | `...?category=rapid-bus-kl` | 200, protobuf, empty outside service hours |
| MRT feeder bus | `...?category=rapid-bus-mrtfeeder` | 200, has `trip_id` + `route_id`; 2 vehicles at 01:21 |
| KTMB | `/gtfs-realtime/vehicle-position/ktmb` | 200, empty outside service hours |

Response body for rail:

```json
{"status_code": 404, "details": ["Vehicle Position feed for prasarana (rapid-rail-kl) does not exist."]}
```

Consequence: **the MRT/LRT corridor cannot show live positions.** Any "live" indicator on this route would be
a fabrication. Position must stay schedule-derived until Prasarana publishes rail realtime. Realtime is only
possible on feeds that exist (KTMB, buses).

## Realtime collection

`ingest/realtime.mjs` samples every vehicle-position feed once a minute into `data/realtime.db`:

- `vp(ts, feed, vid, trip, route, dir, lat, lon, speed, bearing)` — one row per vehicle per minute;
- `poll(ts, feed, status, bytes, n, error)` — one row per fetch, so gaps are visible as data;
- retention: 60 days (deleted daily by the collector itself).

Runs as the systemd unit `jalan-realtime` (`Restart=always`), started 2026-10-19.

Why collect before there is a feature: the official feeds only expose *now*. Headways, bunching and
travel times can only be measured from history, and history cannot be backfilled. Feeds sampled:
`rapid-bus-kl`, `rapid-bus-mrtfeeder`, `ktmb`. Rail is absent upstream (see above), so nothing is
collected for MRT/LRT.

Check it is alive:

```bash
systemctl status jalan-realtime --no-pager
sqlite3 data/realtime.db 'select feed, count(*), max(ts) from vp group by feed;'
```
