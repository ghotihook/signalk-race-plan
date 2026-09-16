# signalk-race-plan

A Signal K webapp and plugin that lists each leg of the active route.

| Column   | Source |
|----------|--------|
| Leg      | `WP name → WP name` from the route's `coordinatesMeta` (names, or linked waypoint resources). Falls back to `WPn`. |
| BRG/DIST | Great-circle bearing and distance for each leg |
| TWA      | `TWD − leg bearing`, shown as `°S` (starboard) or `°P` (port) |
| Sail cfg | placeholder |
| STW      | Expected boat speed at the leg TWA from the active polar. If the leg is tighter than the polar's beat angle or deeper than its run angle, the target speed at that angle is shown with `tack`/`gybe` |
| Leg time | Leg distance ÷ speed along the leg. For tack/gybe legs, that speed is target VMG ÷ cos(angle between the wind axis and the leg) |

TWD comes from `environment.wind.directionTrue`, smoothed. If that path isn't there, it's worked out from `navigation.headingTrue + environment.wind.angleTrueWater`. If neither source has updated for 15 s, `directionTrue` is dropped in favour of the fallback, and TWD is shown as stale with TWA blanked. You can type a TWD override in the header to plan with a forecast wind. Both values are always shown; the one TWA is worked out from is outlined and tagged **In use**, and the TWA column header names it. Clear the override (×) to go back to Signal K.

TWS works the same way: `environment.wind.speedTrue`, smoothed, with an override in knots.

STW and leg time need [signalk-polar-performance-plugin](https://github.com/htool/signalk-polar-performance-plugin) with an active polar. The app reads `/plugins/signalk-polar-performance-plugin/polar/queries/curve` for the TWS in use, which already includes the performance factor. If the plugin or polar is missing, the header says so and those columns show `--`.

Legs already sailed are dimmed. The current leg (the one ending at `activeRoute.pointIndex`) is highlighted. Reversed routes work too.

Uses the Signal K v2 Course and Resources APIs (Signal K server 2.x).

## Install (development)

```sh
cd ~/.signalk
npm install /path/to/signalk-race-plan
```

Restart the server, then open **Webapps → Race Plan** (`/signalk-race-plan/`).
