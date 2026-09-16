# signalk-race-plan

A Signal K webapp that turns the active route into a race plan. For every leg it shows the bearing, distance and true wind angle. With a polar available, it also shows expected boat speed, leg time, and time on each tack or gybe.

Use it ashore with a forecast wind to plan the race, or on the water with live wind from your instruments.

## Example

Wind from 000° at 12 kn, with a polar whose best upwind angle is 40° (6.0 kn) and best downwind angle is 150° (7.0 kn). The boat has rounded Windward and is heading to Wing:

| # | Leg | BRG | DIST | TWA | Sail cfg | STW | Leg time | Port / Stbd |
|---|-----|----:|-----:|----:|----------|----:|---------:|------------:|
| 1 | Start → Windward | 000° | 1.50 nm | 0° S | -- | 6.0 kn tack 40° | 19m 36s | P 9m 48s / S 9m 48s |
| **2** | **Windward → Wing** | **120°** | **1.00 nm** | **120° P** | **--** | **7.8 kn** | **7m 45s** | **P 7m 45s** |
| 3 | Wing → Leeward | 240° | 1.00 nm | 120° S | -- | 7.8 kn | 7m 45s | S 7m 45s |
| 4 | Leeward → Windward | 330° | 1.50 nm | 30° S | -- | 6.0 kn tack 40° | 16m 58s | P 2m 39s / S 14m 19s |
| 5 | Windward → Finish | 180° | 2.00 nm | 180° S | -- | 7.0 kn gybe 150° | 19m 48s | P 9m 54s / S 9m 54s |

On the page:

- Leg 1 is dimmed because it's already sailed.
- Leg 2 (bold here) is highlighted as the current leg.
- Port and starboard values are coloured red and green.

Reading the example:

- **Leg 1** is dead upwind. It's sailed as a beat at 40° on each tack, so time is split evenly between the tacks.
- **Legs 2 and 3** are reaches, sailed directly on one tack at the polar speed for 120°.
- **Leg 4** is 30° off the wind with the wind on starboard. It's still a beat, but mostly on starboard tack, with a short port hitch.
- **Leg 5** is dead downwind. It's sailed as a run at 150° on each gybe, again split evenly.

Above the table, the header shows the route name, the next mark ("Heading to Wing") and the wind inputs described below.

## Columns

| Column | What it shows |
|--------|---------------|
| **#** | Leg number |
| **Leg** | `From → To`, using waypoint names from the route. Falls back to `WP1`, `WP2`, … |
| **BRG** | Great-circle bearing from mark to mark, in degrees true |
| **DIST** | Great-circle distance from mark to mark, in nautical miles |
| **TWA** | TWD − leg bearing. `S` means the wind is on the starboard side when sailing the leg, `P` port. It's coloured green (S) or red (P) when the leg can be sailed directly. On tack/gybe legs it isn't coloured, because both sides are sailed |
| **Sail cfg** | Placeholder, not implemented yet |
| **STW** | Expected boat speed from the polar at the leg's TWA. If the leg is tighter than the polar's beat angle, it shows the target upwind speed with `tack <angle>`. If it's deeper than the run angle, it shows the target downwind speed with `gybe <angle>` |
| **Leg time** | Leg distance ÷ speed made good along the leg. That's STW for a direct leg, and target VMG ÷ cos(TWA) for a tack/gybe leg |
| **Port / Stbd** | Time on each tack or gybe. A direct leg puts all its time on one side. A tack/gybe leg is split by resolving it along and across the wind: dead upwind or downwind is 50/50, and the closer the mark is to the layline, the more time goes on one side. A side with under 1% of the leg time is left out |

The TWA and STW column headers show the wind used, e.g. `TWA (Signal K 0°)` or `STW (override 14.0 kn)`.

## Wind: Signal K or override

The header has two pairs of boxes, one pair for TWD and one for TWS. Each pair shows **both** the live Signal K value and your override. The one in use is outlined and tagged **In use**; the other is dimmed.

| | Signal K value | Override |
|---|---|---|
| **TWD** | `environment.wind.directionTrue`, or if that isn't arriving, `navigation.headingTrue` + `environment.wind.angleTrueWater` | Degrees true |
| **TWS** | `environment.wind.speedTrue` | Knots |

- **Smoothing:** live values are smoothed so the table doesn't jump with every gust or shift.
- **Stale data:** if a live value hasn't updated for 15 seconds, it's shown as e.g. `270° stale`. It isn't used, and the columns that depend on it show `--`.
- **Overrides:** type a value to plan with a forecast. The override box turns amber and is tagged **In use**. Press **×** to clear it and go back to Signal K.
- **Saved per browser:** overrides are kept in that browser across reloads. The amber box is the reminder that one is set.

## Route progress

- **Which route:** the page always shows the route that is active in the Signal K Course API. It updates when a different route is activated or reversed.
- **Leg states:** legs already sailed are dimmed. The current leg (the one ending at the next point, `activeRoute.pointIndex`) is highlighted.
- **Advancing to the next mark:** done by your chart app or course provider, e.g. Freeboard-SK's arrival circle or "next point". Race Plan follows it.

## Status messages

| Message | Meaning |
|---------|---------|
| `No active route` | No route is active in the Course API |
| `Disconnected, retrying…` | The data connection to the server dropped. It reconnects every 3 s |
| `Polar: No active polar selected` | The polar plugin is running but no polar is active. STW, leg time and port/stbd show `--` |
| `Polar plugin not reachable (…)` | The polar plugin isn't installed or running, or you aren't logged in on a secured server |

## Requirements

- **Signal K server 2.x**, for the v2 Course and Resources APIs.
- **An active route**, e.g. created and activated in Freeboard-SK.
- **True wind data** (see above), or overrides.
- **For STW, leg time and port/stbd:**
  - [signalk-polar-performance-plugin](https://github.com/htool/signalk-polar-performance-plugin)
  - A polar made active through a polar resource provider such as [signalk-polar-management](https://github.com/Asw1n/signalk-polar-management)
  - Race Plan reads the curve for the TWS in use from `/plugins/signalk-polar-performance-plugin/polar/queries/curve`. The performance factor is already applied.

## Install (development)

```sh
cd ~/.signalk
npm install /path/to/signalk-race-plan
```

Restart the server, then open **Webapps → Race Plan** (`/signalk-race-plan/`). The plugin is enabled by default.

## Limitations

- **Polar only:** figures don't include current, leeway, tacking or gybing losses, or wind shifts along a leg.
- **Fewest boards:** the port/stbd split assumes one tack or gybe each way, not how often you'd actually tack.
- **Mark to mark:** leg figures for the current leg cover the whole leg, not what's left from the boat's position.
- **True bearings only.**
- **Route edits:** if you move or add marks in the active route, reload the page to see them. Race Plan only refetches the route when a different route is activated or the direction is reversed.
