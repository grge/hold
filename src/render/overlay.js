// Everything that moves, drawn over the ground in 2D: ships, flagships, relays, seeders, the slots of
// deposits. Each thing is drawn as the Gosper tile it occupies (a miner a level-0 tile, a mothership
// a level-1 tile, a seeder a level-3 tile...). Below a certain size on screen a ship is no longer
// drawn: you see the field of control, not the ships.

import { outline, centre, unkey, key, tileAt, descendants, spacing } from '../lattice.js'
import { depositsIn } from '../world.js'
import { decorativeShips } from '../steady.js'
import * as S from '../sim.js'
import * as E from '../economy.js'

const INK = '#0b0f14', PALE = '#ece6d6', AMBER = '#f4a84c', TEAL = '#4fd8c8', VIOLET = '#b48cff'

export function drawOverlay(ctx, view, s, ui) {
  const { cx, cy, s: k, W, H } = view
  const X = x => W / 2 + (x - cx) * k, Y = y => H / 2 - (y - cy) * k
  const margin = 40
  const onScreen = (x, y, r = 0) => X(x) > -margin - r * k && X(x) < W + margin + r * k && Y(y) > -margin - r * k && Y(y) < H + margin + r * k
  ctx.clearRect(0, 0, W, H)
  ctx.lineJoin = 'round'

  // a Gosper tile of level L, centred at (x, y), scaled by f
  const tile = (L, x, y, f = 1) => {
    const pts = outline(L, L >= 3 ? L - 3 : undefined)
    ctx.beginPath()
    pts.forEach(([px, py], i) => { const sx = X(x + px * f), sy = Y(y + py * f); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy) })
    ctx.closePath()
  }
  const shipPx = k * 0.62                           // a miner's size on screen
  const showShips = shipPx >= 3

  // ---- regions: relays, automated miners, labels ----
  const regionScale = spacing(E.AUTOMATE_LEVEL)
  for (const [rk, r] of Object.entries(s.regions)) {
    const { z } = unkey(rk)
    const [x, y] = centre(z, E.AUTOMATE_LEVEL)
    if (!onScreen(x, y, regionScale)) continue
    // an automated region's ships are its coarse state, drawn: they appear only close up, plainly
    if (r.automated && shipPx >= 6) {
      const info = S.slotsOf(s, rk)
      const ships = decorativeShips(s.seed, rk, info, r.miners, s.t)
      if (shipPx < 16) {
        ctx.fillStyle = 'rgba(79,216,200,0.75)'
        const d = Math.max(2, shipPx * 0.22)
        for (const sh of ships) if (onScreen(sh.x, sh.y)) ctx.fillRect(X(sh.x) - d / 2, Y(sh.y) - d / 2, d, d)
      } else for (const sh of ships) drawMiner(sh, 0.85, TEAL)
    }
    if (r.relay) drawRelay(x, y, r, rk === ui.selectedRegion)
    if (r.automated && k * regionScale > 120 && k * regionScale < 1400) {
      label(`+${fmt(S.regionRate(s, rk))}/s · ${r.miners}`, x, y - spacing(1) * 1.15, TEAL, 11)
    }
  }
  if (s.hub) {
    const [x, y] = centre(s.hub.z, E.HUB_LEVEL)
    if (onScreen(x, y, spacing(4))) {
      tile(3, x, y, 1)
      ctx.fillStyle = 'rgba(11,15,20,0.78)'; ctx.fill()
      ctx.lineWidth = 2; ctx.strokeStyle = s.hub.automated ? TEAL : AMBER; ctx.stroke()
      if (!s.hub.built) progressRing(x, y, spacing(3) * 0.7, s.hub.progress, AMBER)
      label(s.hub.automated ? `Hub · ${s.hub.next}/${s.hub.order.length} seeded` : s.hub.built ? 'Hub: ready to automate' : 'Hub', x, y, s.hub.automated ? TEAL : AMBER, 12)
    }
  }

  // ---- deposits: their slots, filled when a miner is working them ----
  if (k >= 12) {
    const busy = new Map()
    for (const sh of s.ships) if (sh.state === 'mine') busy.set(sh.order, (busy.get(sh.order) || 0) + 1)
    const seenRegions = new Set()
    const corners = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]]
    for (const [sx, sy] of corners) {
      const wx = cx + (sx - W / 2) / k, wy = cy - (sy - H / 2) / k
      const t3 = tileAt(wx, wy, E.AUTOMATE_LEVEL)
      for (const n of [t3, ...[[1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1], [0, -1]].map(([a, b]) => [t3[0] + a, t3[1] + b])]) seenRegions.add(key(3, n))
    }
    for (const rk of seenRegions) {
      const r = s.regions[rk]
      const deps = depositsIn(s.seed, unkey(rk).z, 3)
      const auto = r && r.automated ? S.slotsOf(s, rk).slots.slice(0, r.miners) : []
      for (const d of deps) {
        const [x, y] = d.xy
        if (!onScreen(x, y, 1)) continue
        const used = (busy.get(d.key) || 0) + auto.filter(sl => sl.deposit.key === d.key).length
        for (let i = 0; i < d.slots; i++) {
          const a = Math.PI / 2 + (i - (d.slots - 1) / 2) * 0.55
          const px = X(x) + Math.cos(a) * k * 0.55, py = Y(y) - Math.sin(a) * k * 0.55
          ctx.beginPath(); ctx.arc(px, py, Math.max(2, k * 0.07), 0, Math.PI * 2)
          ctx.fillStyle = i < used ? (auto.length ? TEAL : AMBER) : 'rgba(11,15,20,0.85)'
          ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = VIOLET; ctx.stroke()
        }
      }
    }
  }

  // ---- the flagship ----
  const FL = S.flagLevel(s)
  if (s.flag.dest) {
    const [tx, ty] = centre(s.flag.dest, FL)
    ctx.setLineDash([8, 8]); ctx.strokeStyle = 'rgba(244,168,76,0.7)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(X(s.flag.x), Y(s.flag.y)); ctx.lineTo(X(tx), Y(ty)); ctx.stroke(); ctx.setLineDash([])
    tile(FL, tx, ty, 1); ctx.strokeStyle = 'rgba(244,168,76,0.45)'; ctx.stroke()
  }
  const flagPx = k * spacing(FL)
  if (flagPx > 4) {
    tile(FL, s.flag.x, s.flag.y, 0.94)
    ctx.fillStyle = s.flag.tier === 1 ? 'rgba(14,18,24,0.88)' : 'rgba(14,18,24,0.28)'; ctx.fill()
    ctx.lineWidth = ui.selected === 'flag' ? 3.5 : 2.2; ctx.strokeStyle = ui.selected === 'flag' ? '#fff' : AMBER; ctx.stroke()
    // an emblem: rings, one per tier
    for (let i = 0; i < s.flag.tier + 1; i++) {
      ctx.beginPath(); ctx.arc(X(s.flag.x), Y(s.flag.y), Math.max(2, flagPx * (0.12 + 0.09 * i)), 0, Math.PI * 2)
      ctx.strokeStyle = AMBER; ctx.lineWidth = 1.5; ctx.stroke()
    }
    if (flagPx > 50) label(E.FLAGSHIPS[s.flag.tier].name, s.flag.x, s.flag.y - spacing(FL) * 0.62, AMBER, 12)
  } else {
    ctx.beginPath(); ctx.arc(X(s.flag.x), Y(s.flag.y), 4, 0, Math.PI * 2); ctx.fillStyle = AMBER; ctx.fill()
  }

  // ---- commanded and idle ships ----
  const sel = ui.selected
  for (const sh of s.ships) {
    if (sh.kind === 'miner') {
      if (!showShips) continue
      if (sh.id === sel && sh.order) {
        const d = unkey(sh.order).z, [dx, dy] = centre(d, 0)
        ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(244,168,76,0.8)'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(X(sh.x), Y(sh.y)); ctx.lineTo(X(dx), Y(dy)); ctx.stroke(); ctx.setLineDash([])
      }
      drawMiner(sh, 1, sh.order ? AMBER : PALE, sh.id === sel, sh.state === 'join')
    } else {
      const R = spacing(3)
      if (k * R * 0.5 < 3) continue
      tile(3, sh.x, sh.y, 0.5)
      ctx.fillStyle = 'rgba(236,230,214,0.9)'; ctx.fill()
      ctx.lineWidth = sh.id === sel ? 3 : 1.5; ctx.strokeStyle = sh.id === sel ? '#fff' : AMBER; ctx.stroke()
      if (sh.state === 'est') progressRing(sh.x, sh.y, R * 0.45, sh.progress, AMBER)
      if (sh.id === sel && sh.order) {
        const [tx, ty] = centre(unkey(sh.order).z, E.AUTOMATE_LEVEL)
        ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(244,168,76,0.8)'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(X(sh.x), Y(sh.y)); ctx.lineTo(X(tx), Y(ty)); ctx.stroke(); ctx.setLineDash([])
      }
    }
  }

  function drawMiner(sh, alpha, colour, selected = false, joining = false) {
    const x = sh.x, y = sh.y
    if (!onScreen(x, y)) return
    if (shipPx < 7) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = colour; ctx.fillRect(X(x) - 1.5, Y(y) - 1.5, 3, 3)
      ctx.globalAlpha = 1
      return
    }
    ctx.globalAlpha = alpha
    tile(0, x, y, 0.42)
    ctx.fillStyle = 'rgba(11,15,20,0.85)'; ctx.fill()
    ctx.lineWidth = selected ? 2.5 : 1.4; ctx.strokeStyle = selected ? '#fff' : colour; ctx.stroke()
    // nose, pointing where it flies
    const nx = X(x + sh.hx * 0.32), ny = Y(y + sh.hy * 0.32)
    ctx.beginPath(); ctx.arc(nx, ny, Math.max(1.5, k * 0.05), 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill()
    if (sh.cargo > 0) {
      const f = sh.id ? Math.min(1, sh.cargo / S.params(s).cargo) : sh.cargo   // decorative ships carry a fraction
      ctx.beginPath(); ctx.arc(X(x), Y(y), Math.max(1.5, k * 0.11 * f + 1), 0, Math.PI * 2); ctx.fillStyle = VIOLET; ctx.fill()
    }
    if (joining) { ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(X(x), Y(y), k * 0.36, 0, Math.PI * 2); ctx.strokeStyle = TEAL; ctx.stroke(); ctx.setLineDash([]) }
    ctx.globalAlpha = 1
  }
  function drawRelay(x, y, r, selected) {
    const px = k * spacing(1)
    const colour = r.automated ? TEAL : AMBER
    if (px < 5) { ctx.beginPath(); ctx.arc(X(x), Y(y), 3, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill(); return }
    tile(1, x, y, 0.7)
    ctx.fillStyle = 'rgba(11,15,20,0.9)'; ctx.fill()
    ctx.lineWidth = selected ? 3 : 1.8; ctx.strokeStyle = selected ? '#fff' : colour; ctx.stroke()
    // a mast: a small diamond
    const d = Math.max(3, px * 0.12)
    ctx.beginPath(); ctx.moveTo(X(x), Y(y) - d); ctx.lineTo(X(x) + d, Y(y)); ctx.lineTo(X(x), Y(y) + d); ctx.lineTo(X(x) - d, Y(y)); ctx.closePath()
    ctx.fillStyle = colour; ctx.fill()
    if (!r.relay.built) progressRing(x, y, spacing(1) * 0.55, r.relay.progress, AMBER)
  }
  function progressRing(x, y, R, f, colour) {
    ctx.beginPath(); ctx.arc(X(x), Y(y), Math.max(6, R * k), -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * f)
    ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.stroke()
  }
  function label(text, x, y, colour, size) {
    ctx.font = `600 ${size * view.dpr}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 4 * view.dpr; ctx.strokeStyle = 'rgba(8,11,15,0.85)'; ctx.strokeText(text, X(x), Y(y))
    ctx.fillStyle = colour; ctx.fillText(text, X(x), Y(y))
  }
}

export function fmt(n) {
  if (n < 10) return n.toFixed(1)
  if (n < 1e4) return Math.round(n).toLocaleString('en-AU')
  const units = ['k', 'M', 'B', 'T']
  let i = -1
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++ }
  return (n < 100 ? n.toFixed(1) : Math.round(n)) + units[i]
}
