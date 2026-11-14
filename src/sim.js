// The game: pure state and a fixed-tick step, no rendering. The page (main.js), the bot (bot.js) and
// the tests all drive it through the same actions.
//
// Two kinds of simulation run side by side:
//   fine    ships you command (and idle ones) fly, mine and deliver one by one; income arrives when a
//           miner unloads.
//   coarse  an automated region is a few numbers: its miners, and the steady-state income they earn
//           (steady.js). Its ships are only drawn. Commands are what you spend to keep ships fine.

import { tileAt, centre, ancestor, key, unkey, same, isUnit, descendants, spacing } from './lattice.js'
import { depositAt, startTile } from './world.js'
import { regionSlots, rateOf } from './steady.js'
import * as E from './economy.js'

export const TICK = 0.05

export function newGame(seed = 1) {
  const home = startTile(seed)
  const [x, y] = centre(home, 1)
  const s = {
    v: 1, seed, t: 0, res: 0, earned: 0,
    up: { drill: 0, hold: 0, engine: 0, link: 0 },
    bought: { miners: 0, relays: 0, seeders: 0 },
    flag: { tier: 1, x, y, dest: null },
    ships: [], nextId: 1,
    regions: {},
    hub: null,
    events: [],
    seen: {},
  }
  addShip(s, 'miner', x + 1.4, y - 0.6)
  return s
}

// ---- Derived facts ----------------------------------------------------------------------------

export const flagLevel = s => E.FLAGSHIPS[s.flag.tier].level
export const flagTile = s => tileAt(s.flag.x, s.flag.y, flagLevel(s))
export const commandsMax = s => E.commandsMax(s.up)
export const commandsUsed = s => s.ships.filter(sh => sh.order).length

const paramsMemo = new Map()
export function params(s) {
  const k = `${s.up.drill},${s.up.hold},${s.up.engine}`
  let p = paramsMemo.get(k)
  if (!p) { p = E.params(s.up); paramsMemo.set(k, p) }
  return p
}
const pkey = s => `${s.seed}|${s.up.drill},${s.up.hold},${s.up.engine}`

const slotMemo = new Map()
/** A region's slots, best first, for the current upgrades. */
export function slotsOf(s, rk) {
  const k = `${pkey(s)}|${rk}`
  let v = slotMemo.get(k)
  if (!v) {
    const { level, z } = unkey(rk)
    v = regionSlots(s.seed, z, level, params(s))
    slotMemo.set(k, v)
  }
  return v
}
const rateMemo = new Map()
/** An automated region's steady-state income (memoised: it changes only with miners and upgrades). */
export function regionRate(s, rk) {
  const r = s.regions[rk]
  if (!r || !r.automated) return 0
  const k = `${pkey(s)}|${rk}|${r.miners}`
  let v = rateMemo.get(k)
  if (v === undefined) { v = rateOf(slotsOf(s, rk).slots, r.miners); rateMemo.set(k, v) }
  return v
}
export const regionKeyOf = z0 => key(E.AUTOMATE_LEVEL, ancestor(z0, E.AUTOMATE_LEVEL))
export const regionOf = (s, rk) => s.regions[rk] || (s.regions[rk] = { relay: null, automated: false, miners: 0, seeding: false })

/** Is level-L tile z inside the flagship's control area (its tile and the six around it)? */
export function inFlagArea(s, z, L) {
  const fl = flagLevel(s)
  if (L > fl) return false
  const a = ancestor(z, fl - L), F = flagTile(s)
  return same(a, F) || isUnit([a[0] - F[0], a[1] - F[1]])
}
export function hubContains(s, z, L) {
  return !!(s.hub && s.hub.automated && same(ancestor(z, E.HUB_LEVEL - L), s.hub.z))
}
/** Is level-0 tile z under control: in the flagship's area, a region with a relay, or the hub's? */
export function controlled(s, z) {
  if (inFlagArea(s, z, 0)) return true
  const r = s.regions[regionKeyOf(z)]
  return !!(r && ((r.relay && r.relay.built) || r.automated)) || hubContains(s, z, 0)
}
/** Where a miner of this deposit unloads: its region's relay if built, else the flagship. */
export function dropFor(s, z) {
  const rk = regionKeyOf(z), r = s.regions[rk]
  if (r && r.relay && r.relay.built) return centre(unkey(rk).z, E.AUTOMATE_LEVEL)
  return [s.flag.x, s.flag.y]
}
/** Miners in a region: automated ones, commanded ones mining there, and (for the flagship's region) idle escorts. */
export function minersIn(s, rk) {
  const r = s.regions[rk]
  let n = r && r.automated ? r.miners : 0
  const here = key(E.AUTOMATE_LEVEL, tileAt(s.flag.x, s.flag.y, E.AUTOMATE_LEVEL))
  for (const sh of s.ships) {
    if (sh.kind !== 'miner') continue
    if (sh.order ? regionKeyOf(unkey(sh.order).z) === rk : rk === here) n++
  }
  return n
}
export const flagRegion = s => key(E.AUTOMATE_LEVEL, tileAt(s.flag.x, s.flag.y, E.AUTOMATE_LEVEL))
/**
 * The income of every automated region together. Memoised on a cheap fingerprint (regions keep their
 * insertion order, so the sequence of miner counts identifies the state), since a late game has
 * hundreds of regions and this runs every tick.
 */
const totalMemo = { key: '', rate: 0 }
export function automatedRate(s) {
  let n = 0, h = 0
  for (const rk in s.regions) { const r = s.regions[rk]; if (r.automated) { n++; h = (Math.imul(h, 31) + r.miners + 1) | 0 } else h = Math.imul(h, 17) | 0 }
  const k = `${pkey(s)}|${n}|${h}`
  if (k !== totalMemo.key) {
    let t = 0
    for (const rk in s.regions) t += regionRate(s, rk)
    totalMemo.key = k; totalMemo.rate = t
  }
  return totalMemo.rate
}
/** Income per second: automated regions exactly, commanded miners by the same trip formula. */
export function incomeRate(s) {
  const p = params(s)
  let manual = 0
  for (const sh of s.ships) {
    if (sh.kind !== 'miner' || !sh.order) continue
    const d = depositAt(s.seed, unkey(sh.order).z)
    if (!d) continue
    const drop = dropFor(s, d.z), dist = Math.hypot(d.xy[0] - drop[0], d.xy[1] - drop[1])
    manual += p.cargo / (2 * dist / p.speed + p.cargo / (p.rate * d.rich))
  }
  return automatedRate(s) + manual
}
/** How far out the camera may zoom: one level further for each scale you have automated. */
export function maxZoomLevel(s) {
  const any = Object.values(s.regions).some(r => r.automated)
  return 3.2 + (any ? 1.6 : 0) + (s.flag.tier >= 2 ? 1.6 : 0) + (s.hub && s.hub.automated ? 1.6 : 0)
}

// ---- Events -----------------------------------------------------------------------------------

function event(s, kind, text) {
  s.events.push({ t: s.t, kind, text })
  if (s.events.length > 60) s.events.shift()
  if (!(kind in s.seen)) s.seen[kind] = s.t
}

// ---- The step -----------------------------------------------------------------------------------

function addShip(s, kind, x, y) {
  const sh = { id: s.nextId++, kind, x, y, hx: 1, hy: 0, state: 'idle', order: null, cargo: 0, target: null, progress: 0 }
  s.ships.push(sh)
  return sh
}
/** Move a ship towards (tx, ty) by at most `step`; true when it has arrived. */
function fly(sh, tx, ty, step) {
  const dx = tx - sh.x, dy = ty - sh.y, d = Math.hypot(dx, dy)
  if (d > 1e-9) { sh.hx = dx / d; sh.hy = dy / d }
  if (d <= step) { sh.x = tx; sh.y = ty; return true }
  sh.x += dx / d * step; sh.y += dy / d * step
  return false
}
function escortPoint(s, sh) {
  const R = s.flag.tier === 1 ? 1.9 : 0.62 * spacing(flagLevel(s))
  const a = sh.id * 2.39996 + s.t * (s.flag.tier === 1 ? 0.25 : 0.05)
  return [s.flag.x + R * Math.cos(a), s.flag.y + R * Math.sin(a)]
}
function earn(s, amount) { s.res += amount; s.earned += amount }

export function step(s, dt = TICK) {
  s.t += dt
  const p = params(s)

  // the flagship
  const F = E.FLAGSHIPS[s.flag.tier]
  if (s.flag.dest) {
    const [tx, ty] = centre(s.flag.dest, F.level)
    const sh = { x: s.flag.x, y: s.flag.y, hx: 0, hy: 0 }
    const arrived = fly(sh, tx, ty, F.speed * dt)
    s.flag.x = sh.x; s.flag.y = sh.y
    if (arrived) { s.flag.dest = null; event(s, 'flag-arrived', `${F.name} arrived`) }
  }

  // relays under construction
  for (const rk in s.regions) {
    const r = s.regions[rk]
    if (r.relay && !r.relay.built) {
      r.relay.progress += dt / E.RELAY_BUILD
      if (r.relay.progress >= 1) { r.relay.built = true; r.relay.progress = 1; event(s, 'relay-built', 'Relay built: the whole region is under control') }
    }
  }

  // ships
  const mining = new Map()
  for (const sh of s.ships) if (sh.state === 'mine') mining.set(sh.order, (mining.get(sh.order) || 0) + 1)
  for (const sh of [...s.ships]) {
    if (sh.kind === 'miner') stepMiner(s, sh, p, dt, mining)
    else stepSeeder(s, sh, dt)
  }

  // automated regions earn their steady state, every tick
  earn(s, automatedRate(s) * dt)

  // the hub
  const h = s.hub
  if (h && !h.built) {
    h.progress += dt / E.HUB_BUILD
    if (h.progress >= 1) { h.built = true; h.progress = 1; event(s, 'hub-built', 'Hub built: automate it to seed every region inside') }
  }
  if (h && h.automated && h.next < h.order.length) {
    h.timer += dt
    while (h.timer >= E.HUB_SEED_INTERVAL && h.next < h.order.length) {
      h.timer -= E.HUB_SEED_INTERVAL
      seedRegion(s, h.order[h.next++])
    }
    if (h.next >= h.order.length) event(s, 'hub-done', 'Every region in the hub is automated')
  }
}

function stepMiner(s, sh, p, dt, mining) {
  // a commanded miner whose deposit has left control stops
  if (sh.order && !controlled(s, unkey(sh.order).z)) {
    sh.order = null
    sh.state = sh.cargo > 0 ? 'back' : 'idle'
    event(s, 'lost-control', 'A miner lost control of its deposit and came off duty')
  }
  const speed = p.speed * dt
  switch (sh.state) {
    case 'idle': {
      const [tx, ty] = escortPoint(s, sh)
      fly(sh, tx, ty, Math.max(p.speed, E.FLAGSHIPS[s.flag.tier].speed * 1.3) * dt)
      return
    }
    case 'out': {
      const d = depositAt(s.seed, unkey(sh.order).z)
      if (fly(sh, d.xy[0], d.xy[1], speed)) sh.state = 'wait'
      return
    }
    case 'wait': {
      const d = depositAt(s.seed, unkey(sh.order).z)
      if ((mining.get(sh.order) || 0) < d.slots) { sh.state = 'mine'; mining.set(sh.order, (mining.get(sh.order) || 0) + 1) }
      return
    }
    case 'mine': {
      const d = depositAt(s.seed, unkey(sh.order).z)
      sh.cargo = Math.min(p.cargo, sh.cargo + p.rate * d.rich * dt)
      if (sh.cargo >= p.cargo - 1e-9) { sh.state = 'back'; mining.set(sh.order, mining.get(sh.order) - 1) }
      return
    }
    case 'back': {
      const [tx, ty] = sh.order ? dropFor(s, unkey(sh.order).z) : [s.flag.x, s.flag.y]
      if (fly(sh, tx, ty, speed)) {
        if (sh.cargo > 0) {
          earn(s, sh.cargo)
          if (!('first-delivery' in s.seen)) event(s, 'first-delivery', 'First delivery')
        }
        sh.cargo = 0
        sh.state = sh.order ? 'out' : 'idle'
      }
      return
    }
    case 'join': {
      const r = s.regions[sh.target]
      if (!r || !r.automated) { sh.state = 'idle'; sh.target = null; return }
      const [tx, ty] = centre(unkey(sh.target).z, E.AUTOMATE_LEVEL)
      if (fly(sh, tx, ty, Math.max(speed, 3 * dt))) {
        if (sh.cargo > 0) earn(s, sh.cargo)
        r.miners++
        s.ships.splice(s.ships.indexOf(sh), 1)
        event(s, 'joined', 'A miner joined an automated region')
      }
    }
  }
}

function stepSeeder(s, sh, dt) {
  if (sh.state === 'idle') { const [tx, ty] = escortPoint(s, sh); fly(sh, tx, ty, E.SEEDER_SPEED * dt); return }
  const { z } = unkey(sh.order)
  if (sh.state === 'fly') {
    const [tx, ty] = centre(z, E.AUTOMATE_LEVEL)
    if (fly(sh, tx, ty, E.SEEDER_SPEED * dt)) { sh.state = 'est'; sh.progress = 0 }
    return
  }
  if (sh.state === 'est') {
    sh.progress += dt / E.SEED_TIME
    if (sh.progress >= 1) {
      seedRegion(s, sh.order)
      s.ships.splice(s.ships.indexOf(sh), 1)
    }
  }
}

/** Set a region up, automated, with a relay and as many miners as a seeder brings. */
function seedRegion(s, rk) {
  const r = regionOf(s, rk)
  r.seeding = false
  if (r.automated) return
  r.relay = { built: true, progress: 1 }
  r.automated = true
  r.miners = Math.max(r.miners, Math.min(E.SEED_MINERS, slotsOf(s, rk).slots.length))
  event(s, 'seeded', 'A region was seeded and automated')
}

// ---- Actions ----------------------------------------------------------------------------------
// Each returns { ok: true } or { ok: false, msg } and changes nothing when it fails.

const no = msg => ({ ok: false, msg })
const yes = (extra = {}) => ({ ok: true, ...extra })
function pay(s, cost) { if (s.res + 1e-9 < cost) return false; s.res -= cost; return true }
const ship = (s, id) => s.ships.find(sh => sh.id === id)

export const minerCostIn = (s, rk) => E.minerCost(minersIn(s, rk))
export const costs = s => ({
  miner: E.minerCost(minersIn(s, flagRegion(s))),
  relay: E.relayCost(s.bought.relays),
  carrier: E.CARRIER_COST,
  seeder: E.seederCost(s.bought.seeders),
  hub: E.HUB_COST,
  upgrade: Object.fromEntries(Object.keys(E.UPGRADES).map(n => [n, E.upgradeCost(n, s.up[n] || 0)])),
})

export function buyMiner(s) {
  const c = E.minerCost(minersIn(s, flagRegion(s)))
  if (!pay(s, c)) return no('Not enough resources')
  s.bought.miners++
  addShip(s, 'miner', s.flag.x, s.flag.y)
  event(s, 'miner-' + s.bought.miners, 'New miner')
  return yes()
}

export function buyUpgrade(s, name) {
  const u = E.UPGRADES[name]
  if (!u) return no('No such upgrade')
  if ((s.up[name] || 0) >= u.max) return no('Fully upgraded')
  if (!pay(s, E.upgradeCost(name, s.up[name] || 0))) return no('Not enough resources')
  s.up[name] = (s.up[name] || 0) + 1
  event(s, `up-${name}-${s.up[name]}`, `${u.name} ${s.up[name]}: ${u.what}`)
  return yes()
}

export function orderMine(s, id, depKey) {
  const sh = ship(s, id)
  if (!sh || sh.kind !== 'miner') return no('Select a miner first')
  const { level, z } = unkey(depKey)
  if (level !== 0 || !depositAt(s.seed, z)) return no('No deposit there')
  if (!controlled(s, z)) return no('That deposit is outside your control')
  if (!sh.order && commandsUsed(s) >= commandsMax(s)) return no('No commands free: automate a region to free them, or release a miner')
  if (sh.state === 'mine') sh.state = 'out'
  sh.order = depKey
  sh.target = null
  if (sh.state !== 'back') sh.state = 'out'
  event(s, 'ordered', 'Miner ordered')
  return yes()
}

export function release(s, id) {
  const sh = ship(s, id)
  if (!sh || !sh.order) return no('Nothing to release')
  if (sh.kind === 'seeder' && s.regions[sh.order]) s.regions[sh.order].seeding = false
  sh.order = null
  sh.state = sh.cargo > 0 ? 'back' : 'idle'
  if (sh.kind === 'seeder') { sh.state = 'idle'; sh.progress = 0 }
  return yes()
}

/** Send an idle miner to join an automated region: it leaves your commands for good. */
export function joinRegion(s, id, rk) {
  const sh = ship(s, id), r = s.regions[rk]
  if (!sh || sh.kind !== 'miner') return no('Select a miner first')
  if (!r || !r.automated) return no('Only an automated region can take a miner')
  sh.order = null
  sh.state = 'join'
  sh.target = rk
  return yes()
}

/** Take a miner out of an automated region, to command it yourself. */
export function detach(s, rk) {
  const r = s.regions[rk]
  if (!r || !r.automated || r.miners < 1) return no('No miners to take')
  r.miners--
  const [x, y] = centre(unkey(rk).z, E.AUTOMATE_LEVEL)
  addShip(s, 'miner', x, y)
  event(s, 'detached', 'A miner left automation')
  return yes()
}

export function addMinerToRegion(s, rk) {
  const r = s.regions[rk]
  if (!r || !r.automated) return no('Not an automated region')
  if (!pay(s, E.minerCost(minersIn(s, rk)))) return no('Not enough resources')
  s.bought.miners++
  r.miners++
  event(s, 'miner-' + s.bought.miners, 'New miner, straight into automation')
  return yes()
}

export function moveFlag(s, z) {
  if (same(z, flagTile(s)) && !s.flag.dest) return no('Already there')
  s.flag.dest = z
  return yes()
}

export function buildRelay(s) {
  const rk = key(E.AUTOMATE_LEVEL, tileAt(s.flag.x, s.flag.y, E.AUTOMATE_LEVEL))
  const r = s.regions[rk]
  if (r && (r.relay || r.automated)) return no('This region has a relay already')
  if (s.flag.dest) return no('Wait until the flagship has stopped')
  if (!pay(s, E.relayCost(s.bought.relays))) return no('Not enough resources')
  s.bought.relays++
  regionOf(s, rk).relay = { built: false, progress: 0 }
  event(s, 'relay-started', 'Building a relay')
  return yes({ region: rk })
}

export function automate(s, rk) {
  const r = s.regions[rk]
  if (!r || !r.relay || !r.relay.built) return no('A region needs a built relay before it can be automated')
  if (r.automated) return no('Already automated')
  r.automated = true
  // its commanded miners join the automation: their commands come back
  let n = 0
  for (const sh of [...s.ships]) {
    if (sh.kind === 'miner' && sh.order && regionKeyOf(unkey(sh.order).z) === rk) {
      if (sh.cargo > 0) earn(s, sh.cargo)
      s.ships.splice(s.ships.indexOf(sh), 1)
      n++
    }
  }
  r.miners += n
  const count = Object.values(s.regions).filter(x => x.automated).length
  event(s, 'automated-' + count, `Region automated: ${r.miners} miner${r.miners === 1 ? '' : 's'} now run on their own`)
  return yes({ freed: n })
}

export function buildCarrier(s) {
  if (s.flag.tier !== 1) return no('You have a carrier already')
  if (!Object.values(s.regions).some(r => r.automated)) return no('Automate a region first')
  if (s.flag.dest) return no('Wait until the mothership has stopped')
  if (!pay(s, E.CARRIER_COST)) return no('Not enough resources')
  s.flag.tier = 2
  const [x, y] = centre(tileAt(s.flag.x, s.flag.y, flagLevel(s)), flagLevel(s))
  s.flag.dest = tileAt(x, y, flagLevel(s))
  event(s, 'carrier', 'Carrier built: it works a level up, and can launch seeders')
  return yes()
}

export function buildSeeder(s) {
  if (s.flag.tier < 2) return no('Seeders launch from a carrier')
  if (!pay(s, E.seederCost(s.bought.seeders))) return no('Not enough resources')
  s.bought.seeders++
  const sh = addShip(s, 'seeder', s.flag.x, s.flag.y)
  event(s, 'seeder-' + s.bought.seeders, 'New seeder')
  return yes({ id: sh.id })
}

export function orderSeed(s, id, rk) {
  const sh = ship(s, id)
  if (!sh || sh.kind !== 'seeder') return no('Select a seeder first')
  const { level, z } = unkey(rk)
  if (level !== E.AUTOMATE_LEVEL) return no('Seeders settle a whole region')
  const r = s.regions[rk]
  if (r && (r.automated || r.seeding)) return no('That region is taken care of')
  if (!inFlagArea(s, z, level)) return no('That region is outside the carrier\'s control')
  if (!slotsOf(s, rk).slots.length) return no('Nothing to mine there')
  if (!sh.order && commandsUsed(s) >= commandsMax(s)) return no('No commands free')
  regionOf(s, rk).seeding = true
  sh.order = rk
  sh.state = 'fly'
  return yes()
}

export function buildHub(s) {
  if (s.flag.tier < 2) return no('A hub needs a carrier')
  if (s.hub) return no('You have a hub already')
  if (s.flag.dest) return no('Wait until the carrier has stopped')
  if (!pay(s, E.HUB_COST)) return no('Not enough resources')
  s.hub = { z: tileAt(s.flag.x, s.flag.y, E.HUB_LEVEL), progress: 0, built: false, automated: false, order: [], next: 0, timer: 0 }
  event(s, 'hub-started', 'Building a hub')
  return yes()
}

export function automateHub(s) {
  const h = s.hub
  if (!h || !h.built) return no('The hub is not built yet')
  if (h.automated) return no('Already automated')
  h.automated = true
  const c = centre(h.z, E.HUB_LEVEL)
  h.order = descendants(h.z, E.HUB_LEVEL, E.AUTOMATE_LEVEL)
    .map(z => key(E.AUTOMATE_LEVEL, z))
    .filter(rk => !(s.regions[rk] && s.regions[rk].automated) && slotsOf(s, rk).slots.length)
    .sort((a, b) => dist2(unkey(a).z, c) - dist2(unkey(b).z, c))
  event(s, 'hub-automated', 'Hub automated: it seeds every region inside, one after another')
  return yes()
}
const dist2 = (z, c) => { const [x, y] = centre(z, E.AUTOMATE_LEVEL); return (x - c[0]) ** 2 + (y - c[1]) ** 2 }

/** Progress while away: automated regions earn exactly; timers finish; commanded ships hold still. */
export function fastForward(s, seconds) {
  const secs = Math.max(0, Math.min(seconds, 12 * 3600))
  earn(s, automatedRate(s) * secs)
  for (const r of Object.values(s.regions)) if (r.relay && !r.relay.built && r.relay.progress + secs / E.RELAY_BUILD >= 1) { r.relay.built = true; r.relay.progress = 1 }
  if (s.flag.dest) { const [x, y] = centre(s.flag.dest, flagLevel(s)); s.flag.x = x; s.flag.y = y; s.flag.dest = null }
  if (s.hub && !s.hub.built && s.hub.progress + secs / E.HUB_BUILD >= 1) { s.hub.built = true; s.hub.progress = 1 }
  if (s.hub && s.hub.automated) {
    const n = Math.min(s.hub.order.length - s.hub.next, Math.floor((s.hub.timer + secs) / E.HUB_SEED_INTERVAL))
    for (let i = 0; i < n; i++) seedRegion(s, s.hub.order[s.hub.next++])
  }
  s.t += secs
  return secs
}
