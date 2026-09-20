# signalk-race-plan

A Signal K webapp that turns the active route into a race plan. For every leg it shows the bearing, distance and true wind angle. With a polar available, it also shows expected boat speed, leg time, time on each tack or gybe, and an ETA at each mark. On the current leg, figures are worked out from the boat's position to the mark. Under the table a mini map draws the course, the boat and the leg being sailed, and buttons in the header step to the next or previous mark.

Use it ashore with a forecast wind to plan the race, or on the water with live wind from your instruments.

## Example

Wind from 000°T at 12 kn, magnetic variation 12.3°E, with a polar whose best upwind angle is 40° (6.0 kn) and best downwind angle is 150° (7.0 kn). At 14:00 the boat has rounded Windward and is 0.4 nm down the 1 nm reach to Wing.

Header summary: **Finish 14:49** · 49m to go (5.10 nm to go · Course 7.00 nm · 1h 12m)

| Leg | TWA | STW | Time | Port / Stbd | ETA | BRG °M | DIST |
|-----|----:|----:|-----:|------------:|----:|-------:|-----:|
| 1 Start → Windward | 0° S | 6.0 kn<br>*beat 40°* | 20m | P 10m / S 10m | | 348° | 1.50 nm |
| **2 Boat → Wing**<br>*leg 1.00 nm · 8m* | **120° P** | **7.8 kn** | **5m** | **P 5m** | **14:05** | **108°** | **0.60 nm** |
| 3 Wing → Leeward | 120° S | 7.8 kn | 8m | S 8m | 14:12 | 228° | 1.00 nm |
| 4 Leeward → Windward | 30° S | 6.0 kn<br>*beat 40°* | 17m | P 3m / S 14m | 14:29 | 318° | 1.50 nm |
| 5 Windward → Finish | 180° S | 7.0 kn<br>*run 150°* | 20m | P 10m / S 10m | 14:49 | 168° | 2.00 nm |

On the page:

- Leg 1 is dimmed because it's already sailed.
- Leg 2 (bold here) is highlighted as the current leg.
- Port and starboard values are coloured red and green.

Reading the example:

- **Leg 1** is dead upwind. It's sailed as a beat at 40° on each tack, so time is split evenly between the tacks.
- **Leg 2** is the current leg, so it runs from the boat to Wing: 0.60 nm and 5m to go. The full mark-to-mark leg is shown underneath for reference.
- **Legs 2 and 3** are reaches, sailed directly on one tack at the polar speed for 120°.
- **Leg 4** is 30° off the wind with the wind on starboard. It's still a beat, but mostly on starboard tack, with a short port hitch.
- **Leg 5** is dead downwind. It's sailed as a run at 150° on each gybe, again split evenly.
- **ETAs** add up from now: 14:00 + 4m 39s at Wing (14:05), + 7m 45s at Leeward (14:12), and so on to the finish.

Above the table, the header shows the route name, the finish summary, live data indicators, the mark step control ("‹ To Wing ›") and the wind inputs described below. Under the table is the [mini map](#mini-map).

## Is the data live?

Numbers can sit still for a while even when data is flowing, so the header has a live strip: `● Wind 1s  ● GPS 0s  ● Polar 6s`.

- **Dot:** pulses each time new data for that input arrives.
- **Age:** seconds since the last update. Green is under 5 s and amber is 5–15 s. After 15 s it's red **stale**, and values from that input are no longer used.
- **Wind** is the older of TWD and TWS, counting only values from Signal K. If both are overridden, it shows amber **override**.
- **Polar** is the time since the curve was last read. It's re-read every 15 s, and shows red **error** if reading fails.
- **Current leg time** from the boat is shown to the second (`4m 39s`), so it visibly ticks down as you sail. Other legs are in whole minutes.

## Columns

Columns are ordered by importance, so a phone shows Leg, TWA, STW and Time without scrolling. The Leg column stays in place as you swipe right to see the rest.

| Column | What it shows |
|--------|---------------|
| **Leg** | Leg number and `From → To`, using waypoint names from the route. Falls back to `WP1`, `WP2`, … On the current leg it's `Boat → To` (see [During the race](#during-the-race)) |
| **TWA** | TWD − true leg bearing. `S` means the wind is on the starboard side when sailing the leg, `P` port. It's coloured green (S) or red (P) when the leg can be sailed directly. On beat/run legs it isn't coloured, because both sides are sailed. Without a polar the app can't tell which legs are beats or runs, so every TWA is coloured |
| **STW** | Target boat speed from the polar. On a direct leg it's the speed at the leg's TWA. If the leg is tighter than the polar's beat angle, it's the upwind target with `beat <angle>` underneath; if it's deeper than the run angle, the downwind target with `run <angle>` underneath |
| **Time** | Leg distance ÷ speed made good along the leg, in whole minutes (to the second on the current leg from the boat). Speed made good is STW for a direct leg, and target VMG ÷ \|cos(TWA)\| for a beat/run leg |
| **Port / Stbd** | Time on each tack or gybe. A direct leg puts all its time on one side. A beat/run leg is split by resolving it along and across the wind: dead upwind or downwind is 50/50, and the closer the mark is to the layline, the more time goes on one side. A side with under 1% of the leg time is left out |
| **ETA** | Clock time at the mark (nearest minute), adding leg times from now. Blank for sailed legs. Needs a fresh position |
| **BRG** | Great-circle bearing to the mark, in degrees **magnetic**: what the compass shows. Converted from true using `navigation.magneticVariation`; the header shows the variation used, e.g. `°M var 12.3°E`. If no variation is available, the true bearing is shown and the header warns `°T no variation` |
| **DIST** | Great-circle distance to the mark, in nautical miles |

Under the TWA and STW headers is the wind in use: `SK 0°` for Signal K, or `override 200°` in amber.

## Wind: Signal K or override

The header has two pairs of boxes, one pair for TWD and one for TWS. Each pair shows **both** the live Signal K value and your override. The one in use is outlined and tagged **In use**; the other is dimmed.

| | Signal K value | Override |
|---|---|---|
| **TWD** (true) | The first of these that's arriving:<br>1. `environment.wind.directionTrue`<br>2. `environment.wind.directionMagnetic` + `navigation.magneticVariation`<br>3. `navigation.headingTrue` + `environment.wind.angleTrueWater`<br>The source in use is shown under the value | Degrees true, as in forecasts |
| **TWS** | `environment.wind.speedTrue` | Knots |

- **Smoothing:** live values are smoothed so the table doesn't jump with every gust or shift. After a gap, smoothing starts again from the first new reading, so old wind isn't blended in.
- **Stale data:** if a live value hasn't updated for 15 seconds, it's shown as e.g. `270° stale`. It isn't used, and the columns that depend on it show `--`.
- **Overrides:** type a value to plan with a forecast. The override box turns amber and is tagged **In use**. Press **×** to clear it and go back to Signal K.
- **Saved per browser:** overrides are kept in that browser across reloads. The amber box is the reminder that one is set.

## During the race

With a position from `navigation.position` less than 15 s old:

- **Current leg:** the row is worked out from the boat to the mark (`Boat → Wing`). Bearing, distance, TWA, STW, time and port/stbd are all what's left to sail from where you are. The full mark-to-mark leg is shown underneath in small text.
- **Laylines:** on a beat, port/stbd shows how much of each tack is left. When one side disappears (e.g. just `S 5m`), you're on that layline. If you overstand, the TWA to the mark widens past the beat angle and the leg becomes a direct reach.
- **ETA and finish:** each mark's ETA adds the leg times from now. The header summary shows the finish time, distance and time to go, plus the whole course distance and time.
- **Before the start:** while heading to the first point of the route, an extra `Boat → Start` row is added. If [signalk-racer](https://github.com/gregw/signalk-racer) publishes `navigation.racing.startTime`, the ETAs assume you don't leave the start before the gun.

**No position, or position older than 15 s:**
- All legs show mark to mark.
- ETAs show `--`, and the header says `No position: remaining and ETA unavailable`.
- The course total is still shown, which is what you want when planning ashore.

**Missing leg times:** if any leg's time is unknown (no wind, no polar), the ETA at that mark and every later mark shows `--`, as does the finish time.

## Mini map

Under the table, a map shows the course from above, north up:

- **Route:** a line through the marks. Legs already sailed are dotted and faded.
- **Marks:** a circle each, with the waypoint name (long names are shortened). The mark being sailed to is filled and labelled in blue; sailed marks are faded.
- **Line to the mark:** a thick dashed blue line to the mark in use — from the boat when there's a position, otherwise from the mark behind it.
- **Boat:** a green arrow at `navigation.position`, pointing at `navigation.headingTrue`. If there's no heading, it points at the mark. With no position less than 15 s old, the boat is left off and the map says so.
- **Wind arrow:** top right, pointing the way the wind is blowing (away from the TWD in use). It follows the override when one is set.
- **Scale bar:** bottom left, in metres or nautical miles.

**Zoom to leg / Whole route** switches between fitting the whole course and fitting just the leg being sailed. The choice is kept in that browser. The map is drawn to fit the shape of what it's showing, so a north–south course gets a tall box and an east–west one a short box.

The map is a sketch of the course, not a chart: no coastline, depths or hazards. Use your chart app for navigation.

## Stepping through the route

The header has **‹ To Wing ›** with the mark being sailed to and how far through the route it is (`mark 3 of 5`).

- **›** advances to the next mark, **‹** goes back one. Each button is greyed out at that end of the route.
- This changes `activeRoute.pointIndex` through the Signal K Course API, the same value a chart app advances on arrival. Every client following the course sees the change, not just this browser.
- The table and map move straight away, then the server's answer is taken as the truth. If the server refuses — e.g. a secured server you aren't logged in to — the step is undone and the header shows `Could not change mark: …`.

## Route progress

- **Which route:** the page always shows the route that is active in the Signal K Course API. It updates when a different route is activated or reversed.
- **Leg states:** legs already sailed are dimmed. The current leg (the one ending at the next point, `activeRoute.pointIndex`) is highlighted.
- **Advancing to the next mark:** done by your chart app or course provider, e.g. Freeboard-SK's arrival circle or "next point". Race Plan follows it, and can also [step it itself](#stepping-through-the-route).

## Status messages

| Message | Meaning |
|---------|---------|
| `No active route` | No route is active in the Course API |
| `No position: remaining and ETA unavailable` | No `navigation.position` in the last 15 s. Legs are shown mark to mark |
| `Course API unavailable: …` | The Course API request failed |
| `Could not change mark: …` | The ‹ › buttons couldn't move `activeRoute.pointIndex`. `Unauthorised` means the server needs you to log in |
| `°T no variation` (under BRG) | Nothing publishes `navigation.magneticVariation`, so bearings are shown true, not magnetic |
| `Disconnected, retrying…` | The data connection to the server dropped. It reconnects every 3 s |
| `Polar: No active polar selected` | The polar plugin is running but no polar is active |
| `Polar plugin not reachable (…)` | The polar plugin isn't installed or running, or you aren't logged in on a secured server |
| `Polar plugin not responding (…)` | The polar plugin didn't reply within 5 s |

While any polar message is showing, STW, leg time and port/stbd show `--`, and Race Plan retries every 5 s. It never keeps showing speeds from an earlier polar: the curve is re-read every 15 s, and a failed read clears it straight away.

## Requirements

- **Signal K server 2.x**, for the v2 Course and Resources APIs.
- **An active route**, e.g. created and activated in Freeboard-SK.
- **True wind data** (see above), or overrides.
- **Position** (`navigation.position`) for remaining distance, time and ETAs.
- **Magnetic variation** (`navigation.magneticVariation`) for magnetic bearings and the magnetic TWD fallback. Optional.
- **Start time** (`navigation.racing.startTime` from signalk-racer). Optional.
- **Write access to the Course API** for the ‹ › mark buttons. On a secured server, log in to the Signal K admin UI in the same browser.
- **For STW, leg time and port/stbd:**
  - [signalk-polar-performance-plugin](https://github.com/htool/signalk-polar-performance-plugin)
  - A polar made active through a polar resource provider such as [signalk-polar-management](https://github.com/Asw1n/signalk-polar-management)
  - Race Plan reads the curve for the TWS in use from `/plugins/signalk-polar-performance-plugin/polar/queries/curve`. The performance factor is already applied.

## Install

In the Signal K admin UI, open **Appstore → Available**, find **Race Plan** and install it. Restart the server, then open **Webapps → Race Plan** (`/signalk-race-plan/`). It's a plain webapp with nothing to enable or configure.

For development, install from a local checkout:

```sh
cd ~/.signalk
npm install /path/to/signalk-race-plan
```

## Limitations

- **Polar only:** figures don't include current, leeway, tacking or gybing losses, or wind shifts along a leg.
- **Fewest boards:** the port/stbd split assumes one tack or gybe each way, not how often you'd actually tack.
- **Straight line from the boat:** the current leg is measured straight from the boat to the mark, ignoring obstructions.
- **Same wind for every leg:** ETAs for later legs assume the current wind holds for the rest of the race.
- **Variation:** magnetic bearings use the boat's current variation for every leg, which is fine for a race course but not for a long passage. Compass deviation isn't applied.
- **Route edits:** if you move or add marks in the active route, reload the page to see them. Race Plan only refetches the route when a different route is activated or the direction is reversed.
- **The map is not a chart:** it shows only the route and the boat, with no land, depths or hazards, and no zooming or panning beyond the two fits.
