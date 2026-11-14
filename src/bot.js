// A player that makes the decisions a reasonably attentive person would, through the same actions as
// the page. tools/bot.mjs uses it to measure the pacing; the tests use it to check the game can be won.

import * as S from './sim.js'
import { unkey, key, neighbours, centre, tileAt, ancestor, descendants } from './lattice.js'
import { depositsAround, depositAt } from './world.js'
import { rateOf } from './steady.js'
import * as E from './economy.js'

/** Take every action worth taking now. Returns the names of the actions taken. */
export function botAct(s, opts = {}) {
  const payback = opts.payback ?? 90                // buy things that pay for themselves within this many seconds
  const done = []
  const did = (name, r) => { if (r && r.ok) done.push(name); return r && r.ok }

  // automate whatever can be
  for (const [rk, r] of Object.entries(s.regions)) if (r.relay && r.relay.built && !r.automated) did('automate', S.automate(s, rk))
  if (s.hub && s.hub.built && !s.hub.automated) did('automate-hub', S.automateHub(s))

  const income = Math.max(S.incomeRate(s), 0.05)
  const c = S.costs(s)

  // upgrades that pay back quickly (income grows by the upgrade's factor, roughly)
  const gain = { drill: 0.3, hold: 0.25, engine: 0.12, link: 0 }
  for (const name of ['drill', 'hold', 'engine']) {
    if ((s.up[name] || 0) >= E.UPGRADES[name].max) continue
    if (c.upgrade[name] <= s.res && c.upgrade[name] / (income * gain[name]) < payback * 1.5) did('up-' + name, S.buyUpgrade(s, name))
  }

  // tier 2: the hub, then seeders, which need commands: hand commanded miners over to automation
  if (s.flag.tier === 2) {
    for (const sh of s.ships.filter(x => x.kind === 'miner' && x.order)) did('release', S.release(s, sh.id))
    if (!s.hub && !s.flag.dest && s.res >= c.hub) did('hub', S.buildHub(s))
    for (const sh of s.ships.filter(x => x.kind === 'seeder' && !x.order)) {
      const target = bestSeedTarget(s)
      if (target) did('seed', S.orderSeed(s, sh.id, target))
    }
    const idleSeeders = s.ships.filter(x => x.kind === 'seeder' && !x.order).length
    const savingForHub = !s.hub && S.costs(s).seeder > E.HUB_COST / 30
    if (!savingForHub && !idleSeeders && S.commandsUsed(s) < S.commandsMax(s) && bestSeedTarget(s) && s.res >= S.costs(s).seeder && (!s.hub || s.hub.built)) did('seeder', S.buildSeeder(s))
  }

  // the carrier, once a couple of regions run themselves
  const automated = Object.values(s.regions).filter(r => r.automated).length
  if (s.flag.tier === 1 && automated >= 2 && s.res >= c.carrier && !s.flag.dest) did('carrier', S.buildCarrier(s))

  // a relay where the mothership is, if the region is worth it
  if (s.flag.tier === 1 && !s.flag.dest) {
    const rk = key(E.AUTOMATE_LEVEL, tileAt(s.flag.x, s.flag.y, E.AUTOMATE_LEVEL))
    const r = s.regions[rk]
    if ((!r || !r.relay) && S.slotsOf(s, rk).slots.length >= 8 && s.res >= c.relay) did('relay', S.buildRelay(s))
  }

  // put idle miners to work: a free slot under command, or an automated region with room
  for (const sh of s.ships.filter(x => x.kind === 'miner' && x.state === 'idle' && !x.order)) {
    if (S.commandsUsed(s) < S.commandsMax(s)) {
      const dep = bestFreeDeposit(s)
      if (dep && did('order', S.orderMine(s, sh.id, dep))) continue
    }
    const rk = bestRoomyRegion(s)
    if (rk) did('join', S.joinRegion(s, sh.id, rk))
  }

  // more miners: for a free command and slot, or straight into the automated region that gains most
  let bought = true
  while (bought) {
    bought = false
    const cost = S.costs(s).miner
    const idle = s.ships.filter(x => x.kind === 'miner' && x.state === 'idle' && !x.order).length
    if (!idle && s.res >= cost && S.commandsUsed(s) < S.commandsMax(s) && bestFreeDeposit(s)) {
      const inc = perMinerManual(s)
      if (cost / Math.max(inc, 1e-6) < payback && did('miner', S.buyMiner(s))) {
        const sh = s.ships[s.ships.length - 1]
        S.orderMine(s, sh.id, bestFreeDeposit(s))
        bought = true
        continue
      }
    }
    let best = null, bestRatio = Infinity
    for (const [rk, r] of Object.entries(s.regions)) {
      if (!r.automated) continue
      const sl = S.slotsOf(s, rk).slots
      const g = rateOf(sl, r.miners + 1) - rateOf(sl, r.miners)
      const ratio = S.minerCostIn(s, rk) / Math.max(g, 1e-9)
      if (ratio < bestRatio && S.minerCostIn(s, rk) <= s.res) { bestRatio = ratio; best = rk }
    }
    if (best && bestRatio < payback && did('miner-auto', S.addMinerToRegion(s, best))) bought = true
  }

  // move on once the region here runs itself (or there is nothing left to mine here)
  if (!s.flag.dest) maybeMove(s, did)
  return done
}

function occupancy(s) {
  const m = new Map()
  for (const sh of s.ships) if (sh.kind === 'miner' && sh.order) m.set(sh.order, (m.get(sh.order) || 0) + 1)
  return m
}
function controlledDeposits(s) {
  const out = []
  if (s.flag.tier === 1) out.push(...depositsAround(s.seed, S.flagTile(s), 1))
  for (const [rk, r] of Object.entries(s.regions)) {
    if (r.relay && r.relay.built && !r.automated) {
      for (const z of descendants(unkey(rk).z, E.AUTOMATE_LEVEL, 0)) { const d = depositAt(s.seed, z); if (d) out.push(d) }
    }
  }
  const seen = new Set()
  return out.filter(d => !seen.has(d.key) && seen.add(d.key) && S.controlled(s, d.z) && !(s.regions[S.regionKeyOf(d.z)] || {}).automated)
}
function tripIncome(s, d) {
  const p = S.params(s), drop = S.dropFor(s, d.z)
  const dist = Math.hypot(d.xy[0] - drop[0], d.xy[1] - drop[1])
  return p.cargo / (2 * dist / p.speed + p.cargo / (p.rate * d.rich))
}
function bestFreeDeposit(s) {
  const occ = occupancy(s)
  let best = null, bi = 0
  for (const d of controlledDeposits(s)) {
    if ((occ.get(d.key) || 0) >= d.slots) continue
    const inc = tripIncome(s, d)
    if (inc > bi) { bi = inc; best = d.key }
  }
  return best
}
function perMinerManual(s) { const k = bestFreeDeposit(s); return k ? tripIncome(s, depositAt(s.seed, unkey(k).z)) : 0 }
function bestRoomyRegion(s) {
  let best = null, g = 0
  for (const [rk, r] of Object.entries(s.regions)) {
    if (!r.automated) continue
    const sl = S.slotsOf(s, rk).slots
    const d = rateOf(sl, r.miners + 1) - rateOf(sl, r.miners)
    if (d > g) { g = d; best = rk }
  }
  return best
}
function bestSeedTarget(s) {
  const F = S.flagTile(s), L = S.flagLevel(s)
  let best = null, br = 0
  for (const t of [F, ...neighbours(F)]) {
    for (const z of descendants(t, L, E.AUTOMATE_LEVEL)) {
      const rk = key(E.AUTOMATE_LEVEL, z), r = s.regions[rk]
      if (r && (r.automated || r.seeding)) continue
      const sl = S.slotsOf(s, rk).slots
      const rate = rateOf(sl, E.SEED_MINERS)
      if (rate > br) { br = rate; best = rk }
    }
  }
  return best
}

function maybeMove(s, did) {
  if (s.flag.tier === 1) {
    const here = tileAt(s.flag.x, s.flag.y, E.AUTOMATE_LEVEL)
    const r = s.regions[key(E.AUTOMATE_LEVEL, here)]
    if (!(r && r.automated)) return
    // the neighbouring region with the most to mine that isn't ours yet
    let best = null, br = 0
    for (const n of neighbours(here)) {
      const rk = key(E.AUTOMATE_LEVEL, n), rn = s.regions[rk]
      if (rn && (rn.automated || rn.relay)) continue
      const v = rateOf(S.slotsOf(s, rk).slots, 12)
      if (v > br) { br = v; best = n }
    }
    if (!best) return
    // stop on a level-1 tile near the region's centre with deposits around it
    const c = centre(best, E.AUTOMATE_LEVEL)
    let tile = tileAt(c[0], c[1], 1), bd = -1
    for (const t of [tile, ...neighbours(tile)]) {
      const n = depositsAround(s.seed, t, 1).length
      if (n > bd && ancestor(t, 2)[0] === best[0] && ancestor(t, 2)[1] === best[1]) { bd = n; tile = t }
    }
    did('move', S.moveFlag(s, tile))
  } else {
    if (bestSeedTarget(s)) return
    if (s.ships.some(x => x.kind === 'seeder' && x.order)) return
    const F = S.flagTile(s)
    let best = null, br = 0
    for (const n of neighbours(F)) {
      let v = 0
      for (const t of [n, ...neighbours(n)]) for (const z of descendants(t, 4, 3)) { const rk = key(3, z); if (!(s.regions[rk] || {}).automated) v++ }
      if (v > br) { br = v; best = n }
    }
    if (best) did('move', S.moveFlag(s, best))
  }
}
