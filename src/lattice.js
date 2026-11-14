// The map: Gosper islands at every scale.
//
// A tile at level L is an Eisenstein integer z = a + bω (ω = e^{2πi/3}), centred at z·β^L in world
// units, with β = 3 + ω (norm 7, |β| = √7, arg β ≈ 19.1°). Level 0 tiles are one world unit apart;
// each level up is seven tiles in one, √7 times further apart. A tile's parent is (z − d)/β, where d
// is the digit in {0, ±1, ±ω, ±ω²} congruent to z mod β; its children are βz + d. Same-level
// neighbours are z plus the six units. All of it is O(1) integer arithmetic.
//
// The atoms are the hexagons of level ATOM (−1, the terrain's level): every tile at every level is
// exactly the union of its level-ATOM descendants, so the game, the shader and the outlines agree
// on which tile a point is in.

export const ATOM = -1
export const S3 = Math.sqrt(3)
export const SQ7 = Math.sqrt(7)
export const THETA = Math.atan2(S3 / 2, 2.5)            // arg β

// The six units, counterclockwise from 1: 1, 1+ω, ω, −1, −1−ω, −ω
export const UNITS = [[1, 0], [1, 1], [0, 1], [-1, 0], [-1, -1], [0, -1]]
// The digit congruent to residue k, where residue(a + bω) = (a + 4b) mod 7 (since ω ≡ −3 mod β)
export const DIGITS = [[0, 0], [1, 0], [-1, -1], [0, -1], [0, 1], [1, 1], [-1, 0]]

const m7 = x => ((x % 7) + 7) % 7
export const residue = ([a, b]) => m7(m7(a) + 4 * m7(b))

export function parent(z) {
  const d = DIGITS[residue(z)], wa = z[0] - d[0], wb = z[1] - d[1]
  return [(2 * wa + wb) / 7, (3 * wb - wa) / 7]       // (z − d)·conj(β)/7, exact
}
export function children([a, b]) {
  const ca = 3 * a - b, cb = a + 2 * b                 // βz
  return DIGITS.map(d => [ca + d[0], cb + d[1]])
}
export const neighbours = ([a, b]) => UNITS.map(([u, v]) => [a + u, b + v])
export function ancestor(z, k) { for (let i = 0; i < k; i++) z = parent(z); return z }
/** z·β^k: the descendant k levels down that shares this tile's centre. */
export function centralDescendant(z, k) {
  for (let i = 0; i < k; i++) z = [3 * z[0] - z[1], z[0] + 2 * z[1]]
  return z
}
export const same = (z, w) => z[0] === w[0] && z[1] === w[1]
export const isUnit = ([a, b]) => UNITS.some(([u, v]) => u === a && v === b)
export const key = (level, z) => `${level}:${z[0]}:${z[1]}`
export function unkey(k) { const [l, a, b] = k.split(':').map(Number); return { level: l, z: [a, b] } }

// Eisenstein coordinates to the plane (lattice units)
export const toXY = ([a, b]) => [a - b / 2, b * S3 / 2]

/** β^L as a complex number [re, im]. */
export function betaPow(L) { const m = Math.pow(7, L / 2), t = L * THETA; return [m * Math.cos(t), m * Math.sin(t)] }
const cmul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c]

/** World coordinates of the centre of tile z at level L (z may be fractional, for outline vertices). */
export function centre(z, L) { return cmul(toXY(z), betaPow(L)) }

/** Distance between tile centres at level L, in world units. */
export const spacing = L => Math.pow(7, L / 2)

/** Hex rounding in lattice units: the nearest lattice point to (x, y). */
export function roundHex(x, y) {
  const q = x - y / S3, r = 2 * y / S3, yy = -q - r
  let rx = Math.round(q), ry = Math.round(yy), rz = Math.round(r)
  const dx = Math.abs(rx - q), dy = Math.abs(ry - yy), dz = Math.abs(rz - r)
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dz >= dy) rz = -rx - ry
  return [rx + rz, rz]
}

/** The tile at level L containing world point (x, y). */
export function tileAt(x, y, L) {
  const [px, py] = cmul([x, y], betaPow(-ATOM))        // into level-ATOM lattice units
  let z = roundHex(px, py)
  for (let l = ATOM; l < L; l++) z = parent(z)
  return z
}

/** Is level-L0 tile z inside level-L tile w (L ≥ L0)? */
export const inside = (z, L0, w, L) => same(ancestor(z, L - L0), w)

/** All descendants of tile z (level L) at level L0 ≤ L. */
export function descendants(z, L, L0) {
  let out = [z]
  for (let l = L; l > L0; l--) out = out.flatMap(children)
  return out
}

/**
 * The outline of a level-L tile, relative to its centre, in world units: the boundary of the union of
 * its descendants at level `base` (ATOM by default: exact). Counterclockwise. Cached per (L, base).
 */
const outlines = new Map()
export function outline(L, base = Math.max(ATOM, L - 5)) {
  const k = `${L}/${base}`
  if (outlines.has(k)) return outlines.get(k)
  const cells = descendants([0, 0], L, base)
  const set = new Set(cells.map(([a, b]) => a + ',' + b))
  const rot60 = ([a, b]) => [a - b, a]                  // × (1 + ω) = e^{iπ/3}
  const rotm60 = ([a, b]) => [b, b - a]                 // × e^{−iπ/3} = −ω
  const next = new Map()
  for (const [a, b] of cells) {
    for (const u of UNITS) {
      if (set.has((a + u[0]) + ',' + (b + u[1]))) continue
      // the edge facing u, from the vertex towards u's clockwise neighbour to the counterclockwise one
      const cw = rotm60(u), ccw = rot60(u)
      const v1 = [3 * a + u[0] + cw[0], 3 * b + u[1] + cw[1]]    // three times the vertex: exact keys
      const v2 = [3 * a + u[0] + ccw[0], 3 * b + u[1] + ccw[1]]
      next.set(v1.join(','), v2)
    }
  }
  // Walk the longest loop (the tile is simply connected, so there should be one).
  let best = []
  const seen = new Set()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop = []
    let k2 = start
    while (!seen.has(k2) && next.has(k2)) {
      seen.add(k2)
      const [x3, y3] = k2.split(',').map(Number)
      loop.push([x3 / 3, y3 / 3])
      k2 = next.get(k2).join(',')
    }
    if (loop.length > best.length) best = loop
  }
  // Drop collinear vertices, then convert to world units.
  const pts = best.map(z => centre(z, base))
  const simple = pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length]
    return Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) > 1e-9
  })
  outlines.set(k, simple)
  return simple
}

// ---- Hashing: shared bit for bit with the shader (render/terrain.js) ----------------------------
export function h32(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16
  return x >>> 0
}
/** A 32-bit hash of (seed, level, tile, slot). */
export function hash(seed, L, [a, b], k = 0) {
  let h = h32((a ^ 0x9e3779b9) >>> 0)
  h = h32((h ^ Math.imul(b, 0x85ebca6b)) >>> 0)
  h = h32((h ^ Math.imul(L + 1000, 0xc2b2ae35) ^ Math.imul(k, 0x27d4eb2f)) >>> 0)
  h = h32((h ^ Math.imul(seed, 0x165667b1)) >>> 0)
  return h
}
/** A hash as a number in [0, 1). */
export const unit = (seed, L, z, k = 0) => (hash(seed, L, z, k) >>> 8) / 16777216
