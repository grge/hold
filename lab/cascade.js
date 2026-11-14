// The cascade: terrain as a dynamical system running down the scales.
//
// Every tile, at every level, has a state s = (p, a, c): three fields. Its phase (its biome) is the
// nearest of a few centroids in field space, but the phase diagram turns slowly with level (`drift`),
// so the same state means different things at different scales. A tile's seven children start from
// its state, are pulled a little toward its phase's centroid (`pull`), and get deviations shaped by its
// phase's rule:
//
//   calm       a gentle quadrupole: two opposite children up, two down
//   nucleate   one child (sometimes the centre) gets a big push, the other six share the opposite
//   banded     a dipole across the tile, plus a little quadrupole: stripes when orientations agree
//   turbulent  alternate children pushed opposite ways, plus a dipole: froth
//
// Deviations sum to zero over the seven children, so a tile is the mean of its children: zooming in
// reveals detail without changing what you saw from further out. They grow near phase boundaries
// (`edge`), which roughens coastlines at every scale. Seen per level, this is a Markov chain on
// phases: calm phases with a pull are fixed points, turbulent ones scatter into their neighbours.
//
// The same maths runs here (for the cursor readout and the phase portrait) and in the shader below;
// the hashes match lattice.js bit for bit, so the CPU and the GPU agree on every tile.

import { THETA, DIGITS, roundHex, residue, parent, hash } from '../src/lattice.js'

export const TOP = 10      // the coarsest level: roots get a random state
export const MINL = -4     // the finest level computed
export const MAX_PHASES = 8
export const RULES = ['calm', 'nucleate', 'banded', 'turbulent']

// the angle of each child digit (lattice.js DIGITS) seen from its parent, in the child level's frame
const DANG = [0, 0, 4.18879020, 5.23598776, 2.09439510, 1.04719755, 3.14159265]
// position of each digit around the ring of six (centre: -1), for the alternating pattern
const RING = [-1, 0, 4, 5, 2, 1, 3]

export const DEFAULTS = {
  seed: 1,
  gain: 1.0, decay: 0.97, pull: 0.15, edge: 1.2,
  drift: 9, twist: 0.6, jitter: 0.35, orient: 30, warp: 0.22,
  root: [0, 0, 0], rootAmp: 0.7,
  phases: [
    { name: 'Plain',  color: '#566a94', rule: 'calm',      amp: 0.7, to: -1, c: [0, 0, 0] },
    { name: 'Bloom',  color: '#a46fd8', rule: 'nucleate',  amp: 1.2, to: 3,  c: [0.55, 0.6, 0.2] },
    { name: 'Strata', color: '#c99a48', rule: 'banded',    amp: 1.0, to: -1, c: [-0.6, 0.35, -0.2] },
    { name: 'Churn',  color: '#3fa89b', rule: 'turbulent', amp: 1.2, to: 4,  c: [0.45, -0.6, 0.5] },
    { name: 'Void',   color: '#20232c', rule: 'calm',      amp: 0.4, to: 0,  c: [-0.7, -0.6, -0.4] },
  ],
}

const u3 = h => [(h & 1023) / 511.5 - 1, ((h >>> 10) & 1023) / 511.5 - 1, ((h >>> 20) & 1023) / 511.5 - 1]
const rad = d => d * Math.PI / 180

/** A phase's centroid as seen in raw state space at level L (the diagram turns by drift·L). */
export function effCentroid(P, k, L) {
  const t = -rad(P.drift) * L, c = Math.cos(t), s = Math.sin(t), [x, y, z] = P.phases[k].c
  return [c * x - s * y, s * x + c * y, z]
}

/** The phase of state s at level L, and its margin (how much nearer the nearest centroid is). */
export function phaseOf(P, s, L) {
  const t = rad(P.drift) * L, c = Math.cos(t), sn = Math.sin(t)
  const q = [c * s[0] - sn * s[1], sn * s[0] + c * s[1], s[2]]
  let d1 = Infinity, d2 = Infinity, k1 = 0
  P.phases.forEach((ph, k) => {
    const e0 = q[0] - ph.c[0], e1 = q[1] - ph.c[1], e2 = q[2] - ph.c[2], d = e0 * e0 + e1 * e1 + e2 * e2
    if (d < d1) { d2 = d1; d1 = d; k1 = k } else if (d < d2) d2 = d
  })
  return { k: k1, margin: Math.sqrt(d2) - Math.sqrt(d1) }
}

/** How child r of parent zp (at level Lp, in phase k, state s) moves away from its parent's state. */
function delta(P, k, margin, Lp, zp, r, s) {
  const ph = P.phases[k], rule = RULES.indexOf(ph.rule), seed = P.seed
  const amp = P.gain * ph.amp * Math.pow(P.decay, TOP - Lp) * (1 + P.edge * Math.exp(-margin / 0.15))
  const h = hash(seed, Lp, zp, 1)
  const phi = rad(P.orient) + P.jitter * 2 * Math.PI * (h & 1023) / 1024
  const j = (h >>> 10) % 7
  let u1 = u3(hash(seed, Lp, zp, 2))
  if (ph.to >= 0 && ph.to < P.phases.length) {              // pushes aim at another phase's centroid
    const t = effCentroid(P, ph.to, Lp), d = [t[0] - s[0], t[1] - s[1], t[2] - s[2]]
    const n = Math.hypot(...d) || 1, sign = (h >>> 13) & 1 ? 1 : 0.6
    u1 = d.map(x => sign * x / n)
  }
  if (rule === 1) return u1.map(x => amp * x * (r === j ? 1 : -1 / 6))
  if (r === 0) return [0, 0, 0]
  const ang = DANG[r] + (1 - P.twist) * (Lp - 1) * THETA
  if (rule === 0) { const w = 0.5 * Math.cos(2 * (ang - phi)); return u1.map(x => amp * w * x) }
  const u2 = u3(hash(seed, Lp, zp, 3))
  if (rule === 2) { const w1 = Math.cos(ang - phi), w2 = 0.3 * Math.cos(2 * (ang - phi)); return u1.map((x, i) => amp * (w1 * x + w2 * u2[i])) }
  const alt = RING[r] % 2 ? -1 : 1, w2 = 0.6 * Math.cos(ang - phi)
  return u1.map((x, i) => amp * (alt * x + w2 * u2[i]))
}

const cm = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c]
const bpow = L => { const m = Math.pow(7, L / 2), t = L * THETA; return [m * Math.cos(t), m * Math.sin(t)] }

// The domain warp: before a point finds its tile it is moved by smooth noise at every level, each
// octave as large as that level's tiles, so tile shapes (hexagons, Gosper islands) dissolve into
// wiggles at every scale. Octave L is value noise on a square grid in level-L lattice coordinates
// (z·β^-L: scaled and turned with the level, so octaves never line up).
const n2 = h => [(h & 0xffff) / 32767.5 - 1, (h >>> 16) / 32767.5 - 1]
const sstep = t => t * t * (3 - 2 * t)
function vnoise(seed, L, q) {
  const i = Math.floor(q[0]), j = Math.floor(q[1]), tx = sstep(q[0] - i), ty = sstep(q[1] - j)
  const a = n2(hash(seed, L, [i, j], 9)), b = n2(hash(seed, L, [i + 1, j], 9))
  const c = n2(hash(seed, L, [i, j + 1], 9)), d = n2(hash(seed, L, [i + 1, j + 1], 9))
  return [0, 1].map(k => (a[k] + (b[k] - a[k]) * tx) * (1 - ty) + (c[k] + (d[k] - c[k]) * tx) * ty)
}
export function warp(P, x, y, bottom = MINL) {
  let dx = 0, dy = 0
  for (let L = bottom; L <= TOP; L++) {
    const [u, v] = vnoise(P.seed, L, cm([x, y], bpow(-L))), g = P.warp * Math.pow(7, L / 2)
    dx += g * u; dy += g * v
  }
  return [x + dx, y + dy]
}

/**
 * The cascade at world point (x, y): the tile, state and phase at every level from TOP down to `bottom`.
 * Returns [{ L, z, s, k, margin }], coarsest first.
 */
export function chain(P, x, y, bottom = MINL) {
  if (P.warp) [x, y] = warp(P, x, y, bottom)
  let z = roundHex(...cm([x, y], bpow(-bottom)))
  const res = []
  for (let L = bottom; L < TOP; L++) { res.push(residue(z)); z = parent(z) }
  let s = P.root.map((v, i) => v + P.rootAmp * u3(hash(P.seed, TOP, z, 4))[i])
  let { k, margin } = phaseOf(P, s, TOP)
  const out = [{ L: TOP, z, s, k, margin }]
  for (let L = TOP - 1; L >= bottom; L--) {
    const r = res[L - bottom], Lp = L + 1
    const t = effCentroid(P, k, Lp), d = delta(P, k, margin, Lp, z, r, s)
    s = s.map((v, i) => v + P.pull * (t[i] - v) + d[i])
    const [a, b] = z, [da, db] = DIGITS[r]
    z = [3 * a - b + da, a + 2 * b + db];
    ({ k, margin } = phaseOf(P, s, L))
    out.push({ L, z, s, k, margin })
  }
  return out
}

/** The fragment shader: the same cascade for every pixel, from the root down to the pixel's cell. */
export const FRAG = `#version 300 es
precision highp float; precision highp int;
uniform ivec2 uZ0; uniform vec2 uF; uniform vec2 uK; uniform vec2 uHalf;
uniform int uN; uniform uint uSeed;
uniform int uPhases; uniform vec3 uCent[${MAX_PHASES}]; uniform vec3 uCol[${MAX_PHASES}];
uniform int uRule[${MAX_PHASES}]; uniform float uAmp[${MAX_PHASES}]; uniform int uTo[${MAX_PHASES}];
uniform vec3 uRoot; uniform float uRootAmp, uGain, uDecay, uPull, uEdge, uDrift, uTwist, uJitter, uOrient;
uniform int uMode, uOffset; uniform float uMemory, uShade;
uniform int uLines, uContours, uGrid;
uniform int uOctN; uniform ivec2 uOctI[20]; uniform vec2 uOctF[20]; uniform vec2 uOctK[20]; uniform float uOctA[20]; uniform vec2 uOctN0[20];
out vec4 o;
const int TOP = ${TOP};
const float S3 = 1.7320508075688772, THETA = ${THETA};
const ivec2 DIG[7] = ivec2[7](ivec2(0,0), ivec2(1,0), ivec2(-1,-1), ivec2(0,-1), ivec2(0,1), ivec2(1,1), ivec2(-1,0));
const float DANG[7] = float[7](${DANG.map(v => v.toFixed(8)).join(", ")});
const int RING[7] = int[7](${RING.join(', ')});

// v/7's fraction is a multiple of 1/7, so adding 1/14 before the floor is safe even where the GPU's
// division is off in the last bits (coordinates reach millions here)
int resid(ivec2 z){ float v = float(z.x + 4*z.y); return int(v - 7.0*floor(v/7.0 + 0.0714285)); }
ivec2 parentOf(ivec2 z){
  ivec2 w = z - DIG[resid(z)];
  return ivec2(int(round(float(2*w.x + w.y) / 7.0)), int(round(float(3*w.y - w.x) / 7.0)));
}
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
ivec2 cellAt(vec2 px){
  vec2 p = uF + cmul(px, uK);
  float q = p.x - p.y/S3, r = 2.0*p.y/S3;
  float x = q, zc = r, y = -q - r;
  float rx = floor(x+0.5), ry = floor(y+0.5), rz = floor(zc+0.5);
  float dx = abs(rx-x), dy = abs(ry-y), dz = abs(rz-zc);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dz >= dy) rz = -rx - ry;
  return uZ0 + ivec2(int(rx + rz), int(rz));
}
uint h32(uint x){ x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
uint hsh(int L, ivec2 p, int k){
  uint h = h32(uint(p.x) ^ 0x9e3779b9U);
  h = h32(h ^ uint(p.y) * 0x85ebca6bU);
  h = h32(h ^ uint(L + 1000) * 0xc2b2ae35U ^ uint(k) * 0x27d4eb2fU);
  h = h32(h ^ uSeed * 0x165667b1U);
  return h;
}
vec3 u3(uint h){ return vec3(float(h & 1023U), float((h >> 10) & 1023U), float((h >> 20) & 1023U)) / 511.5 - 1.0; }

vec2 n2(uint h){ return vec2(float(h & 0xffffU), float(h >> 16)) / 32767.5 - 1.0; }
vec2 vnoise(int L, ivec2 I, vec2 f){
  vec2 fl = floor(f); ivec2 c = I + ivec2(fl); vec2 t = f - fl; t = t*t*(3.0 - 2.0*t);
  vec2 a = n2(hsh(L, c, 9)), b = n2(hsh(L, c + ivec2(1,0), 9)), d = n2(hsh(L, c + ivec2(0,1), 9)), e = n2(hsh(L, c + ivec2(1,1), 9));
  return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
}
vec3 effCent(int k, int L){
  float t = -uDrift * float(L), c = cos(t), s = sin(t); vec3 x = uCent[k];
  return vec3(c*x.x - s*x.y, s*x.x + c*x.y, x.z);
}
int phaseOf(vec3 s, int L, out float margin){
  float t = uDrift * float(L), c = cos(t), sn = sin(t);
  vec3 q = vec3(c*s.x - sn*s.y, sn*s.x + c*s.y, s.z);
  float d1 = 1e9, d2 = 1e9; int k1 = 0;
  for (int k = 0; k < ${MAX_PHASES}; k++){
    if (k >= uPhases) break;
    vec3 e = q - uCent[k]; float d = dot(e, e);
    if (d < d1){ d2 = d1; d1 = d; k1 = k; } else if (d < d2) d2 = d;
  }
  margin = sqrt(d2) - sqrt(d1);
  return k1;
}
vec3 delta(int k, float margin, int Lp, ivec2 zp, int r, vec3 s){
  int rule = uRule[k];
  float amp = uGain * uAmp[k] * pow(uDecay, float(TOP - Lp)) * (1.0 + uEdge * exp(-margin / 0.15));
  uint h = hsh(Lp, zp, 1);
  float phi = uOrient + uJitter * 6.2831853 * float(h & 1023U) / 1024.0;
  int j = int((h >> 10) % 7U);
  vec3 u1 = u3(hsh(Lp, zp, 2));
  int to = uTo[k];
  if (to >= 0 && to < uPhases){
    vec3 d = effCent(to, Lp) - s; float n = length(d);
    u1 = (((h >> 13) & 1U) == 1U ? 1.0 : 0.6) * d / max(n, 1e-9);
  }
  if (rule == 1) return amp * u1 * (r == j ? 1.0 : -1.0/6.0);
  if (r == 0) return vec3(0.0);
  float ang = DANG[r] + (1.0 - uTwist) * float(Lp - 1) * THETA;
  if (rule == 0) return amp * 0.5 * cos(2.0 * (ang - phi)) * u1;
  vec3 u2 = u3(hsh(Lp, zp, 3));
  if (rule == 2) return amp * (cos(ang - phi) * u1 + 0.3 * cos(2.0 * (ang - phi)) * u2);
  float alt = RING[r] % 2 == 1 ? -1.0 : 1.0;
  return amp * (alt * u1 + 0.6 * cos(ang - phi) * u2);
}
vec3 diverge(float v){
  v = clamp(v, -1.5, 1.5) / 1.5;
  vec3 neg = vec3(0.25, 0.55, 0.95), mid = vec3(0.09, 0.1, 0.12), pos = vec3(0.98, 0.62, 0.25);
  return v < 0.0 ? mix(mid, neg, pow(-v, 0.8)) : mix(mid, pos, pow(v, 0.8));
}

void main(){
  vec2 px = gl_FragCoord.xy - uHalf, wp = px;
  for (int i = 0; i < 20; i++){
    if (i >= uOctN) break;
    wp += uOctA[i] * (vnoise(uN + i, uOctI[i], uOctF[i] + cmul(px, uOctK[i])) - uOctN0[i]);   // relative to the camera's
  }
  ivec2 z = cellAt(wp);
  int n = TOP - uN;
  // climb to the root, keeping each level's digit (3 bits) on the way
  uint lo = 0U, hi = 0U;
  for (int i = 0; i < 20; i++){
    if (i >= n) break;
    uint r = uint(resid(z));
    if (i < 10) lo |= r << (3*i); else hi |= r << (3*(i - 10));
    z = parentOf(z);
  }
  vec3 s = uRoot + uRootAmp * u3(hsh(TOP, z, 4));
  float margin; int k = phaseOf(s, TOP, margin);
  int Lv = min(uN + uOffset, TOP), La = min(Lv + 3, TOP);
  int pv = k, pa = k; vec3 sv = s; ivec2 zv = z;
  // and back down, one level at a time
  for (int i = 19; i >= 0; i--){
    if (i >= n) continue;
    int Lp = uN + i + 1;
    int r = int(i < 10 ? (lo >> (3*i)) & 7U : (hi >> (3*(i - 10))) & 7U);
    s += uPull * (effCent(k, Lp) - s) + delta(k, margin, Lp, z, r, s);
    z = ivec2(3*z.x - z.y, z.x + 2*z.y) + DIG[r];
    int L = Lp - 1;
    k = phaseOf(s, L, margin);
    if (L == Lv){ pv = k; sv = s; zv = z; }
    if (L == La) pa = k;
  }

  vec3 col;
  if (uMode == 0){
    // the phase, shaded by where the state sits inside it, tinted by the phase three levels up
    float t = uDrift * float(Lv), c = cos(t), sn = sin(t);
    vec3 q = vec3(c*sv.x - sn*sv.y, sn*sv.x + c*sv.y, sv.z) - uCent[pv];
    col = uCol[pv] * (1.0 + uShade * (0.35 * tanh(2.5 * q.z) + 0.15 * tanh(2.5 * q.x)));
    col = mix(col, uCol[pa], 0.4 * uMemory);
  } else {
    col = diverge(uMode == 1 ? sv.x : uMode == 2 ? sv.y : sv.z);
  }
  if (uGrid == 1 && fwidth(float(zv.x * 7 + zv.y * 131)) > 0.0) col = mix(col, vec3(0.0), 0.25);
  if (uContours == 1){
    float f = (uMode == 0 || uMode == 1 ? sv.x : uMode == 2 ? sv.y : sv.z) * 5.0;
    if (fwidth(floor(f)) > 0.0) col = mix(col, vec3(1.0), 0.18);
  }
  if (uLines == 1){
    if (fwidth(float(pa)) > 0.0) col = mix(col, vec3(0.92, 0.9, 0.85), 0.45);
    else if (fwidth(float(pv)) > 0.0) col = mix(col, vec3(0.02), 0.45);
  }
  o = vec4(col, 1.0);
}`

export const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

/** Compile the shader for a canvas; returns draw(view, P, display). */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
  if (!gl) return null
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const names = ['Z0', 'F', 'K', 'Half', 'N', 'Seed', 'Phases', 'Cent', 'Col', 'Rule', 'Amp', 'To', 'Root', 'RootAmp',
    'Gain', 'Decay', 'Pull', 'Edge', 'Drift', 'Twist', 'Jitter', 'Orient', 'Mode', 'Offset', 'Memory', 'Shade', 'Lines', 'Contours', 'Grid', 'OctN', 'OctI', 'OctF', 'OctK', 'OctA', 'OctN0']
  const u = Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, 'u' + n)]))

  /** view: { cx, cy, s (device px per world unit), W, H }; returns the finest level drawn. */
  function draw(view, P, d) {
    const { cx, cy, s, W, H } = view
    gl.viewport(0, 0, W, H)
    const uN = Math.min(TOP - 1, Math.max(MINL, Math.ceil(2 * Math.log(1.2 / s) / Math.log(7))))
    // the warp moves the camera's own point by up to thousands of units: that part is done here in double
    // precision, and the shader adds only each pixel's offset from it
    const [wx, wy] = P.warp ? warp(P, cx, cy, uN) : [cx, cy]
    const D = -uN, mod = Math.pow(7, D / 2), ang = D * THETA
    const bx = mod * Math.cos(ang), by = mod * Math.sin(ang)
    const px = wx * bx - wy * by, py = wx * by + wy * bx
    const [a, b] = roundHex(px, py)
    gl.uniform2i(u.Z0, a, b)
    gl.uniform2f(u.F, px - (a - b / 2), py - b * Math.sqrt(3) / 2)
    gl.uniform2f(u.K, bx / s, by / s)
    gl.uniform2f(u.Half, W / 2, H / 2)
    gl.uniform1i(u.N, uN)
    gl.uniform1ui(u.Seed, P.seed >>> 0)
    const n = Math.min(P.phases.length, MAX_PHASES)
    const cent = new Float32Array(MAX_PHASES * 3), col = new Float32Array(MAX_PHASES * 3)
    const rule = new Int32Array(MAX_PHASES), amp = new Float32Array(MAX_PHASES), to = new Int32Array(MAX_PHASES).fill(-1)
    P.phases.slice(0, n).forEach((ph, k) => {
      cent.set(ph.c, k * 3); col.set(hexRgb(ph.color), k * 3)
      rule[k] = RULES.indexOf(ph.rule); amp[k] = ph.amp; to[k] = ph.to
    })
    gl.uniform1i(u.Phases, n)
    gl.uniform3fv(u.Cent, cent); gl.uniform3fv(u.Col, col)
    gl.uniform1iv(u.Rule, rule); gl.uniform1fv(u.Amp, amp); gl.uniform1iv(u.To, to)
    gl.uniform3fv(u.Root, P.root); gl.uniform1f(u.RootAmp, P.rootAmp)
    gl.uniform1f(u.Gain, P.gain); gl.uniform1f(u.Decay, P.decay); gl.uniform1f(u.Pull, P.pull); gl.uniform1f(u.Edge, P.edge)
    gl.uniform1f(u.Drift, rad(P.drift)); gl.uniform1f(u.Twist, P.twist); gl.uniform1f(u.Jitter, P.jitter); gl.uniform1f(u.Orient, rad(P.orient))
    gl.uniform1i(u.Mode, d.mode); gl.uniform1i(u.Offset, d.offset); gl.uniform1f(u.Memory, d.memory); gl.uniform1f(u.Shade, d.shade)
    gl.uniform1i(u.Lines, d.lines ? 1 : 0); gl.uniform1i(u.Contours, d.contours ? 1 : 0); gl.uniform1i(u.Grid, d.grid ? 1 : 0)
    // warp octaves: each level's noise grid around the camera, split into integer and fraction here (in
    // double precision) so the shader's floats stay small
    const octN = P.warp ? TOP - uN + 1 : 0
    const oi = new Int32Array(40), of = new Float32Array(40), ok = new Float32Array(40), oa = new Float32Array(20), o0 = new Float32Array(40)
    for (let i = 0; i < octN; i++) {
      const L = uN + i, B = bpow(-L), q = cm([cx, cy], B), I = q.map(Math.floor)
      oi.set(I, 2 * i); of.set([q[0] - I[0], q[1] - I[1]], 2 * i); ok.set([B[0] / s, B[1] / s], 2 * i)
      oa[i] = P.warp * Math.pow(7, L / 2) * s
      o0.set(vnoise(P.seed, L, q), 2 * i)
    }
    gl.uniform1i(u.OctN, octN); gl.uniform2iv(u.OctI, oi); gl.uniform2fv(u.OctF, of); gl.uniform2fv(u.OctK, ok); gl.uniform1fv(u.OctA, oa); gl.uniform2fv(u.OctN0, o0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return uN
  }
  return { draw, gl }
}

export function hexRgb(h) {
  const v = parseInt(h.slice(1), 16)
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]
}
