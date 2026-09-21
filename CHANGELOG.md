# Changelog

What's changed in each release of Race Plan, newest first.

## 0.2.2 — 2026-09-21

- The README now opens with what Race Plan does for you on the water and why you'd install it, with a new screenshot showing a forecast wind override and a beat split across both tacks.
- The Appstore description leads with the benefit rather than a feature list.

## 0.2.1 — 2026-09-21

- The Time column is gone: Port / Stbd already adds up to the leg time.
- On the leg you're sailing, a board that takes the whole leg now counts down in seconds. A leg split across two boards stays in whole minutes, since that split is an estimate.
- README reorganised around a screenshot, with install and requirements first.

## 0.2.0 — 2026-09-21

- **Mini map** under the table: the course from above, with sailed legs faded, the marks, a dashed line from the boat to the next mark, the boat's heading, a wind arrow and a scale bar. A button zooms between the whole route and the current leg.
- **Next / previous mark buttons** in the header. They move the active mark through the Signal K Course API, so your chart plotter and other apps follow along. If the server refuses the change, it's undone and you're told why.
- The table scrolls sideways on its own, so the map stays in place on a phone.

## 0.1.1 — 2026-09-17

- **Live data indicators** for Wind, GPS and Polar in the header. Each dot pulses on every update and shows the seconds since: green under 5 s, amber up to 15 s, red when the data is too old to be used.
- The current leg time ticks by the second so you can see it's live.

## 0.1.0 — 2026-09-17

First release.

- Shows every leg of the active route with its TWA, and whether it's a beat, reach or run.
- Target STW and leg time from your polar (via signalk-polar-performance-plugin), using target VMG for beats and runs.
- Time on port and starboard for each leg; on the current leg, time left on each tack to the layline.
- Current leg measured from the boat's position to the mark.
- ETA at every mark and at the finish, respecting the start time from signalk-racer before the start.
- Bearings shown magnetic when magnetic variation is available.
- TWD and TWS from Signal K, with manual overrides for forecast wind.
- Stale wind, position and polar data is flagged and not used, rather than showing old numbers.
- Layout designed for phones.
