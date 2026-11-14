// The page: camera, input, the loop, saving. The game itself is sim.js.

import * as S from './sim.js'
import * as E from './economy.js'
import { tileAt, key, unkey, centre, spacing, same, ancestor } from './lattice.js'
import { depositAt } from './world.js'
import { rateOf } from './steady.js'
import { createTerrain, AREA } from './render/terrain.js'
import { drawOverlay, fmt } from './render/overlay.js'
import { renderPanel, hintFor, HELP } from './ui.js'

const $ = id => document.getElementById(id)
const groundCanvas = $('ground'), overlayCanvas = $('overlay')
const ctx = overlayCanvas.getContext('2d')
let terrain = null
try { terrain = createTerrain(groundCanvas) } catch (e) { console.error(e) }
if (!terrain) $('nogl').hidden = false

// ---- state and saving --------------------------------------------------------------------------
const SAVE = 'hold.save.v1'
const params = new URLSearchParams(location.search)
let s = null
function load() {
  try {
    const raw = localStorage.getItem(SAVE)
    if (!raw || params.has('seed')) return null
    const { state, savedAt } = JSON.parse(raw)
    if (!state || state.v !== 1) return null
    const away = (Date.now() - savedAt) / 1000
    if (away > 30) {
      const before = state.res
      S.fastForward(state, away)
      setTimeout(() => toast(`While you were away (${fmtTime(away)}): +◆ ${fmt(state.res - before)}`), 300)
    }
    return state
  } catch { return null }
}
function save() { try { localStorage.setItem(SAVE, JSON.stringify({ state: s, savedAt: Date.now() })) } catch { } }
s = load() || S.newGame(Number(params.get('seed')) || 1)
window.addEventListener('beforeunload', save)
const fmtTime = secs => secs < 3600 ? `${Math.round(secs / 60)} min` : `${(secs / 3600).toFixed(1)} h`

// ---- camera -------------------------------------------------------------------------------------
const view = { cx: s.flag.x, cy: s.flag.y, s: 60, W: 0, H: 0, dpr: 1 }
const ui = { selected: null, selectedRegion: null, mode: null, hover: null, speed: 1, panelHtml: '', groundSig: '' }
function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  view.W = Math.round(innerWidth * view.dpr); view.H = Math.round(innerHeight * view.dpr)
  for (const c of [groundCanvas, overlayCanvas]) { c.width = view.W; c.height = view.H }
  ui.groundSig = ''
}
resize()
view.s = Math.min(view.W, view.H) / 13
window.addEventListener('resize', resize)
const sMin = () => Math.min(view.W, view.H) / (1.9 * Math.pow(7, S.maxZoomLevel(s) / 2))
const sMax = () => 170 * view.dpr
const viewLevel = () => 2 * Math.log(Math.min(view.W, view.H) / (1.9 * view.s)) / Math.log(7)
function clampView() { view.s = Math.min(Math.max(view.s, sMin()), sMax()) }
function worldAt(clientX, clientY) {
  return [view.cx + (clientX * view.dpr - view.W / 2) / view.s, view.cy - (clientY * view.dpr - view.H / 2) / view.s]
}
function zoomAt(f, clientX, clientY) {
  const [wx, wy] = worldAt(clientX, clientY)
  view.s *= f; clampView()
  view.cx = wx - (clientX * view.dpr - view.W / 2) / view.s
  view.cy = wy + (clientY * view.dpr - view.H / 2) / view.s
}
function focusFlag() { view.cx = s.flag.x; view.cy = s.flag.y }

// ---- acting ---------------------------------------------------------------------------------------
function act(r) { if (r && !r.ok && r.msg) toast(r.msg, true); return r && r.ok }
function selectedShip() { return typeof ui.selected === 'number' ? s.ships.find(x => x.id === ui.selected) : null }
function bestRoomyRegion() {
  let best = null, g = 0
  for (const [rk, r] of Object.entries(s.regions)) {
    if (!r.automated) continue
    const sl = S.slotsOf(s, rk).slots, d = rateOf(sl, r.miners + 1) - rateOf(sl, r.miners)
    if (d > g || (!best && r.automated)) { g = d; best = rk }
  }
  return best
}
const ACTIONS = {
  'buy-miner': () => { if (act(S.buyMiner(s))) { ui.selected = s.ships[s.ships.length - 1].id; ui.selectedRegion = null } },
  move: () => { ui.mode = ui.mode === 'move' ? null : 'move' },
  relay: () => act(S.buildRelay(s)),
  automate: arg => { if (act(S.automate(s, arg || S.flagRegion(s)))) ui.groundSig = '' },
  carrier: () => { if (act(S.buildCarrier(s))) { toast('Carrier built. Zoom out: it works a level up.'); ui.selected = 'flag' } },
  seeder: () => { const r = S.buildSeeder(s); if (act(r)) ui.selected = r.id },
  hub: () => act(S.buildHub(s)),
  'automate-hub': () => act(S.automateHub(s)),
  release: arg => act(S.release(s, Number(arg))),
  'join-best': arg => { const rk = bestRoomyRegion(); if (rk) act(S.joinRegion(s, Number(arg), rk)) },
  'add-miner': arg => act(S.addMinerToRegion(s, arg)),
  detach: arg => { if (act(S.detach(s, arg))) ui.selected = s.ships[s.ships.length - 1].id },
  upgrade: arg => act(S.buyUpgrade(s, arg)),
  'new-game': () => { if (confirm('Start a new game? This one will be lost.')) { localStorage.removeItem(SAVE); location.search = '?seed=' + (1 + Math.floor(Math.random() * 9999)) } },
  help: () => alert(HELP),
}
// buttons act on press, since the panel is rebuilt as resources change
$('panel').addEventListener('pointerdown', e => {
  const b = e.target.closest('button[data-act]')
  if (!b || b.disabled || e.button !== 0) return
  e.preventDefault()
  ACTIONS[b.dataset.act]?.(b.dataset.arg)
  ui.panelHtml = ''
})
$('panel').addEventListener('click', e => {           // keyboard activation
  const b = e.target.closest('button[data-act]')
  if (!b || b.disabled || e.detail !== 0) return
  ACTIONS[b.dataset.act]?.(b.dataset.arg); ui.panelHtml = ''
})
for (const b of $('speed').querySelectorAll('button')) b.addEventListener('click', () => {
  ui.speed = Number(b.dataset.speed)
  for (const o of $('speed').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b))
})

// ---- what the pointer is over ----------------------------------------------------------------------
function hitShip(wx, wy) {
  let best = null, bd = Infinity
  for (const sh of s.ships) {
    const r = sh.kind === 'seeder' ? spacing(3) * 0.4 : Math.max(0.45, 10 / view.s)
    const d = Math.hypot(sh.x - wx, sh.y - wy)
    if (d < r && d < bd) { bd = d; best = sh }
  }
  if (best && best.kind === 'miner' && view.s * 0.62 < 3) return null     // too small to see: not clickable
  return best
}
function hitFlag(wx, wy) {
  const L = S.flagLevel(s)
  return Math.hypot(s.flag.x - wx, s.flag.y - wy) < Math.max(0.62 * spacing(L), 12 / view.s)
}
function click(clientX, clientY, button) {
  const [wx, wy] = worldAt(clientX, clientY)
  const FL = S.flagLevel(s)
  if (ui.mode === 'move' || (button === 2 && ui.selected === 'flag')) {
    act(S.moveFlag(s, tileAt(wx, wy, FL))); ui.mode = null; return
  }
  const sel = selectedShip(), hit = hitShip(wx, wy)
  // with a miner selected, a deposit is an order, even if another miner is parked on it
  if (sel && sel.kind === 'miner') {
    const z0 = tileAt(wx, wy, 0)
    if (depositAt(s.seed, z0) && (!hit || hit.id === sel.id || hit.order)) { act(S.orderMine(s, sel.id, key(0, z0))); return }
  }
  if (sel && (!hit || button === 2)) {
    if (sel.kind === 'miner') {
      const rk = key(E.AUTOMATE_LEVEL, tileAt(wx, wy, E.AUTOMATE_LEVEL))
      if (s.regions[rk] && s.regions[rk].automated && !hitFlag(wx, wy)) { act(S.joinRegion(s, sel.id, rk)); return }
    } else {
      const rk = key(E.AUTOMATE_LEVEL, tileAt(wx, wy, E.AUTOMATE_LEVEL))
      if (!hitFlag(wx, wy) || button === 2) { if (act(S.orderSeed(s, sel.id, rk))) return }
    }
  }
  if (hit) { ui.selected = hit.id; ui.selectedRegion = null; return }
  if (hitFlag(wx, wy)) { ui.selected = 'flag'; ui.selectedRegion = null; return }
  ui.selected = null
  ui.selectedRegion = key(E.AUTOMATE_LEVEL, tileAt(wx, wy, E.AUTOMATE_LEVEL))
}
function hover(clientX, clientY) {
  const [wx, wy] = worldAt(clientX, clientY)
  const sel = selectedShip(), tip = $('tip')
  let target = null, text = ''
  if (ui.mode === 'move' || ui.selected === 'flag') {
    const L = S.flagLevel(s)
    target = { level: L, z: tileAt(wx, wy, L), kind: AREA.TARGET }
    text = ui.mode === 'move' ? 'Move here' : 'Right-click to move here'
  } else if (sel && sel.kind === 'seeder') {
    const z = tileAt(wx, wy, E.AUTOMATE_LEVEL), rk = key(E.AUTOMATE_LEVEL, z)
    target = { level: E.AUTOMATE_LEVEL, z, kind: AREA.TARGET }
    const sl = S.slotsOf(s, rk).slots
    text = (s.regions[rk] || {}).automated ? 'Automated already' : `Settle: +${fmt(rateOf(sl, E.SEED_MINERS))}/s with ${Math.min(E.SEED_MINERS, sl.length)} miners`
  } else if (view.s >= 10) {
    const z0 = tileAt(wx, wy, 0), d = depositAt(s.seed, z0)
    if (d) {
      const p = S.params(s), drop = S.dropFor(s, z0), dist = Math.hypot(d.xy[0] - drop[0], d.xy[1] - drop[1])
      const per = p.cargo / (2 * dist / p.speed + p.cargo / (p.rate * d.rich))
      const ctl = S.controlled(s, z0)
      text = `Deposit · ${d.slots} slot${d.slots > 1 ? 's' : ''} · richness ${d.rich.toFixed(2)} · ${ctl ? `+${fmt(per)}/s per miner` : 'outside your control'}`
      if (sel && sel.kind === 'miner') target = { level: 0, z: z0, kind: AREA.TARGET }
    }
  }
  ui.hover = target
  if (text) { tip.hidden = false; tip.textContent = text; tip.style.left = clientX + 'px'; tip.style.top = clientY + 'px' } else tip.hidden = true
}

// ---- pointer, wheel, keys -----------------------------------------------------------------------------
const pts = new Map()
let down = null, pinch = null
overlayCanvas.addEventListener('contextmenu', e => e.preventDefault())
overlayCanvas.addEventListener('pointerdown', e => {
  overlayCanvas.setPointerCapture(e.pointerId)
  pts.set(e.pointerId, [e.clientX, e.clientY])
  down = pts.size === 1 ? { x: e.clientX, y: e.clientY, button: e.button, moved: false } : null
  if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch = Math.hypot(p[0] - q[0], p[1] - q[1]) }
})
overlayCanvas.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) { hover(e.clientX, e.clientY); return }
  const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY])
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down.moved = true; overlayCanvas.classList.add('dragging') }
  if (pts.size === 1 && down && down.moved) {
    view.cx -= (e.clientX - prev[0]) * view.dpr / view.s; view.cy += (e.clientY - prev[1]) * view.dpr / view.s
  } else if (pts.size === 2 && pinch) {
    const [p, q] = [...pts.values()], d = Math.hypot(p[0] - q[0], p[1] - q[1])
    zoomAt(d / pinch, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); pinch = d
  }
})
const up = e => {
  if (down && !down.moved && e.type === 'pointerup') click(e.clientX, e.clientY, down.button)
  pts.delete(e.pointerId); if (pts.size < 2) pinch = null
  if (!pts.size) { down = null; overlayCanvas.classList.remove('dragging') }
}
overlayCanvas.addEventListener('pointerup', up)
overlayCanvas.addEventListener('pointercancel', up)
overlayCanvas.addEventListener('pointerleave', () => { $('tip').hidden = true; ui.hover = null })
overlayCanvas.addEventListener('wheel', e => {
  e.preventDefault()
  const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
  zoomAt(Math.exp(-dy * 0.0022), e.clientX, e.clientY)
}, { passive: false })
window.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return
  const step = 90 * view.dpr / view.s
  const k = e.key.toLowerCase()
  if (k === 'escape') { ui.mode = null; ui.selected = null; ui.selectedRegion = null }
  else if (k === 'm') { ui.mode = ui.mode === 'move' ? null : 'move' }
  else if (k === 'b') ACTIONS['buy-miner']()
  else if (k === 'r') ACTIONS.relay()
  else if (k === 'a') ACTIONS.automate()
  else if (k === 'f' || k === ' ') focusFlag()
  else if (k === 'tab') {
    const free = s.ships.filter(x => !x.order && x.state !== 'join')
    if (free.length) { const i = free.findIndex(x => x.id === ui.selected); const nx = free[(i + 1) % free.length]; ui.selected = nx.id; view.cx = nx.x; view.cy = nx.y }
  }
  else if (k === '+' || k === '=') zoomAt(1.4, innerWidth / 2, innerHeight / 2)
  else if (k === '-' || k === '_') zoomAt(1 / 1.4, innerWidth / 2, innerHeight / 2)
  else if (k === 'arrowleft') view.cx -= step
  else if (k === 'arrowright') view.cx += step
  else if (k === 'arrowup') view.cy += step
  else if (k === 'arrowdown') view.cy -= step
  else return
  e.preventDefault()
  ui.panelHtml = ''
})

// ---- toasts --------------------------------------------------------------------------------------
function toast(text, warn = false) {
  const el = document.createElement('div')
  el.className = 'toast' + (warn ? ' warn' : '')
  el.innerHTML = text
  $('toasts').appendChild(el)
  setTimeout(() => el.remove(), 5000)
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove()
}
const QUIET = /^(ordered|joined|miner-\d+|flag-arrived|first-delivery|seeded|detached)$/
let lastEvent = s.events.length ? s.events[s.events.length - 1].t : 0
function newEvents() {
  for (const ev of s.events) {
    if (ev.t <= lastEvent) continue
    if (!QUIET.test(ev.kind)) toast(ev.text, ev.kind === 'lost-control')
  }
  if (s.events.length) lastEvent = s.events[s.events.length - 1].t
}

// ---- the areas the ground draws ---------------------------------------------------------------------
function areas() {
  const out = []
  const reach = Math.hypot(view.W, view.H) / 2 / view.s
  const near = (z, L) => { const [x, y] = centre(z, L); return Math.hypot(x - view.cx, y - view.cy) < reach + 1.2 * spacing(L) }
  if (s.hub) out.push({ level: E.HUB_LEVEL, z: s.hub.z, kind: s.hub.automated ? AREA.HUB : s.hub.built ? AREA.HELD : AREA.BUILDING })
  for (const [rk, r] of Object.entries(s.regions)) {
    const { z } = unkey(rk)
    if (!near(z, E.AUTOMATE_LEVEL)) continue
    if (r.automated) { if (!(s.hub && s.hub.automated && same(ancestor(z, E.HUB_LEVEL - E.AUTOMATE_LEVEL), s.hub.z)) || view.s * spacing(3) > 30) out.push({ level: 3, z, kind: AREA.AUTO }) }
    else if (r.relay) out.push({ level: 3, z, kind: r.relay.built ? AREA.HELD : AREA.BUILDING })
  }
  out.push({ level: S.flagLevel(s), z: S.flagTile(s), kind: AREA.FLAG, neighbours: true })
  if (ui.selectedRegion) out.push({ level: 3, ...unkey(ui.selectedRegion), kind: AREA.SELECT })
  if (ui.hover) out.push(ui.hover)
  return out.slice(-96)
}

// ---- the loop ---------------------------------------------------------------------------------------
let last = performance.now(), acc = 0, lastPanel = 0, lastSave = performance.now(), lastMaxZoom = S.maxZoomLevel(s)
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now
  acc += dt * ui.speed
  let n = 0
  while (acc >= S.TICK && n < 400) { S.step(s, S.TICK); acc -= S.TICK; n++ }
  if (n >= 400) acc = 0
  newEvents()
  if (S.maxZoomLevel(s) > lastMaxZoom + 1e-9) { lastMaxZoom = S.maxZoomLevel(s); toast('You can zoom out further now.') }
  clampView()

  if (terrain) {
    const ar = areas()
    const sig = `${view.cx.toFixed(4)},${view.cy.toFixed(4)},${view.s.toFixed(5)},${view.W},${view.H}|` + ar.map(a => `${a.level}:${a.z}:${a.kind}`).join(';')
    if (sig !== ui.groundSig) { terrain.draw({ cx: view.cx, cy: view.cy, s: view.s, W: view.W, H: view.H, seed: s.seed, areas: ar }); ui.groundSig = sig }
  }
  drawOverlay(ctx, view, s, ui)
  overlayCanvas.classList.toggle('targeting', ui.mode === 'move' || !!selectedShip())

  if (now - lastPanel > 200) {
    lastPanel = now
    const html = renderPanel(s, ui)
    if (html !== ui.panelHtml) { $('panel').innerHTML = html; ui.panelHtml = html }
    $('res').textContent = fmt(s.res)
    $('rate').textContent = `+${fmt(S.incomeRate(s))}/s`
    const used = S.commandsUsed(s), max = S.commandsMax(s)
    $('cmds').innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < used ? 'used' : ''}"></i>`).join('') + ` <span class="dim">${used}/${max}</span>`
    $('zoom').textContent = `level ${Math.max(0, viewLevel()).toFixed(1)} of ${S.maxZoomLevel(s).toFixed(1)}`
    $('hint').innerHTML = hintFor(s, ui)
  }
  if (now - lastSave > 5000) { save(); lastSave = now }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// a handle for the console and for tests
window.hold = { get state() { return s }, S, view, ui }
