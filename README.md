# signalk-race-plan

A Signal K webapp and plugin that lists each leg of the active route.

| Column   | Source |
|----------|--------|
| Leg      | `WP name → WP name` from the route's `coordinatesMeta` (names, or linked waypoint resources). Falls back to `WPn`. |
| BRG/DIST | Great-circle bearing and distance for each leg |
| TWA      | `TWD − leg bearing`, shown as `°S` (starboard) or `°P` (port) |
| Sail cfg | placeholder |
| STW      | placeholder |
| Leg time | placeholder |

TWD comes from `environment.wind.directionTrue`, smoothed. If that path isn't there, it's worked out from `navigation.headingTrue + environment.wind.angleTrueWater`. You can type a TWD override in the header to plan with a forecast wind.

Legs already sailed are dimmed. The current leg (the one ending at `activeRoute.pointIndex`) is highlighted. Reversed routes work too.

Uses the Signal K v2 Course and Resources APIs (Signal K server 2.x).

## Install (development)

```sh
cd ~/.signalk
npm install /path/to/signalk-race-plan
```

Restart the server, then open **Webapps → Race Plan** (`/signalk-race-plan/`).
