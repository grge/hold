// The terrain lab's page: camera, controls, the phase portrait and the per-level phase bars.
import { TOP, MINL, MAX_PHASES, RULES, DEFAULTS, chain, phaseOf, effCentroid, createRenderer } from './cascade.js'

const $ = id => document.getElementById(id)
const clone = x => JSON.parse(JSON.stringify(x))

// ---- presets ---------------------------------------------------------------------------------
const PRESETS = {
  'Default': DEFAULTS,
  'Islands': { ...DEFAULTS, pull: 0.35, edge: 2.2, drift: 4, jitter: 1, phases: [
    { name: 'Sea',    color: '#1f3550', rule: 'calm',      amp: 0.3, to: 1, c: [-0.4, -0.2, 0] },
    { name: 'Reef',   color: '#4fb3a6', rule: 'nucleate',  amp: 1.1, to: 2, c: [0.35, 0.1, 0.1] },
    { name: 'Crown',  color: '#d8c36a', rule: 'turbulent', amp: 0.8, to: -1, c: [0.8, 0.5, 0.3] },
  ] },
  'Strata': { ...DEFAULTS, jitter: 0.06, twist: 1, drift: 14, edge: 0.6, phases: [
    { name: 'Ash',    color: '#6b6f78', rule: 'banded', amp: 0.9, to: -1, c: [0, 0, 0] },
    { name: 'Rust',   color: '#b0603a', rule: 'banded', amp: 0.9, to: -1, c: [0.6, 0.2, 0.1] },
    { name: 'Bone',   color: '#d9d0b8', rule: 'calm',   amp: 0.4, to: -1, c: [-0.5, 0.5, -0.1] },
    { name: 'Tar',    color: '#1c1a1e', rule: 'banded', amp: 0.7, to: -1, c: [-0.3, -0.6, 0.2] },
  ] },
  'Foam': { ...DEFAULTS, gain: 0.9, pull: 0.12, edge: 0.8, phases: [
    { name: 'Film',   color: '#7bc4d8', rule: 'turbulent', amp: 0.6, to: -1, c: [0, 0, 0] },
    { name: 'Cell',   color: '#253c66', rule: 'calm',      amp: 0.8, to: 2,  c: [0.7, 0.3, 0] },
    { name: 'Spore',  color: '#e07a9f', rule: 'nucleate',  amp: 1.3, to: 3,  c: [-0.5, 0.6, 0.3] },
    { name: 'Lacuna', color: '#0e1118', rule: 'calm',      amp: 1.0, to: 0,  c: [-0.3, -0.5, -0.2] },
  ] },
  'Scale shift': { ...DEFAULTS, gain: 0.3, drift: 28, pull: 0.08, edge: 1.5 },
}

// ---- state -------------------------------------------------------------------------------------
let P = clone(DEFAULTS)
const D = { mode: 0, offset: 1, memory: 0.5, shade: 0.8, lines: true, contours: false, grid: false, halfres: false }
const view = { cx: 0, cy: 0, s: 1 }
const ui = { res: 1, movedAt: 0, hover: null, samples: [], cSlice: 0 }

function homeView() { const r = $('view').getBoundingClientRect(); view.cx = 0; view.cy = 0; view.s = Math.min(r.width, r.height) / (2.2 * Math.pow(7, 3)) }

function load() {
  const m = location.hash.match(/^#(.+)$/)
  if (!m) return false
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))))
    if (o.P) P = { ...clone(DEFAULTS), ...o.P }
    if (o.D) Object.assign(D, o.D)
    if (o.v) Object.assign(view, o.v)
    return !!o.v
  } catch { return false }
}
let saveT = 0
function save() {
  clearTimeout(saveT)
  saveT = setTimeout(() => {
    const v = { cx: +view.cx.toFixed(3), cy: +view.cy.toFixed(3), s: +view.s.toPrecision(5) }
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify({ P, D, v })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    history.replaceState(null, '', '#' + enc)
  }, 300)
}

// ---- rendering ---------------------------------------------------------------------------------
const canvas = $('view')
let R
try { R = createRenderer(canvas) } catch (e) { console.error(e) }
if (!R) { $('nogl').hidden = false; $('nogl').textContent = 'This page needs WebGL 2.' }

const finest = s => Math.min(TOP - 1, Math.max(MINL, Math.ceil(2 * Math.log(1.2 / s) / Math.log(7))))
const viewLevel = () => Math.min(TOP, finest(view.s) + D.offset)
let frameQueued = false, settleT = 0
function changed(what = 'all') {
  if (what !== 'hover') { save(); scheduleStats() }
  if (!frameQueued) { frameQueued = true; requestAnimationFrame(frame) }
}
function frame() {
  frameQueued = false
  const r = canvas.getBoundingClientRect()
  const moving = D.halfres && performance.now() - ui.movedAt < 180   // optional: half resolution while the camera moves
  ui.res = moving ? 0.5 : 1
  const W = Math.max(1, Math.round(r.width * ui.res)), H = Math.max(1, Math.round(r.height * ui.res))
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
  if (R) R.draw({ cx: view.cx, cy: view.cy, s: view.s * ui.res, W, H }, P, D)
  if (moving) { clearTimeout(settleT); settleT = setTimeout(() => changed('hover'), 200) }
  hud()
  drawPortrait()
}
function hud() {
  const r = canvas.getBoundingClientRect()
  const screenL = 2 * Math.log(Math.min(r.width, r.height) / view.s) / Math.log(7)
  $('hud').innerHTML = `screen ≈ level <b>${screenL.toFixed(1)}</b> · finest drawn <b>${finest(view.s)}</b> · colours from level <b>${viewLevel()}</b>`
}

// ---- camera ------------------------------------------------------------------------------------
const pointers = new Map()
let pinch = null
const toWorld = (mx, my) => {
  const r = canvas.getBoundingClientRect()
  return [view.cx + (mx - r.left - r.width / 2) / view.s, view.cy - (my - r.top - r.height / 2) / view.s]
}
function clampView() {
  view.s = Math.min(700, Math.max(0.03, view.s))
  view.cx = Math.max(-25000, Math.min(25000, view.cx)); view.cy = Math.max(-25000, Math.min(25000, view.cy))
}
function zoomAt(mx, my, f) {
  const [wx, wy] = toWorld(mx, my)
  view.s *= f; clampView()
  const [nx, ny] = toWorld(mx, my)
  view.cx += wx - nx; view.cy += wy - ny
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); canvas.classList.add('drag')
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]) }
})
canvas.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId)
  if (prev) {
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1])
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch); pinch = d
    } else if (pointers.size === 1) {
      view.cx -= (e.clientX - prev[0]) / view.s; view.cy += (e.clientY - prev[1]) / view.s; clampView()
    }
    ui.movedAt = performance.now(); changed()
  }
  ui.hover = toWorld(e.clientX, e.clientY); readout()
})
const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) canvas.classList.remove('drag') }
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up)
canvas.addEventListener('pointerleave', () => { ui.hover = null; readout() })
canvas.addEventListener('wheel', e => {
  e.preventDefault()
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)))
  ui.movedAt = performance.now(); changed()
}, { passive: false })
addEventListener('resize', () => changed())

// ---- the cursor's chain ------------------------------------------------------------------------
const f2 = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2)
function readout() {
  drawPortrait()
  if (!ui.hover) { $('readout').textContent = 'Hover over the terrain.'; return }
  const c = chain(P, ui.hover[0], ui.hover[1], finest(view.s)), Lv = viewLevel()
  $('readout').innerHTML = 'level  phase       p     a     c\n' + c.map(({ L, s, k }) => {
    const ph = P.phases[k]
    const name = ph.name.slice(0, 8).padEnd(8)
    return `${L === Lv ? '▸' : ' '}${String(L).padStart(3)}   <span class="sw" style="background:${ph.color}"></span> ${name} ${f2(s[0])} ${f2(s[1])} ${f2(s[2])}`
  }).join('\n')
}

// ---- statistics: random points in view, their chains ---------------------------------------
let statsT = 0
function scheduleStats() { clearTimeout(statsT); statsT = setTimeout(stats, 120) }
function stats() {
  const r = canvas.getBoundingClientRect(), N = 900
  let a = 0x2545f491
  const rnd = () => (a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) ^ Math.imul(a ^ (a >>> 12), 0x297a2d39), ((a ^ (a >>> 15)) >>> 0) / 4294967296)
  const out = []
  for (let i = 0; i < N; i++) {
    const x = view.cx + (rnd() - 0.5) * r.width / view.s, y = view.cy + (rnd() - 0.5) * r.height / view.s
    out.push(chain(P, x, y, MINL))
  }
  ui.samples = out
  drawPortrait(); drawBars()
}

function setupCanvas(c, h) {
  const dpr = devicePixelRatio || 1, w = c.clientWidth
  h = h ?? w
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + 'px' }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return [g, w, h]
}

// The phase portrait: state space (p across, a up) at the view level, with the phase diagram as it
// stands at that level (a slice at the samples' mean c), the samples, the centroids (drag them), and
// the cursor's chain as a path through the levels.
const RANGE = 1.6
function drawPortrait() {
  const c = $('portrait'), [g, w] = setupCanvas(c), Lv = viewLevel()
  const X = p => (p / RANGE + 1) * w / 2, Y = a => (1 - a / RANGE) * w / 2
  const at = ui.samples.map(ch => ch.find(e => e.L === Lv)).filter(e => e && e.k < P.phases.length)   // samples can predate a phase being removed
  ui.cSlice = at.length ? at.reduce((t, e) => t + e.s[2], 0) / at.length : 0
  g.clearRect(0, 0, w, w)
  const n = 64, cell = w / n
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = ((i + 0.5) / n * 2 - 1) * RANGE, a = (1 - (j + 0.5) / n * 2) * RANGE
    g.fillStyle = P.phases[phaseOf(P, [p, a, ui.cSlice], Lv).k].color
    g.globalAlpha = 0.28; g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5)
  }
  g.globalAlpha = 1
  g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(X(0), 0); g.lineTo(X(0), w); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke()
  for (const e of at) { g.fillStyle = P.phases[e.k].color; g.fillRect(X(e.s[0]) - 1, Y(e.s[1]) - 1, 2.2, 2.2) }
  if (ui.hover) {
    const ch = chain(P, ui.hover[0], ui.hover[1], MINL)
    g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; g.beginPath()
    ch.forEach((e, i) => i ? g.lineTo(X(e.s[0]), Y(e.s[1])) : g.moveTo(X(e.s[0]), Y(e.s[1]))); g.stroke()
    for (const e of ch) {
      g.fillStyle = P.phases[e.k].color; g.strokeStyle = e.L === Lv ? '#fff' : '#000a'; g.lineWidth = e.L === Lv ? 2 : 1
      g.beginPath(); g.arc(X(e.s[0]), Y(e.s[1]), e.L === Lv ? 4.5 : e.L === TOP ? 3.5 : 2.5, 0, 7); g.fill(); g.stroke()
    }
  }
  g.font = '11px system-ui, sans-serif'; g.textBaseline = 'middle'
  P.phases.forEach((ph, k) => {
    const [p, a] = effCentroid(P, k, Lv), x = X(p), y = Y(a)
    g.fillStyle = ph.color; g.strokeStyle = '#fff'; g.lineWidth = 1.5
    g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.stroke()
    g.fillStyle = '#e8ebf0'; g.fillText(ph.name, x + 9, y)
  })
  $('portraitNote').textContent = `Level ${Lv}: p across, a up, slice at c = ${ui.cSlice.toFixed(2)}. Drag a centroid to move it.`
}
{
  const c = $('portrait'); let drag = -1
  const pos = e => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width * 2 - 1) * RANGE, (1 - (e.clientY - r.top) / r.height * 2) * RANGE] }
  c.addEventListener('pointerdown', e => {
    const [p, a] = pos(e), Lv = viewLevel(), r = c.getBoundingClientRect()
    let best = 12 / r.width * 2 * RANGE
    P.phases.forEach((_, k) => { const [x, y] = effCentroid(P, k, Lv), d = Math.hypot(x - p, y - a); if (d < best) { best = d; drag = k } })
    if (drag >= 0) c.setPointerCapture(e.pointerId)
  })
  c.addEventListener('pointermove', e => {
    if (drag < 0) return
    const [p, a] = pos(e), t = P.drift * Math.PI / 180 * viewLevel()   // back into the phase's own frame
    P.phases[drag].c[0] = +(Math.cos(t) * p - Math.sin(t) * a).toFixed(3)
    P.phases[drag].c[1] = +(Math.sin(t) * p + Math.cos(t) * a).toFixed(3)
    syncPhaseInputs(); changed()
  })
  const end = () => { drag = -1 }
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end)
}

// Phases by level: for each level, the share of the sampled points in each phase.
function drawBars() {
  const rows = TOP - MINL + 1, rh = 13, c = $('bars'), [g, w] = setupCanvas(c, rows * rh + 4), Lv = viewLevel()
  const left = 26
  g.clearRect(0, 0, w, rows * rh + 4)
  g.font = '10.5px ui-monospace, monospace'; g.textBaseline = 'middle'
  for (let i = 0; i < rows; i++) {
    const L = TOP - i, y = 2 + i * rh
    const count = new Array(P.phases.length).fill(0)
    for (const ch of ui.samples) { const e = ch[i]; if (e && e.k < count.length) count[e.k]++ }
    const tot = count.reduce((a, b) => a + b, 0) || 1
    let x = left
    count.forEach((n, k) => { const bw = (w - left - 4) * n / tot; g.fillStyle = P.phases[k].color; g.fillRect(x, y + 1, bw, rh - 2); x += bw })
    g.fillStyle = L === Lv ? '#e6b45c' : '#8a93a3'; g.fillText(String(L).padStart(3), 2, y + rh / 2)
    if (L === Lv) { g.strokeStyle = '#e6b45c'; g.lineWidth = 1.5; g.strokeRect(left - 0.5, y + 0.5, w - left - 3, rh - 1) }
  }
}

// ---- controls ----------------------------------------------------------------------------------
function slider(host, obj, key, label, min, max, step, fmt = v => (+v).toFixed(2), idx) {
  const row = document.createElement('div'); row.className = 'row'
  const id = 'r' + Math.random().toString(36).slice(2)
  row.innerHTML = `<label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><output></output>`
  const inp = row.querySelector('input'), out = row.querySelector('output')
  const get = () => idx === undefined ? obj()[key] : obj()[key][idx]
  const show = () => { inp.value = get(); out.textContent = fmt(get()) }
  inp.addEventListener('input', () => { const v = +inp.value; if (idx === undefined) obj()[key] = v; else obj()[key][idx] = v; out.textContent = fmt(v); changed() })
  row.sync = show; show(); host.appendChild(row)
  return row
}
const syncers = []
function buildStatic() {
  const vr = $('viewRows'), cr = $('cascadeRows')
  syncers.push(slider(vr, () => D, 'offset', 'Coarsen by', 0, 4, 1, v => v + (v == 1 ? ' level' : ' levels')))
  syncers.push(slider(vr, () => D, 'memory', 'Parent tint', 0, 1, 0.05))
  syncers.push(slider(vr, () => D, 'shade', 'Shading', 0, 1.5, 0.05))
  const deg = v => (+v).toFixed(0) + '°'
  for (const [k, l, a, b, st, f] of [
    ['gain', 'Gain', 0, 1.5, 0.01], ['decay', 'Decay / level', 0.6, 1, 0.005, v => (+v).toFixed(3)],
    ['pull', 'Pull to centroid', 0, 0.8, 0.01], ['edge', 'Edge turbulence', 0, 4, 0.05],
    ['drift', 'Diagram drift', -40, 40, 0.5, v => (+v).toFixed(1) + '°'], ['twist', 'Twist (local frame)', 0, 1, 0.01],
    ['jitter', 'Orientation jitter', 0, 1, 0.01], ['orient', 'Orientation', 0, 180, 1, deg],
    ['rootAmp', 'Root spread', 0, 1.5, 0.01],
    ['warp', 'Warp', 0, 1, 0.01],
  ]) syncers.push(slider(cr, () => P, k, l, a, b, st, f))
  ;['p', 'a', 'c'].forEach((n, i) => syncers.push(slider(cr, () => P, 'root', 'Root ' + n, -1, 1, 0.01, undefined, i)))
  for (const k of ['lines', 'contours', 'grid', 'halfres']) $(k).addEventListener('change', () => { D[k] = $(k).checked; changed() })
  $('mode').addEventListener('change', () => { D.mode = +$('mode').value; changed() })
  $('seed').addEventListener('input', () => { P.seed = Math.max(0, Math.floor(+$('seed').value || 0)); changed() })
  $('reseed').onclick = () => { P.seed = Math.floor(Math.random() * 1e6); syncAll(); changed() }
  const sel = $('preset')
  sel.innerHTML = '<option value="">Presets…</option>' + Object.keys(PRESETS).map(n => `<option>${n}</option>`).join('')
  sel.onchange = () => { if (!sel.value) return; P = { ...clone(PRESETS[sel.value]), seed: P.seed }; sel.value = ''; syncAll(); changed() }
  $('addPhase').onclick = () => {
    if (P.phases.length >= MAX_PHASES) return
    P.phases.push({ name: 'Phase ' + (P.phases.length + 1), color: randColor(), rule: 'calm', amp: 0.4, to: -1, c: [rr(), rr(), rr()] })
    buildPhases(); changed()
  }
  $('randomise').onclick = () => {
    const n = 3 + Math.floor(Math.random() * 4), h0 = Math.random() * 360
    P.phases = Array.from({ length: n }, (_, k) => {
      const rule = RULES[Math.floor(Math.random() * 4)]
      return { name: NAMES[Math.floor(Math.random() * NAMES.length)], color: hsl((h0 + k * 360 / n + Math.random() * 30) % 360, 35 + Math.random() * 35, 22 + Math.random() * 40),
        rule, amp: +({ calm: 0.3, nucleate: 1, banded: 0.8, turbulent: 1.1 }[rule] * (0.7 + Math.random() * 0.6)).toFixed(2),
        to: Math.random() < 0.3 ? Math.floor(Math.random() * n) : -1, c: [rr(), rr(), rr()] }
    })
    buildPhases(); changed()
  }
  $('copy').onclick = () => copy(location.href, 'Link copied.')
  $('json').onclick = () => copy(JSON.stringify(P, null, 1), 'Settings copied as JSON.')
  $('paste').onclick = async () => {
    let t = ''
    try { t = await navigator.clipboard.readText() } catch { t = prompt('Paste settings JSON') || '' }
    try { P = { ...clone(DEFAULTS), ...JSON.parse(t) }; syncAll(); changed(); msg('Settings pasted.') } catch { msg('That wasn’t settings JSON.') }
  }
  $('home').onclick = () => { homeView(); changed() }
  $('toggle').onclick = () => { document.body.classList.toggle('collapsed'); changed() }
}
const rr = () => +(Math.random() * 1.6 - 0.8).toFixed(2)
const NAMES = ['Mire', 'Lattice', 'Glass', 'Pith', 'Rime', 'Gall', 'Wick', 'Sump', 'Frond', 'Calx', 'Nacre', 'Scree', 'Bract', 'Lumen', 'Tuff', 'Weft']
const hsl = (h, s, l) => {
  s /= 100; l /= 100
  const f = n => { const k = (n + h / 30) % 12, c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0') }
  return '#' + f(0) + f(8) + f(4)
}
const randColor = () => hsl(Math.random() * 360, 45, 45)
async function copy(text, ok) {
  try { await navigator.clipboard.writeText(text); msg(ok) } catch { prompt('Copy this:', text) }
}
let msgT = 0
function msg(t) { $('msg').textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { $('msg').textContent = '' }, 2500) }

let phaseRows = []
function buildPhases() {
  const host = $('phases'); host.innerHTML = ''; phaseRows = []
  P.phases.forEach((ph, k) => {
    const card = document.createElement('div'); card.className = 'phase'
    card.innerHTML = `<div class="head"><input type="color" value="${ph.color}" title="Colour"><input type="text" value="${ph.name}" aria-label="Name"><button title="Remove">×</button></div>
      <div class="sel"><select title="How its children split">${RULES.map(r => `<option ${r === ph.rule ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select title="Where its pushes aim">${['<option value="-1">pushes: random</option>', ...P.phases.map((q, i) => `<option value="${i}" ${i === ph.to ? 'selected' : ''}>pushes toward ${q.name}</option>`)].join('')}</select></div>`
    const [col, name, del] = card.querySelectorAll('.head > *'), [rule, to] = card.querySelectorAll('select')
    col.oninput = () => { ph.color = col.value; changed() }
    name.oninput = () => { ph.name = name.value; changed() }
    name.onchange = () => buildPhases()
    del.onclick = () => {
      if (P.phases.length <= 2) return
      P.phases.splice(k, 1)
      for (const q of P.phases) q.to = q.to === k ? -1 : q.to > k ? q.to - 1 : q.to
      buildPhases(); changed()
    }
    rule.onchange = () => { ph.rule = rule.value; changed() }
    to.onchange = () => { ph.to = +to.value; changed() }
    const rows = [slider(card, () => ph, 'amp', 'Push', 0, 2, 0.01)]
    ;['p', 'a', 'c'].forEach((n, i) => rows.push(slider(card, () => ph, 'c', 'Centre ' + n, -1.4, 1.4, 0.01, undefined, i)))
    phaseRows.push(...rows)
    host.appendChild(card)
  })
}
function syncPhaseInputs() { for (const r of phaseRows) r.sync() }
function syncAll() {
  for (const r of syncers) r.sync()
  $('seed').value = P.seed; $('mode').value = D.mode
  for (const k of ['lines', 'contours', 'grid', 'halfres']) $(k).checked = D[k]
  buildPhases()
}

// ---- start -------------------------------------------------------------------------------------
const hadView = load()
if (!hadView) homeView()
buildStatic(); syncAll()
changed()
window.lab = { P: () => P, D, view, chain, changed, setP: p => { P = p; syncAll(); changed() } }
