// The side panel, the hint line and the toasts. The panel is rebuilt a few times a second from the
// state; its buttons carry data-act names that main.js dispatches.

import * as S from './sim.js'
import * as E from './economy.js'
import { unkey, key, tileAt } from './lattice.js'
import { depositsIn, depositAt } from './world.js'
import { rateOf } from './steady.js'
import { fmt } from './render/overlay.js'

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
function btn(act, label, { cost = null, sub = '', disabled = false, cls = '', arg = '' } = {}) {
  return `<button class="act ${cls}" data-act="${act}" data-arg="${esc(arg)}" ${disabled ? 'disabled' : ''}>
    <span>${label}${sub ? `<span class="sub">${sub}</span>` : ''}</span>${cost !== null ? `<span class="cost">◆ ${fmt(cost)}</span>` : ''}</button>`
}

export function renderPanel(s, ui) {
  const c = S.costs(s), res = s.res
  const FL = E.FLAGSHIPS[s.flag.tier]
  const parts = []

  // ---- the flagship ----
  const rk = S.flagRegion(s), r = s.regions[rk]
  let f = `<section><h2>${FL.name}</h2>`
  f += `<p>${s.flag.dest ? 'Moving…' : 'Holding its area: the amber outline.'}</p>`
  f += btn('buy-miner', 'Build miner <kbd>B</kbd>', { cost: c.miner, disabled: res < c.miner, sub: 'Commands: one each, while you direct it' })
  f += btn('move', ui.mode === 'move' ? 'Click where to go… <kbd>Esc</kbd>' : 'Move <kbd>M</kbd>', { sub: s.flag.tier === 1 ? 'one level-1 tile at a time' : 'the carrier moves a level-4 tile at a time' })
  if (s.flag.tier === 1) {
    if (!r || !r.relay) {
      const slots = S.slotsOf(s, rk).slots.length
      f += btn('relay', 'Build relay <kbd>R</kbd>', { cost: c.relay, disabled: res < c.relay || !!s.flag.dest, sub: `Holds this whole region (${slots} mining slots), so it can be automated` })
    } else if (!r.relay.built) {
      f += `<p>Relay building… ${Math.round(r.relay.progress * 100)}%</p>`
    } else if (!r.automated) {
      f += btn('automate', 'Automate this region <kbd>A</kbd>', { cls: 'teal big', arg: rk, sub: 'Its miners run themselves, at their steady state, and free your commands' })
    } else {
      f += `<p>This region runs itself. Move on to grow.</p>`
    }
    const anyAuto = Object.values(s.regions).some(x => x.automated)
    if (anyAuto) f += btn('carrier', 'Build carrier', { cost: c.carrier, disabled: res < c.carrier || !!s.flag.dest, sub: 'A level-4 flagship: holds 49 regions and launches seeders' })
  } else {
    f += btn('seeder', 'Build seeder', { cost: c.seeder, disabled: res < c.seeder, sub: `A level-3 ship: settles a whole region with ${E.SEED_MINERS} miners, automated` })
    const h = s.hub
    if (!h) f += btn('hub', 'Build hub', { cost: c.hub, disabled: res < c.hub || !!s.flag.dest, sub: 'Holds this level-6 region (343 regions) so it can be automated' })
    else if (!h.built) f += `<p>Hub building… ${Math.round(h.progress * 100)}%</p>`
    else if (!h.automated) f += btn('automate-hub', 'Automate the hub', { cls: 'teal big', sub: 'Every region inside is seeded in turn, on its own' })
    else f += `<p>The hub seeds its regions: ${h.next} of ${h.order.length}.</p>`
  }
  f += `</section>`
  parts.push(f)

  // ---- the selection ----
  const sel = typeof ui.selected === 'number' ? s.ships.find(x => x.id === ui.selected) : null
  if (sel && sel.kind === 'miner') {
    const what = sel.state === 'join' ? 'Joining an automated region'
      : !sel.order ? 'Idle: escorting the flagship' : ({ out: 'Flying to its deposit', wait: 'Waiting for a free slot', mine: 'Mining', back: 'Bringing its load back' })[sel.state]
    let x = `<section><h2>Selected</h2><h3>Miner ${sel.id}<span class="tag ${sel.order ? 'manual' : ''}">${sel.order ? 'commanded' : 'free'}</span></h3><p>${what}</p>`
    if (!sel.order) x += `<p>Click a violet deposit inside your control to put it to work (uses a command), or click an automated region (teal) to hand it over.</p>`
    else x += btn('release', 'Release', { arg: sel.id, sub: 'Frees its command; it returns to escort duty' })
    const auto = Object.entries(s.regions).filter(([, q]) => q.automated)
    if (auto.length && sel.state !== 'join') x += btn('join-best', 'Hand over to automation', { cls: 'teal', arg: sel.id, sub: 'Joins the automated region where it adds most' })
    parts.push(x + '</section>')
  } else if (sel && sel.kind === 'seeder') {
    const what = !sel.order ? 'Idle. Click a region inside the carrier\'s area to settle it.' : sel.state === 'fly' ? 'Flying to its region' : `Establishing… ${Math.round(sel.progress * 100)}%`
    let x = `<section><h2>Selected</h2><h3>Seeder ${sel.id}<span class="tag ${sel.order ? 'manual' : ''}">${sel.order ? 'commanded' : 'free'}</span></h3><p>${what}</p>`
    if (sel.order) x += btn('release', 'Recall', { arg: sel.id })
    parts.push(x + '</section>')
  } else if (ui.selectedRegion) {
    parts.push(regionSection(s, ui.selectedRegion))
  }

  // ---- upgrades ----
  let u = `<section><h2>Upgrades</h2>`
  for (const [name, up] of Object.entries(E.UPGRADES)) {
    const lv = s.up[name] || 0, maxed = lv >= up.max
    u += btn('upgrade', `${up.name} <span class="dim">${lv}/${up.max}</span>`, { arg: name, cost: maxed ? null : c.upgrade[name], disabled: maxed || res < c.upgrade[name], sub: maxed ? 'done' : up.what })
  }
  u += `</section>`
  parts.push(u)

  parts.push(`<section><h2>Game</h2><p>Seed ${s.seed} · ${Math.floor(s.t / 60)} min played · ${fmt(s.earned)} earned</p>
    <div class="row">${btn('new-game', 'New game')}${btn('help', 'How to play')}</div></section>`)
  return parts.join('')
}

function regionSection(s, rk) {
  const r = s.regions[rk] || { relay: null, automated: false, miners: 0 }
  const { z } = unkey(rk)
  const deps = depositsIn(s.seed, z, E.AUTOMATE_LEVEL)
  const slots = S.slotsOf(s, rk).slots
  const status = r.automated ? '<span class="tag auto">automated</span>' : r.relay && r.relay.built ? '<span class="tag manual">held</span>' : ''
  let x = `<section><h2>Selected</h2><h3>Region ${z[0]},${z[1]}${status}</h3>`
  x += `<dl><dt>Deposits</dt><dd>${deps.length}</dd><dt>Mining slots</dt><dd>${slots.length}</dd>`
  if (r.automated) {
    const rate = S.regionRate(s, rk), next = rateOf(slots, r.miners + 1) - rate
    x += `<dt>Miners</dt><dd>${r.miners}</dd><dt>Income</dt><dd>+${fmt(rate)}/s</dd></dl>`
    x += `<p>Its state is just these numbers: the miners you see are drawn from them.</p>`
    const cost = S.minerCostIn(s, rk)
    x += btn('add-miner', 'Add a miner', { arg: rk, cost, disabled: s.res < cost, cls: 'teal', sub: next > 0 ? `+${fmt(next)}/s` : 'every slot is taken: it would add nothing' })
    x += btn('detach', 'Take a miner out', { arg: rk, disabled: r.miners < 1, sub: 'You command it; the region earns less' })
  } else {
    x += `<dt>Full, it earns</dt><dd>+${fmt(rateOf(slots, slots.length))}/s</dd></dl>`
    if (r.relay && r.relay.built) x += btn('automate', 'Automate this region', { cls: 'teal big', arg: rk })
    else x += `<p>${r.relay ? 'A relay is being built here.' : 'Bring the mothership here and build a relay to hold it.'}</p>`
  }
  return x + '</section>'
}

/** One line of guidance: the next thing worth knowing. */
export function hintFor(s, ui) {
  const seen = k => k in s.seen
  const miners = s.ships.filter(x => x.kind === 'miner')
  const anyAuto = Object.values(s.regions).some(r => r.automated)
  if (!seen('ordered')) {
    if (typeof ui.selected === 'number') return 'Now click a glowing <b style="color:var(--violet)">violet deposit</b> inside the amber outline.'
    return 'Click your <b>miner</b> (the small ship by the mothership), then click a glowing <b style="color:var(--violet)">violet deposit</b>.'
  }
  if (!seen('first-delivery')) return 'The miner fills its hold and brings it back to the mothership.'
  if (!seen('miner-1')) return 'Build another miner (<kbd>B</kbd>) and set it to work the same way.'
  const relayStarted = seen('relay-started')
  if (!relayStarted && S.commandsUsed(s) >= S.commandsMax(s)) {
    return `All your commands are in use: you can only direct ${S.commandsMax(s)} ships at once. Save for a <b>relay</b> (◆ ${fmt(S.costs(s).relay)}) to hold this region and automate it.`
  }
  if (!relayStarted) return 'Keep building miners and upgrades. A relay (in the panel) holds the whole region.'
  const rk = S.flagRegion(s), r = s.regions[rk]
  if (r && r.relay && !r.relay.built) return 'The relay is going up: soon the whole region is under your control.'
  if (r && r.relay && r.relay.built && !r.automated) return 'Your relay holds the region. <b style="color:var(--teal)">Automate</b> it: its miners will run themselves and your commands come back.'
  if (r && r.automated && s.flag.tier === 1 && !s.flag.dest && Object.values(s.regions).filter(x => x.automated).length === 1) return 'Automated: the region now earns its steady state, with no commands. Scroll out to see further, then move on: <kbd>M</kbd> and click a tile in a neighbouring region.'
  if (s.flag.tier === 1 && anyAuto && (!r || !r.relay) && !s.flag.dest) return `A fresh region: miners are cheap here again (◆ ${fmt(S.costs(s).miner)}). Put some to work, then save for its relay (◆ ${fmt(S.costs(s).relay)}).`
  if (s.flag.tier === 1 && !seen('carrier') && s.res > S.costs(s).carrier * 0.5) return 'A <b>carrier</b> is within reach: a flagship one level up, holding 49 regions at once.'
  if (s.flag.tier === 2 && s.ships.some(x => x.kind === 'seeder' && !x.order) && S.commandsUsed(s) >= S.commandsMax(s)) return 'Your commands are all held by miners. Release one (select it, then <b>Release</b>), or hand them to automation, to launch the seeder.'
  if (s.flag.tier === 2 && !seen('seeder-1')) return 'Build a <b>seeder</b>, select it, and click a region inside the carrier\'s outline: it settles the region, automated.'
  if (s.flag.tier === 2 && !s.hub && s.res > S.costs(s).hub * 0.4) return 'A <b>hub</b> holds a whole level-6 region (343 regions) and automates them all.'
  if (s.hub && s.hub.built && !s.hub.automated) return 'Automate the hub.'
  if (seen('hub-done')) return 'A level-6 region runs itself. That is the end of this prototype: thank you for playing.'
  if (miners.some(m => !m.order && m.state === 'idle') && S.commandsUsed(s) < S.commandsMax(s) && s.flag.tier === 1) return 'You have an idle miner and a free command. <kbd>Tab</kbd> selects it.'
  return ''
}

export const HELP = `Hold is a prototype. You command ships, but only so many at once: those are your commands.
Miners work deposits (violet) inside your control (amber) and bring the load home.
A relay holds a whole region; automate it, and its miners run themselves at their steady state:
the region becomes a few numbers, earns while you're away, and your commands come back.
Then move on, and zoom out: automating opens the next scale. A carrier works a level up and
launches seeders that settle whole regions; a hub automates 343 regions at once.`
