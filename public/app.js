(function () {
  'use strict'

  const API = '/signalk/v2/api'
  const POLAR_CURVE = '/plugins/signalk-polar-performance-plugin/polar/queries/curve'
  const OVERRIDE_KEYS = { twd: 'race-plan.twdOverride', tws: 'race-plan.twsOverride' }
  const WIND_SMOOTHING = 0.1 // EMA factor applied to wind per update
  const STALE_MS = 15000 // wind/heading older than this is not used
  const TWS_BUCKET_KN = 0.2 // polar curve is refetched when TWS moves by this much
  const POLAR_TWS_TOLERANCE_KN = 0.5 // a curve is only used within this much of the TWS in use
  const POLAR_REFRESH_MS = 15000 // pick up polar / performance factor changes
  const POLAR_RETRY_MS = 5000 // while failing, retry this often whatever TWS does
  const POLAR_TIMEOUT_MS = 5000
  const KN_PER_MS = 3600 / 1852

  const state = {
    route: null, // { name, points: [{ name, lat, lon }], pointIndex }
    routeKey: null,
    twdLive: null, // degrees true
    twdVec: null, // smoothed { x, y }
    twdAt: 0, // ms timestamp of the last TWD update
    twdVia: null, // which Signal K source the last TWD update came from
    twsLive: null, // knots, smoothed
    twsAt: 0,
    heading: null, // degrees true, for deriving TWD from angleTrueWater
    headingAt: 0,
    directionTrueAt: 0, // last time environment.wind.directionTrue arrived
    directionMagneticAt: 0, // last time directionMagnetic + variation gave a TWD
    position: null, // { lat, lon }
    positionAt: 0,
    startTime: null, // ms, from signalk-racer's navigation.racing.startTime
    startTimeAt: 0,
    variation: null // degrees, east positive; changes slowly so it never goes stale
  }

  const LIVE_SLOW_MS = 5000 // live indicator turns amber after this long without an update

  const polar = {
    okAt: 0, // last successful curve fetch
    tws: null, // knots bucket the curve was fetched for
    curve: null, // { points: [{ twa, tbs }], beat, run } in rad and m/s
    error: null,
    fetchedAt: 0,
    loading: false
  }

  const $ = (id) => document.getElementById(id)
  const deg = (rad) => (rad * 180) / Math.PI
  const rad = (d) => (d * Math.PI) / 180
  const norm360 = (d) => ((d % 360) + 360) % 360
  const norm180 = (d) => { const n = norm360(d); return n > 180 ? n - 360 : n }
  const fresh = (t) => Date.now() - t < STALE_MS

  // ---- geometry ---------------------------------------------------------

  function bearing (a, b) {
    const φ1 = rad(a.lat)
    const φ2 = rad(b.lat)
    const Δλ = rad(b.lon - a.lon)
    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    return norm360(deg(Math.atan2(y, x)))
  }

  function distanceNm (a, b) {
    const R = 3440.065
    const φ1 = rad(a.lat)
    const φ2 = rad(b.lat)
    const dφ = φ2 - φ1
    const dλ = rad(b.lon - a.lon)
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  // ---- data loading -----------------------------------------------------

  async function getJson (path) {
    const res = await fetch(path, { credentials: 'include' })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${path})`)
    return res.json()
  }

  async function waypointName (meta, i) {
    if (meta && meta.name) return meta.name
    if (meta && meta.href) {
      try {
        const wp = await getJson(API + meta.href)
        if (wp.name) return wp.name
      } catch (e) { /* fall through */ }
    }
    return `WP${i + 1}`
  }

  async function loadCourse () {
    let course
    try {
      course = await getJson(`${API}/vessels/self/navigation/course`)
    } catch (e) {
      setStatus(`Course API unavailable: ${e.message}`)
      return
    }

    const ar = course && course.activeRoute
    if (!ar || !ar.href) {
      state.route = null
      state.routeKey = null
      setStatus('No active route')
      render()
      return
    }

    const key = `${ar.href}|${ar.reverse ? 'r' : 'f'}`
    if (key !== state.routeKey) {
      const res = await getJson(API + ar.href)
      const coords = (res.feature && res.feature.geometry && res.feature.geometry.coordinates) || []
      const metas = (res.feature && res.feature.properties && res.feature.properties.coordinatesMeta) || []
      let points = await Promise.all(coords.map(async (c, i) => ({
        lon: c[0],
        lat: c[1],
        name: await waypointName(metas[i], i)
      })))
      if (ar.reverse) points = points.reverse()
      state.route = { name: ar.name || res.name || 'Active route', points, pointIndex: 0 }
      state.routeKey = key
    }

    state.route.pointIndex = typeof ar.pointIndex === 'number' ? ar.pointIndex : 0
    setStatus(`Heading to ${state.route.points[state.route.pointIndex]?.name ?? '?'}`)
    render()
  }

  // ---- polar ------------------------------------------------------------

  // Fetches the polar curve for the TWS in use, at most one request at a time.
  // render() calls this every time, so a newer TWS is picked up once the
  // in-flight request finishes. Any failure clears the curve, so the table
  // shows -- rather than speeds from an old polar.
  function ensurePolar (twsKn) {
    if (twsKn === null || polar.loading) return
    const bucket = Math.round(twsKn / TWS_BUCKET_KN) * TWS_BUCKET_KN
    const age = Date.now() - polar.fetchedAt
    const due = polar.error
      ? age > POLAR_RETRY_MS
      : bucket !== polar.tws || age > POLAR_REFRESH_MS
    if (!due) return

    polar.loading = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), POLAR_TIMEOUT_MS)
    const url = `${POLAR_CURVE}?tws=${(bucket / KN_PER_MS).toFixed(3)}&step=${rad(1).toFixed(5)}`
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch((e) => {
          if (e.name === 'AbortError') throw e
          return null
        })
        if (res.ok && body && Array.isArray(body.points)) {
          polar.curve = body
          polar.okAt = Date.now()
          pulse('Polar')
          polar.error = null
        } else if (body && body.error) {
          polar.curve = null
          polar.error = `Polar: ${body.error}`
        } else {
          polar.curve = null
          polar.error = `Polar plugin not reachable (${res.status})`
        }
      })
      .catch((e) => {
        polar.curve = null
        polar.error = e.name === 'AbortError'
          ? `Polar plugin not responding (no reply in ${POLAR_TIMEOUT_MS / 1000} s)`
          : `Polar plugin not reachable (${e.message})`
      })
      .finally(() => {
        clearTimeout(timer)
        polar.tws = bucket
        polar.fetchedAt = Date.now()
        polar.loading = false
        render()
      })
  }

  // The curve fetched for a nearby TWS, or null if there isn't one yet
  function polarCurveFor (twsKn) {
    if (twsKn === null || !polar.curve || polar.tws === null) return null
    return Math.abs(polar.tws - twsKn) <= POLAR_TWS_TOLERANCE_KN ? polar.curve : null
  }

  function tbsAt (points, twa) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      if (twa <= b.twa) {
        if (b.twa === a.twa) return b.tbs
        return a.tbs + (b.tbs - a.tbs) * (twa - a.twa) / (b.twa - a.twa)
      }
    }
    return points.length ? points[points.length - 1].tbs : null
  }

  // Two-board leg sailed at TWA ±angle (both in rad, twa signed, + = stbd).
  // Resolving the leg along and across the wind axis gives, per unit of
  // distance / boat speed:
  //   total time         cos(twa) / cos(angle)
  //   stbd − port time   sin(twa) / sin(angle)
  // so speed along the leg is tbs·cos(angle)/cos(twa).
  function twoBoard (tbs, angle, twa, mode) {
    const total = Math.cos(twa) / Math.cos(angle)
    const diff = Math.sin(twa) / Math.sin(angle)
    const stbdShare = Math.min(1, Math.max(0, (total + diff) / (2 * total)))
    return { stw: tbs * KN_PER_MS, made: (tbs / total) * KN_PER_MS, mode, angle: deg(angle), stbdShare }
  }

  // Expected boat speed, speed made good along the leg, and the share of the
  // leg spent on starboard, at the given signed TWA. Legs tighter than the
  // beat angle (or deeper than the run angle) are sailed at that angle on
  // both tacks/gybes.
  function legPerformance (curve, twaDeg) {
    const twa = rad(twaDeg)
    const a = Math.abs(twa)
    const { beat, run, points } = curve

    if (beat && beat.tbs > 0 && a < beat.twa) return twoBoard(beat.tbs, beat.twa, twa, 'tack')
    if (run && run.tbs > 0 && a > run.twa) return twoBoard(run.tbs, run.twa, twa, 'gybe')

    const tbs = tbsAt(points, a)
    if (!(tbs > 0)) return null
    return { stw: tbs * KN_PER_MS, made: tbs * KN_PER_MS, mode: 'direct', stbdShare: twa >= 0 ? 1 : 0 }
  }

  // ---- wind -------------------------------------------------------------

  function updateTwd (twdDeg, via) {
    state.twdVia = via
    const x = Math.cos(rad(twdDeg))
    const y = Math.sin(rad(twdDeg))
    // Start afresh after a gap rather than blending in wind from before it
    if (!state.twdVec || !fresh(state.twdAt)) {
      state.twdVec = { x, y }
    } else {
      state.twdVec.x += WIND_SMOOTHING * (x - state.twdVec.x)
      state.twdVec.y += WIND_SMOOTHING * (y - state.twdVec.y)
    }
    state.twdLive = norm360(deg(Math.atan2(state.twdVec.y, state.twdVec.x)))
    state.twdAt = Date.now()
  }

  function updateTws (twsKn) {
    state.twsLive = state.twsLive === null || !fresh(state.twsAt)
      ? twsKn
      : state.twsLive + WIND_SMOOTHING * (twsKn - state.twsLive)
    state.twsAt = Date.now()
  }

  function readOverride (key) {
    const v = $(`${key}Override`).value.trim()
    if (v === '' || isNaN(Number(v))) return null
    const n = Number(v)
    if (key === 'twd') return norm360(n)
    return n >= 0 ? n : null
  }

  // ---- rendering --------------------------------------------------------

  function setStatus (text) { $('status').textContent = text }

  function setConnection (text) {
    $('conn').textContent = text
    $('conn').hidden = !text
  }

  const fmtTwd = (d) => `${norm360(Math.round(d))}°`
  const fmtTws = (kn) => `${kn.toFixed(1)} kn`
  const fmtClock = (ms) => new Date(ms + 30000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) // nearest minute

  // Shows the Signal K and override tiles for one wind quantity, marks the
  // one in use, and returns the value in use plus a label naming its source.
  function renderSource (key, lastLive, liveAt, fmt) {
    const live = lastLive !== null && fresh(liveAt) ? lastLive : null
    const override = readOverride(key)

    const el = $(`${key}Live`)
    if (live !== null) el.textContent = fmt(live)
    else if (lastLive !== null) el.textContent = `${fmt(lastLive)} stale`
    else el.textContent = '--'
    el.classList.toggle('stale', live === null)

    const usingOverride = override !== null
    $(`${key}LiveTile`).classList.toggle('in-use', !usingOverride)
    $(`${key}OverrideTile`).classList.toggle('in-use', usingOverride)
    $(`${key}Clear`).hidden = !usingOverride

    const value = usingOverride ? override : live
    const label = value === null ? '' : `${usingOverride ? 'override' : 'SK'} ${fmt(value)}`
    return { value, label, usingOverride }
  }

  // On tack/gybe legs both boards are sailed, so the side isn't coloured
  function fmtTwa (twa, twoBoards) {
    if (twa === null) return '<span class="placeholder">--</span>'
    const side = twoBoards ? '' : twa >= 0 ? 'stbd' : 'port'
    const label = twa >= 0 ? 'S' : 'P'
    return `<span class="${side}">${Math.round(Math.abs(twa))}° ${label}</span>`
  }

  // Whole minutes: the polar model isn't accurate to the second. The current
  // leg from the boat shows seconds too, so it visibly ticks as you sail.
  function fmtDuration (hours, withSeconds) {
    if (withSeconds && hours < 1) {
      const s = Math.round(hours * 3600)
      return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
    }
    const total = Math.round(hours * 60)
    if (total < 1) return '<1m'
    const h = Math.floor(total / 60)
    const m = total % 60
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  }

  // ---- live indicators ----------------------------------------------------

  // Briefly pulses an input's dot when fresh data for it arrives
  function pulse (key) {
    const dot = $(`live${key}`).querySelector('.dot')
    dot.classList.remove('pulse')
    void dot.offsetWidth // restart the animation
    dot.classList.add('pulse')
  }

  // state: 'fresh' | 'slow' | 'stale' | 'override' | 'off'
  function setLive (key, state, text) {
    const el = $(`live${key}`)
    for (const c of ['fresh', 'slow', 'stale', 'override', 'off']) el.classList.toggle(c, c === state)
    el.querySelector('.age').textContent = text
  }

  function liveFromAge (key, age) {
    if (age === null) return setLive(key, 'off', '--')
    if (age >= STALE_MS) return setLive(key, 'stale', 'stale')
    setLive(key, age >= LIVE_SLOW_MS ? 'slow' : 'fresh', `${Math.floor(age / 1000)}s`)
  }

  function renderLive (twd, tws, curve) {
    const now = Date.now()
    // Wind age is the older of TWD/TWS, counting only the ones from Signal K
    const ages = []
    if (!twd.usingOverride) ages.push(state.twdAt ? now - state.twdAt : null)
    if (!tws.usingOverride) ages.push(state.twsAt ? now - state.twsAt : null)
    if (ages.length === 0) setLive('Wind', 'override', 'override')
    else liveFromAge('Wind', ages.includes(null) ? null : Math.max(...ages))
    liveFromAge('Gps', state.positionAt ? now - state.positionAt : null)
    if (curve) setLive('Polar', 'fresh', `${Math.floor((now - polar.okAt) / 1000)}s`)
    else setLive('Polar', polar.error ? 'stale' : 'off', polar.error ? 'error' : '--')
  }

  // Time on each board; a board under 1% of the leg is left out
  function fmtBoards (hours, stbdShare) {
    const parts = []
    if (stbdShare < 0.99) parts.push(`<span class="port">P ${fmtDuration(hours * (1 - stbdShare))}</span>`)
    if (stbdShare > 0.01) parts.push(`<span class="stbd">S ${fmtDuration(hours * stbdShare)}</span>`)
    return parts.join(' / ')
  }

  function escapeHtml (s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function render () {
    const twd = renderSource('twd', state.twdLive, state.twdAt, fmtTwd)
    $('twdVia').textContent = state.twdVia || ''
    const tws = renderSource('tws', state.twsLive, state.twsAt, fmtTws)
    $('twaSource').textContent = twd.label
    $('twaSource').classList.toggle('warn', twd.usingOverride)
    $('stwSource').textContent = tws.label
    $('stwSource').classList.toggle('warn', tws.usingOverride)

    // Bearings are shown magnetic (what the compass reads); TWA is still
    // worked out from the true bearing
    const variation = state.variation
    const brgSource = $('brgSource')
    brgSource.textContent = variation === null
      ? '°T no variation'
      : `°M var ${Math.abs(variation).toFixed(1)}°${variation >= 0 ? 'E' : 'W'}`
    brgSource.classList.toggle('warn', variation === null)

    ensurePolar(tws.value)
    const curve = polarCurveFor(tws.value)
    renderLive(twd, tws, curve)
    $('polarStatus').textContent = tws.value !== null && polar.error ? polar.error : ''
    $('polarStatus').hidden = !$('polarStatus').textContent

    const tbody = $('legs')
    const route = state.route
    if (!route || route.points.length < 2) {
      $('routeName').textContent = 'Race Plan'
      $('summary').textContent = ''
      tbody.innerHTML = '<tr><td colspan="8" class="muted center">No active route</td></tr>'
      return
    }
    $('routeName').textContent = route.name

    // Everything for one leg, from any point (a mark or the boat) to a mark
    const leg = (from, to) => {
      const brg = bearing(from, to)
      const dist = distanceNm(from, to)
      const twa = twd.value === null ? null : norm180(twd.value - brg)
      const perf = twa !== null && curve ? legPerformance(curve, twa) : null
      const hours = perf && perf.made > 0 ? dist / perf.made : null
      return { from, to, brg, dist, twa, perf, hours }
    }

    // Remaining figures and ETAs are only worked out from a fresh position.
    // ETAs add up leg by leg, so once one leg time is unknown every later
    // ETA is too.
    const now = Date.now()
    const boat = state.position && fresh(state.positionAt)
      ? { ...state.position, name: 'Boat' }
      : null
    const startTime = state.startTime !== null && fresh(state.startTimeAt) ? state.startTime : null
    let clock = boat ? now : null
    const advance = (hours) => { clock = clock !== null && hours !== null ? clock + hours * 3600000 : null }

    const rows = []
    let courseNm = 0
    let courseHours = 0
    let toGoNm = 0

    // Heading to the first point: add the boat's leg to it, and don't leave
    // it before the start time if one is published
    if (boat && route.pointIndex === 0) {
      const l = leg(boat, route.points[0])
      advance(l.hours)
      if (clock !== null && startTime !== null && startTime > clock) clock = startTime
      toGoNm += l.dist
      rows.push(rowHtml('&ndash;', 'active', l, '', clock, true))
    }

    for (let i = 0; i < route.points.length - 1; i++) {
      const full = leg(route.points[i], route.points[i + 1])
      courseNm += full.dist
      courseHours = courseHours !== null && full.hours !== null ? courseHours + full.hours : null

      // pointIndex is the destination point, so the active leg ends at it
      const legEnd = i + 1
      if (legEnd < route.pointIndex) {
        rows.push(rowHtml(i + 1, 'done', full, '', null))
      } else if (legEnd === route.pointIndex && boat) {
        const l = leg(boat, full.to)
        advance(l.hours)
        toGoNm += l.dist
        const sub = `leg ${full.dist.toFixed(2)} nm` + (full.hours !== null ? ` &middot; ${fmtDuration(full.hours)}` : '')
        rows.push(rowHtml(i + 1, 'active', l, sub, clock, true))
      } else {
        advance(full.hours)
        toGoNm += full.dist
        rows.push(rowHtml(i + 1, legEnd === route.pointIndex ? 'active' : '', full, '', clock))
      }
    }
    tbody.innerHTML = rows.join('')

    const course = `Course ${courseNm.toFixed(2)} nm` + (courseHours !== null ? ` &middot; ${fmtDuration(courseHours)}` : '')
    let summary
    if (!boat) summary = `${course} &middot; <span class="warn">No position: remaining and ETA unavailable</span>`
    else if (clock === null) summary = `${course} &middot; ${toGoNm.toFixed(2)} nm to go &middot; Finish --`
    else summary = `<strong>Finish ${fmtClock(clock)}</strong> &middot; ${fmtDuration((clock - now) / 3600000)} to go<div class="sub">${toGoNm.toFixed(2)} nm to go &middot; ${course}</div>`
    $('summary').innerHTML = summary

    function rowHtml (num, cls, l, sub, eta, fromBoat) {
      const { perf, hours } = l
      const none = '<span class="placeholder">--</span>'
      // Target speed, with the beat/run angle underneath when the leg needs one
      const stwCell = perf
        ? `${perf.stw.toFixed(1)} kn${perf.mode === 'direct' ? '' : `<div class="sub">${perf.mode === 'tack' ? 'beat' : 'run'} ${Math.round(perf.angle)}°</div>`}`
        : none
      const etaCell = cls === 'done' ? '' : eta !== null ? fmtClock(eta) : none
      // Most important first so a phone shows them without scrolling:
      // leg, TWA, target STW, time, then port/stbd, ETA, bearing, distance
      return `<tr class="${cls}">
        <td class="leg"><span class="leg-no">${num}</span> ${escapeHtml(l.from.name)} &rarr; ${escapeHtml(l.to.name)}${sub ? `<div class="sub">${sub}</div>` : ''}</td>
        <td class="num">${fmtTwa(l.twa, perf !== null && perf.mode !== 'direct')}</td>
        <td class="num">${stwCell}</td>
        <td class="num">${hours !== null ? fmtDuration(hours, fromBoat) : none}</td>
        <td class="num">${hours !== null ? fmtBoards(hours, perf.stbdShare) : none}</td>
        <td class="num">${etaCell}</td>
        <td class="num">${norm360(Math.round(l.brg - (variation ?? 0))).toString().padStart(3, '0')}°</td>
        <td class="num">${l.dist.toFixed(2)} nm</td>
      </tr>`
    }
  }

  // ---- stream -----------------------------------------------------------

  function connect () {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/signalk/v1/stream?subscribe=none`)

    ws.onopen = () => {
      setConnection('')
      ws.send(JSON.stringify({
        context: 'vessels.self',
        subscribe: [
          { path: 'environment.wind.directionTrue', period: 1000 },
          { path: 'environment.wind.directionMagnetic', period: 1000 },
          { path: 'environment.wind.angleTrueWater', period: 1000 },
          { path: 'environment.wind.speedTrue', period: 1000 },
          { path: 'navigation.headingTrue', period: 1000 },
          { path: 'navigation.magneticVariation', period: 10000 },
          { path: 'navigation.position', period: 1000 },
          { path: 'navigation.racing.startTime', period: 1000 },
          { path: 'navigation.course.activeRoute', policy: 'instant' }
        ]
      }))
    }

    ws.onmessage = (msg) => {
      const delta = JSON.parse(msg.data)
      if (!delta.updates) return
      let courseChanged = false
      let redraw = false
      let windArrived = false
      let positionArrived = false

      for (const u of delta.updates) {
        for (const { path, value } of u.values || []) {
          if (path === 'environment.wind.directionTrue' && typeof value === 'number') {
            state.directionTrueAt = Date.now()
            updateTwd(deg(value), 'directionTrue')
            redraw = windArrived = true
          } else if (path === 'environment.wind.directionMagnetic' && typeof value === 'number') {
            // First fallback: magnetic TWD + variation (east positive)
            if (!fresh(state.directionTrueAt) && state.variation !== null) {
              state.directionMagneticAt = Date.now()
              updateTwd(deg(value) + state.variation, 'directionMagnetic + variation')
              redraw = windArrived = true
            }
          } else if (path === 'environment.wind.speedTrue' && typeof value === 'number') {
            updateTws(value * KN_PER_MS)
            redraw = windArrived = true
          } else if (path === 'navigation.magneticVariation' && typeof value === 'number') {
            if (state.variation === null) redraw = true
            state.variation = deg(value)
          } else if (path === 'navigation.position' && value &&
              typeof value.latitude === 'number' && typeof value.longitude === 'number') {
            state.position = { lat: value.latitude, lon: value.longitude }
            state.positionAt = Date.now()
            redraw = positionArrived = true
          } else if (path === 'navigation.racing.startTime') {
            const t = typeof value === 'string' ? Date.parse(value) : NaN
            state.startTime = isNaN(t) ? null : t
            state.startTimeAt = Date.now()
          } else if (path === 'navigation.headingTrue' && typeof value === 'number') {
            state.heading = deg(value)
            state.headingAt = Date.now()
          } else if (path === 'environment.wind.angleTrueWater' && typeof value === 'number') {
            // Last fallback: true heading + true wind angle
            if (!fresh(state.directionTrueAt) && !fresh(state.directionMagneticAt) &&
                state.heading !== null && fresh(state.headingAt)) {
              updateTwd(state.heading + deg(value), 'headingTrue + angleTrueWater')
              redraw = windArrived = true
            }
          } else if (path === 'navigation.course.activeRoute') {
            courseChanged = true
          }
        }
      }

      if (windArrived) pulse('Wind')
      if (positionArrived) pulse('Gps')
      if (courseChanged) loadCourse().catch((e) => setStatus(e.message))
      else if (redraw) render()
    }

    ws.onclose = () => {
      setConnection('Disconnected, retrying…')
      setTimeout(connect, 3000)
    }
  }

  // ---- init -------------------------------------------------------------

  for (const key of Object.keys(OVERRIDE_KEYS)) {
    const input = $(`${key}Override`)
    try {
      const saved = localStorage.getItem(OVERRIDE_KEYS[key])
      if (saved !== null) input.value = saved
    } catch (e) { /* storage unavailable */ }

    const save = () => {
      try { localStorage.setItem(OVERRIDE_KEYS[key], input.value) } catch (err) { /* ignore */ }
      render()
    }
    input.addEventListener('input', save)
    $(`${key}Clear`).addEventListener('click', () => {
      input.value = ''
      save()
    })
  }

  loadCourse().catch((e) => setStatus(e.message))
  setInterval(() => loadCourse().catch((e) => setStatus(e.message)), 15000)
  setInterval(render, 1000) // so wind goes stale on screen even with no updates
  connect()
})()
