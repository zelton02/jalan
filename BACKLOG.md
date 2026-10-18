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
