# Data

Everything here is **static schedule data** from Malaysia's official open-data portal.
No scraping, no third-party APIs.

## Sources

| Feed | Endpoint | Refresh | Notes |
| --- | --- | --- | --- |
| Rapid Rail KL | `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl` | as required | LRT / MRT / Monorail / BRT |
| Rapid Bus KL | `https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl` | as required | Includes MRT feeder routes |
| KTMB | `https://api.data.gov.my/gtfs-static/ktmb` | daily 00:01 | Komuter / ETS |
| Vehicle positions (RT) | `https://api.data.gov.my/gtfs-realtime/vehicle-position/<agency>` | every 30s | **Positions only** |

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

## Licence

Data is published by the Government of Malaysia under the Open Data Terms of Use 1.0.
Prasarana feeds are CC BY 4.0. Attribute "Data source: data.gov.my / Prasarana / KTMB"
in any public build.

## Refresh

`scripts/refresh.sh` rebuilds the database from the three feeds and swaps it in atomically:

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
