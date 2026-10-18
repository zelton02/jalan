# Backlog

Decisions waiting for a build slot. Each entry keeps the *reason*, not just the feature, so a
later change can be judged against it.

## 1. Expand the intermediate stops on a ride leg — SHIPPED 2026-10-19

**Ask.** On the journey screen, `14 stesen` should open into the actual station list, with the
current position marked.

**Why.** Not information for its own sake — *security*. A rider mid-trip needs to answer "am I on
the right train?" and "how many more?". A count answers neither; a list with a position marker
answers both.

**Design constraint (proposed, not yet in `AESTHETIC.md`).**

- Collapsed by default. Expansion is a disclosure inside the leg, never a new screen and never a
  modal.
- The station list is a rail: one hairline, station names, tabular times. No map in v1.
- Only the current step keeps the accent. The list marks *position* (a filled dot), not "progress"
  with a coloured bar — progress bars are dashboards, dots are signage.
- Expanding must not move the scroll position; collapsing restores the original height exactly.
- Offline: the list comes from the cached schedule, so it works with no signal — the whole point.

**Data.** The API already resolves `trip_id`; add `stops: [{ seq, name, time }]` plus
`originSeq` / `destinationSeq` to each ride leg, and derive the current position from the clock.
No new feed needed.

**Acceptance.**

- Tap `14 stesen` → the list opens under that leg, the current station is marked, the next action
  is still the only coloured element.
- Collapse returns the layout to exactly its previous height.
- Works with the API unreachable (cached list).

**Status.** Shipped. The list opens under the ride leg, shows 15 stations with times, marks boarding
(`NAIK`) and alighting (`TURUN`), and marks the station the train should have reached by now with a
filled dot — labelled as estimated from the schedule, because it is.

**Still missing.** The dot is an inference from the timetable, not a live position. It becomes true
only when live vehicle positions land.

## 2. Door-to-door from Sungai Long Residence — SHIPPED 2026-10-19

**Ask.** From home: which bus stop to walk to, which bus, which station to get off, whether to
transfer, and how long each walk takes.

**What the data says (2026-10-19).**

- **Correction (2026-10-19):** the first pass said "only route 590" because the **MRT feeder feed
  was never ingested**. `rapid-bus-mrtfeeder` is a separate category; it is now in `FEEDS`.
- Nearest stop: `SL CLUB HOUSE` (`12000972`), **323 m** from Bandar Sungai Long.
- Feeder **T453** (`MRT Bukit Dukung ~ Bandar Sungai Long`), 24 stops, 90 trips/day, 06:00–23:30,
  stops 34 m from KG31. Home → station is **14 min** on the bus.
- Second option: **590** (`U5900`, *Bandar Sungai Long ~ Hab Pasar Seni*), 103 stops, first trip
  05:30, ~31 min to Pasar Seni on the early trip.
- 590 passes **181 m** from a Kajang-line station at `KJ338 KOMERSIAL BT 11`, and ends **54 m** from
  `KJ14 / KG16 Pasar Seni` — so it works both as a bus-to-MRT feeder and as a one-seat ride.
- Walking to Bukit Dukung is **not** realistic: the station is ~3.6 km from the housing area. The
  current plan's fixed "8 min walk to Bukit Dukung" is fabricated and must be replaced by the T453
  feeder leg.

**Shipped.** `lib.planDoorToDoor()` is now the single source for both `npm run door` and `/api/plan`.
The app shows the real chain: walk 4 min → T453 (9 stops) → MRT KG31 (15 stops) → Pasar Seni →
LRT → KL Sentral, **86 min**. The old fixed "8 min walk to Bukit Dukung" is gone.

**Needs.** Walking legs computed from stop coordinates (distance ÷ ~75 m/min), bus legs with real
departures, and an origin that is an address, not a station.

**Blocks.** Nothing; `stops.lat/lon` is already ingested for every feed.
