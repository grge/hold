// The world: deposits on level-0 tiles, placed by seeded hashing, so the same seed is the same world
// on every visit and the shader (render/terrain.js) can draw them without being told where they are.

import { hash, unit, descendants, centre, key, ancestor, neighbours, same } from './lattice.js'

/** Fraction of level-0 tiles holding a deposit. */
export const DEPOSIT_DENSITY = 0.055
/** The same density as an integer threshold on the top 24 bits of the hash (exact on the GPU too). */
export const DEPOSIT_THRESHOLD = Math.floor(DEPOSIT_DENSITY * 16777216)
export const DEPOSIT_SALT = 11

/** The deposit on level-0 tile z, or null: how many miners it supports, and how rich it is. */
export function depositAt(seed, z) {
  if ((hash(seed, 0, z, DEPOSIT_SALT) >>> 8) >= DEPOSIT_THRESHOLD) return null
  const u = unit(seed, 0, z, 12)
  const slots = u < 0.4 ? 1 : u < 0.8 ? 2 : 3
  const rich = 0.7 + 0.8 * unit(seed, 0, z, 13)
  return { z, key: key(0, z), slots, rich, xy: centre(z, 0) }
}

const regionDeposits = new Map()
/** Every deposit inside level-L tile w (cached per seed and tile). */
export function depositsIn(seed, w, L) {
  const k = `${seed}/${L}:${w[0]}:${w[1]}`
  let out = regionDeposits.get(k)
  if (!out) {
    out = descendants(w, L, 0).map(z => depositAt(seed, z)).filter(Boolean)
    regionDeposits.set(k, out)
  }
  return out
}

/** Deposits within a level-L tile and its six neighbours (a flagship's control area). */
export function depositsAround(seed, w, L) {
  return [w, ...neighbours(w)].flatMap(t => depositsIn(seed, t, L))
}

/**
 * Where the game starts: a level-1 tile near the origin whose control area (the tile and its
 * neighbours) has at least three deposits, one of them close, in a level-3 region with plenty of
 * room to grow. Deterministic for a seed.
 */
export function startTile(seed) {
  const candidates = []
  for (let a = -6; a <= 6; a++) for (let b = -6; b <= 6; b++) candidates.push([a, b])
  candidates.sort((p, q) => (Math.hypot(...centre(p, 1)) - Math.hypot(...centre(q, 1))))
  for (const z of candidates) {
    const near = depositsAround(seed, z, 1)
    if (near.length < 3) continue
    const c = centre(z, 1)
    if (!near.some(d => Math.hypot(d.xy[0] - c[0], d.xy[1] - c[1]) < 3.2)) continue
    const region = ancestor(z, 2)
    const slots = depositsIn(seed, region, 3).reduce((s, d) => s + d.slots, 0)
    if (slots < 22) continue
    return z
  }
  return [0, 0]
}

export { same }
