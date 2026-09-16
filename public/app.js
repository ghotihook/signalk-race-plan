(function () {
  'use strict'

  const API = '/signalk/v2/api'
  const OVERRIDE_KEY = 'race-plan.twdOverride'
  const TWD_SMOOTHING = 0.1 // EMA factor applied to the wind vector per update

  const state = {
    route: null, // { name, points: [{ name, lat, lon }], pointIndex }
    routeKey: null,
    twdLive: null, // degrees true
    twdVec: null, // smoothed { x, y }
    heading: null, // degrees true, for deriving TWD from angleTrueWater
    hasDirectionTrue: false
  }

  const $ = (id) => document.getElementById(id)
  const deg = (rad) => (rad * 180) / Math.PI
  const rad = (d) => (d * Math.PI) / 180
  const norm360 = (d) => ((d % 360) + 360) % 360
  const norm180 = (d) => { const n = norm360(d); return n > 180 ? n - 360 : n }

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

  // ---- wind -------------------------------------------------------------

  function updateTwd (twdDeg) {
    const x = Math.cos(rad(twdDeg))
    const y = Math.sin(rad(twdDeg))
    if (!state.twdVec) {
      state.twdVec = { x, y }
    } else {
      state.twdVec.x += TWD_SMOOTHING * (x - state.twdVec.x)
      state.twdVec.y += TWD_SMOOTHING * (y - state.twdVec.y)
    }
    state.twdLive = norm360(deg(Math.atan2(state.twdVec.y, state.twdVec.x)))
  }

  function activeTwd () {
    const v = $('twdOverride').value
    if (v !== '' && !isNaN(Number(v))) return norm360(Number(v))
    return state.twdLive
  }

  // ---- rendering --------------------------------------------------------

  function setStatus (text) { $('status').textContent = text }

  function fmtTwa (twa) {
    if (twa === null) return '<span class="placeholder">--</span>'
    const side = twa >= 0 ? 'stbd' : 'port'
    const label = twa >= 0 ? 'S' : 'P'
    return `<span class="${side}">${Math.round(Math.abs(twa))}° ${label}</span>`
  }

  function escapeHtml (s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function render () {
    const twd = activeTwd()
    $('twdLive').textContent = state.twdLive === null ? '--' : `${Math.round(state.twdLive)}°`

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
      const twa = twd === null ? null : norm180(twd - brg)

      // pointIndex is the destination point, so the active leg ends at it
      const legEnd = i + 1
      const cls = legEnd < route.pointIndex ? 'done' : legEnd === route.pointIndex ? 'active' : ''

      rows.push(`<tr class="${cls}">
        <td>${i + 1}</td>
        <td>${escapeHtml(from.name)} &rarr; ${escapeHtml(to.name)}</td>
        <td class="num">${Math.round(brg).toString().padStart(3, '0')}°</td>
        <td class="num">${dist.toFixed(2)} nm</td>
        <td class="num">${fmtTwa(twa)}</td>
        <td class="placeholder">--</td>
        <td class="num placeholder">--</td>
        <td class="num placeholder">--:--</td>
      </tr>`)
    }
    tbody.innerHTML = rows.join('')
  }

  // ---- stream -----------------------------------------------------------

  function connect () {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/signalk/v1/stream?subscribe=none`)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        context: 'vessels.self',
        subscribe: [
          { path: 'environment.wind.directionTrue', period: 1000 },
          { path: 'environment.wind.angleTrueWater', period: 1000 },
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
            state.hasDirectionTrue = true
            updateTwd(deg(value))
            windChanged = true
          } else if (path === 'navigation.headingTrue' && typeof value === 'number') {
            state.heading = deg(value)
          } else if (path === 'environment.wind.angleTrueWater' && typeof value === 'number') {
            // Fallback when nothing publishes directionTrue
            if (!state.hasDirectionTrue && state.heading !== null) {
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
      setStatus('Disconnected, retrying…')
      setTimeout(connect, 3000)
    }
  }

  // ---- init -------------------------------------------------------------

  try {
    const saved = localStorage.getItem(OVERRIDE_KEY)
    if (saved !== null) $('twdOverride').value = saved
  } catch (e) { /* storage unavailable */ }

  $('twdOverride').addEventListener('input', (e) => {
    try { localStorage.setItem(OVERRIDE_KEY, e.target.value) } catch (err) { /* ignore */ }
    render()
  })

  loadCourse().catch((e) => setStatus(e.message))
  setInterval(() => loadCourse().catch((e) => setStatus(e.message)), 15000)
  connect()
})()
