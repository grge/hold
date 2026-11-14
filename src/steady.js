// The coarse simulation of an automated region: its steady state.
//
// A miner assigned to a slot of a deposit at distance d from the drop-off makes round trips of
//   τ = 2d / speed + cargo / (rate · richness)
// and so earns cargo / τ per second. Slots are filled best first (shortest τ), one miner each; miners
// beyond the region's slots earn nothing. A region's income is therefore an exact function of how
// many miners it has, and its state is a handful of numbers. The ships drawn in an automated region
// are a pure function of time along these same cycles: what you see is what is paid.

import { centre, unit } from './lattice.js'
import { depositsIn } from './world.js'

/** Every slot in a level-L region, best first, with its trip time and income per miner. */
export function regionSlots(seed, w, L, p) {
  const drop = centre(w, L)
  const slots = []
  for (const d of depositsIn(seed, w, L)) {
    const dist = Math.hypot(d.xy[0] - drop[0], d.xy[1] - drop[1])
    const out = dist / p.speed, mine = p.cargo / (p.rate * d.rich)
    const tau = 2 * out + mine
    for (let s = 0; s < d.slots; s++) slots.push({ deposit: d, slot: s, dist, out, mine, tau, income: p.cargo / tau })
  }
  slots.sort((x, y) => x.tau - y.tau || x.deposit.key.localeCompare(y.deposit.key) || x.slot - y.slot)
  return { drop, slots }
}

/** Income per second of n miners on these slots. */
export function rateOf(slots, n) {
  let r = 0
  for (let i = 0; i < Math.min(n, slots.length); i++) r += slots[i].income
  return r
}

/**
 * Where each miner of an automated region is at time t: out along its trip, at the deposit, or on
 * its way back, at a phase fixed by a hash. Spare miners (more than the slots) circle the relay.
 */
export function decorativeShips(seed, regionKey, slotsInfo, n, t) {
  const { drop, slots } = slotsInfo
  const ships = []
  for (let i = 0; i < n; i++) {
    const phase = unit(seed, 99, [i, regionKey.length], hashStr(regionKey))
    if (i >= slots.length) {
      const a = phase * 2 * Math.PI + t * 0.3
      ships.push({ x: drop[0] + 1.6 * Math.cos(a), y: drop[1] + 1.6 * Math.sin(a), hx: -Math.sin(a), hy: Math.cos(a), cargo: 0, spare: true })
      continue
    }
    const s = slots[i]
    const f = ((t / s.tau + phase) % 1) * s.tau
    const [dx, dy] = [s.deposit.xy[0] - drop[0], s.deposit.xy[1] - drop[1]]
    const len = Math.hypot(dx, dy) || 1
    // a small sideways offset per slot, so miners sharing a deposit don't overlap
    const side = (s.slot - 1) * 0.18, ox = -dy / len * side, oy = dx / len * side
    let k, cargo, hx = dx / len, hy = dy / len
    if (f < s.out) { k = f / s.out; cargo = 0 }
    else if (f < s.out + s.mine) { k = 1; cargo = (f - s.out) / s.mine }
    else { k = 1 - (f - s.out - s.mine) / s.out; cargo = 1; hx = -hx; hy = -hy }
    ships.push({ x: drop[0] + dx * k + ox, y: drop[1] + dy * k + oy, hx, hy, cargo, deposit: s.deposit.key })
  }
  return ships
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h >>> 0 }
