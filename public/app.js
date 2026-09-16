(function () {
  'use strict'

  const API = '/signalk/v2/api'
  const POLAR_CURVE = '/plugins/signalk-polar-performance-plugin/polar/queries/curve'
  const OVERRIDE_KEYS = { twd: 'race-plan.twdOverride', tws: 'race-plan.twsOverride' }
  const WIND_SMOOTHING = 0.1 // EMA factor applied to wind per update
  const STALE_MS = 15000 // wind/heading older than this is not used
  const TWS_BUCKET_KN = 0.2 // polar curve is refetched when TWS moves by this much
  const POLAR_REFRESH_MS = 60000 // pick up polar / performance factor changes
  const POLAR_RETRY_MS = 30000
  const KN_PER_MS = 3600 / 1852

  const state = {
    route: null, // { name, points: [{ name, lat, lon }], pointIndex }
    routeKey: null,
    twdLive: null, // degrees true
    twdVec: null, // smoothed { x, y }
    twdAt: 0, // ms timestamp of the last TWD update
    twsLive: null, // knots, smoothed
    twsAt: 0,
    heading: null, // degrees true, for deriving TWD from angleTrueWater
    headingAt: 0,
    directionTrueAt: 0 // last time environment.wind.directionTrue arrived
  }

  const polar = {
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
  // in-flight request finishes.
  function ensurePolar (twsKn) {
    if (twsKn === null || polar.loading) return
    const bucket = Math.round(twsKn / TWS_BUCKET_KN) * TWS_BUCKET_KN
    const age = Date.now() - polar.fetchedAt
    const due = bucket !== polar.tws ||
      age > (polar.error ? POLAR_RETRY_MS : POLAR_REFRESH_MS)
    if (!due) return

    polar.loading = true
    const url = `${POLAR_CURVE}?tws=${(bucket / KN_PER_MS).toFixed(3)}&step=${rad(1).toFixed(5)}`
    fetch(url, { credentials: 'include' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (res.ok && body && Array.isArray(body.points)) {
          polar.curve = body
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
        polar.error = `Polar plugin not reachable (${e.message})`
      })
      .finally(() => {
        polar.tws = bucket
        polar.fetchedAt = Date.now()
        polar.loading = false
        render()
      })
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

  // Expected boat speed and speed made good along a leg at the given TWA.
  // Legs tighter than the beat angle (or deeper than the run angle) are
  // sailed at that angle on both tacks/gybes; along the leg that gives
  // target VMG / cos(angle between wind axis and leg).
  function legPerformance (curve, twaDeg) {
    const a = rad(Math.abs(twaDeg))
    const { beat, run, points } = curve

    if (beat && beat.tbs > 0 && a < beat.twa) {
      const vmg = beat.tbs * Math.cos(beat.twa)
      return { stw: beat.tbs * KN_PER_MS, made: (vmg / Math.cos(a)) * KN_PER_MS, mode: 'tack', angle: deg(beat.twa) }
    }
    if (run && run.tbs > 0 && a > run.twa) {
      const vmg = run.tbs * -Math.cos(run.twa)
      return { stw: run.tbs * KN_PER_MS, made: (vmg / -Math.cos(a)) * KN_PER_MS, mode: 'gybe', angle: deg(run.twa) }
    }
    const tbs = tbsAt(points, a)
    if (!(tbs > 0)) return null
    return { stw: tbs * KN_PER_MS, made: tbs * KN_PER_MS, mode: 'direct' }
  }

  // ---- wind -------------------------------------------------------------

  function updateTwd (twdDeg) {
    const x = Math.cos(rad(twdDeg))
    const y = Math.sin(rad(twdDeg))
    if (!state.twdVec) {
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

  const fmtTwd = (d) => `${Math.round(d)}°`
  const fmtTws = (kn) => `${kn.toFixed(1)} kn`

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
    const label = value === null ? '' : `(${usingOverride ? 'override' : 'Signal K'} ${fmt(value)})`
    return { value, label }
  }

  function fmtTwa (twa) {
    if (twa === null) return '<span class="placeholder">--</span>'
    const side = twa >= 0 ? 'stbd' : 'port'
    const label = twa >= 0 ? 'S' : 'P'
    return `<span class="${side}">${Math.round(Math.abs(twa))}° ${label}</span>`
  }

  function fmtDuration (hours) {
    const s = Math.round(hours * 3600)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
    return `${m}m ${String(s % 60).padStart(2, '0')}s`
  }

  function escapeHtml (s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function render () {
    const twd = renderSource('twd', state.twdLive, state.twdAt, fmtTwd)
    const tws = renderSource('tws', state.twsLive, state.twsAt, fmtTws)
    $('twaSource').textContent = twd.label
    $('stwSource').textContent = tws.label

    ensurePolar(tws.value)
    const curve = tws.value !== null ? polar.curve : null
    $('polarStatus').textContent = tws.value !== null && polar.error ? polar.error : ''
    $('polarStatus').hidden = !$('polarStatus').textContent

    const tbody = $('legs')
    const route = state.route
    if (!route || route.points.length < 2) {
      $('routeName').textContent = 'Race Plan'
      tbody.innerHTML = '<tr><td colspan="8" class="muted center">No active route</td></tr>'
      return
    }

    $('routeName').textContent = route.name
    const rows = []
    for (let i = 0; i < route.points.length - 1; i++) {
      const from = route.points[i]
      const to = route.points[i + 1]
      const brg = bearing(from, to)
      const dist = distanceNm(from, to)
      const twa = twd.value === null ? null : norm180(twd.value - brg)
      const perf = twa !== null && curve ? legPerformance(curve, twa) : null

      // pointIndex is the destination point, so the active leg ends at it
      const legEnd = i + 1
      const cls = legEnd < route.pointIndex ? 'done' : legEnd === route.pointIndex ? 'active' : ''

      const stwCell = perf
        ? `${perf.stw.toFixed(1)} kn${perf.mode === 'direct' ? '' : ` <span class="mode">${perf.mode} ${Math.round(perf.angle)}°</span>`}`
        : '<span class="placeholder">--</span>'
      const timeCell = perf && perf.made > 0
        ? fmtDuration(dist / perf.made)
        : '<span class="placeholder">--</span>'

      rows.push(`<tr class="${cls}">
        <td>${i + 1}</td>
        <td>${escapeHtml(from.name)} &rarr; ${escapeHtml(to.name)}</td>
        <td class="num">${Math.round(brg).toString().padStart(3, '0')}°</td>
        <td class="num">${dist.toFixed(2)} nm</td>
        <td class="num">${fmtTwa(twa)}</td>
        <td class="placeholder">--</td>
        <td class="num">${stwCell}</td>
        <td class="num">${timeCell}</td>
      </tr>`)
    }
    tbody.innerHTML = rows.join('')
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
          { path: 'environment.wind.angleTrueWater', period: 1000 },
          { path: 'environment.wind.speedTrue', period: 1000 },
          { path: 'navigation.headingTrue', period: 1000 },
          { path: 'navigation.course.activeRoute', policy: 'instant' }
        ]
      }))
    }

    ws.onmessage = (msg) => {
      const delta = JSON.parse(msg.data)
      if (!delta.updates) return
      let courseChanged = false
      let windChanged = false

      for (const u of delta.updates) {
        for (const { path, value } of u.values || []) {
          if (path === 'environment.wind.directionTrue' && typeof value === 'number') {
            state.directionTrueAt = Date.now()
            updateTwd(deg(value))
            windChanged = true
          } else if (path === 'environment.wind.speedTrue' && typeof value === 'number') {
            updateTws(value * KN_PER_MS)
            windChanged = true
          } else if (path === 'navigation.headingTrue' && typeof value === 'number') {
            state.heading = deg(value)
            state.headingAt = Date.now()
          } else if (path === 'environment.wind.angleTrueWater' && typeof value === 'number') {
            // Fallback when directionTrue isn't arriving
            if (!fresh(state.directionTrueAt) && state.heading !== null && fresh(state.headingAt)) {
              updateTwd(state.heading + deg(value))
              windChanged = true
            }
          } else if (path === 'navigation.course.activeRoute') {
            courseChanged = true
          }
        }
      }

      if (courseChanged) loadCourse().catch((e) => setStatus(e.message))
      else if (windChanged) render()
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
