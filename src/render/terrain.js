// The ground, in WebGL 2: terrain down to the level −1 hexagons, Gosper tile lines at every scale,
// deposits, and the control areas, tinted and outlined exactly. Every pixel finds its level-uN cell
// (the finest level still at least ~1 px), then climbs to its ancestors with the same integer maths
// as lattice.js; deposits use the same hash as world.js, so what is drawn is what the game knows.

import { ATOM, THETA, roundHex, toXY, tileAt } from '../lattice.js'
import { DEPOSIT_THRESHOLD, DEPOSIT_SALT } from '../world.js'

export const MAX_AREAS = 8    // the short list: flagship, hub, selection, target (regions use a table)
const LM = 9           // ancestors kept per pixel: levels uN .. uN + 8
export const REG_HALF = 64   // the region table covers level-3 tiles within 64 of the camera's
const TOP = 9          // the terrain's coarsest level

// Area kinds (see main.js): 1 flagship area (with neighbours), 2 region held by a relay, 3 automated
// region, 4 automated hub, 5 selected region (outline), 6 target under the cursor, 7 relay being built
export const AREA = { FLAG: 1, HELD: 2, AUTO: 3, HUB: 4, SELECT: 5, TARGET: 6, BUILDING: 7 }
const NEIGHBOURS = 16  // a bit on the kind: the area includes the tile's six neighbours

const frag = `#version 300 es
precision highp float; precision highp int;
uniform ivec2 uZ0; uniform vec2 uF; uniform vec2 uK; uniform vec2 uHalf;
uniform int uN; uniform float uCell; uniform uint uSeed; uniform uint uDepThr;
uniform ivec4 uArea[${MAX_AREAS}]; uniform int uAreaN;
uniform highp usampler2D uReg; uniform ivec2 uR0;   // level-3 regions' kinds, around the camera's region
out vec4 o;
const int LM = ${LM};
const int TOP = ${TOP};
const float S3 = 1.7320508075688772;

// Parents without integer division (slow on GPUs): every division here is exact, or a floor of
// small integers, so float arithmetic gives the same answers as lattice.js.
const ivec2 DIG[7] = ivec2[7](ivec2(0,0), ivec2(1,0), ivec2(-1,-1), ivec2(0,-1), ivec2(0,1), ivec2(1,1), ivec2(-1,0));
int resid(ivec2 z){ float v = float(z.x + 4*z.y); return int(v - 7.0*floor(v/7.0 + 1e-4)); }
ivec2 parentOf(ivec2 z){
  ivec2 w = z - DIG[resid(z)];
  return ivec2(int(round(float(2*w.x + w.y) / 7.0)), int(round(float(3*w.y - w.x) / 7.0)));
}
bool isUnit(ivec2 d){
  return d == ivec2(1,0) || d == ivec2(-1,0) || d == ivec2(0,1) || d == ivec2(0,-1) || d == ivec2(1,1) || d == ivec2(-1,-1);
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
float rnd(int L, ivec2 p, int k){ return float(hsh(L, p, k) >> 8) / 8388608.0 - 1.0; }

// The ground shows a few levels of detail at any zoom, never all of them: each level's tiles get a
// shade from one hash, faded in as they grow past a few pixels and out as they fill the screen. So
// close up you see the level −1 hexagons; far out, only broad tiles.
//
// Everything is done in one climb up the levels, for this pixel and the pixels just right of and
// above it (for lines), with no arrays: GPUs keep scalars in registers but spill arrays indexed at run
// time to slow memory, which made this shader several times slower.
bool inTile(ivec2 t, ivec4 ar){ return t == ar.yz || ((ar.w & ${NEIGHBOURS}) != 0 && isUnit(t - ar.yz)); }
// a level-3 region's kind from the lookup table (0: none), for regions within ${REG_HALF} tiles of the camera's
int regionKind(ivec2 t){
  ivec2 d = t - uR0 + ivec2(${REG_HALF});
  if (any(lessThan(d, ivec2(0))) || any(greaterThanEqual(d, ivec2(${REG_HALF * 2})))) return 0;
  return int(texelFetch(uReg, d, 0).r);
}
vec3 ground(float h, float m){
  vec3 lo = vec3(0.065, 0.085, 0.108), mid = vec3(0.10, 0.128, 0.155), hi = vec3(0.155, 0.18, 0.2);
  float x = clamp(0.5 + 1.6*h, 0.0, 1.0);
  vec3 c = x < 0.5 ? mix(lo, mid, x/0.5) : mix(mid, hi, (x-0.5)/0.5);
  return mix(c, c * vec3(0.92, 1.0, 1.08), clamp(0.5 + 2.0*m, 0.0, 1.0));   // a cool/warm drift
}
vec3 areaTint(int kind){
  if (kind == ${AREA.FLAG} || kind == ${AREA.HELD} || kind == ${AREA.BUILDING}) return vec3(0.96, 0.66, 0.30);
  if (kind == ${AREA.AUTO} || kind == ${AREA.HUB}) return vec3(0.30, 0.85, 0.78);
  if (kind == ${AREA.SELECT}) return vec3(0.95, 0.95, 0.92);
  return vec3(1.0, 0.97, 0.88);
}

void main(){
  vec2 px = gl_FragCoord.xy - uHalf;
  ivec2 z = cellAt(px), z0 = cellAt(px + vec2(1.5, 0.0)), z2 = cellAt(px + vec2(0.0, 1.5));
  bool m0 = z0 == z, m2 = z2 == z;               // once a neighbour shares an ancestor, it shares all above
  float h = 0.0, m = 0.0, ink = 0.0, regionInk = 0.0;
  bool dep = false, depEdge = false;
  int rk = 0, rk0 = 0, rk2 = 0, inM = 0, in0 = 0, in2 = 0;
  // the three samples' tiles at the levels areas live at (0, 1, 3, 4, 6), noted on the way up
  ivec2 a0 = z, a1 = z, a3 = z, a4 = z, a6 = z, b0 = z0, b1 = z0, b3 = z0, b4 = z0, b6 = z0, c0 = z2, c1 = z2, c3 = z2, c4 = z2, c6 = z2;
  // a level's tiles on screen: size = uCell·√7^i, and its logarithm, kept as running values (no pow, log)
  float size = uCell / 2.6457513, lsize = log(uCell) - 0.97295507;
  for (int i = 0; i < LM; i++){
    int L = uN + i;
    if (i > 0){
      z = parentOf(z);
      if (m0) z0 = z; else { z0 = parentOf(z0); m0 = z0 == z; }
      if (m2) z2 = z; else { z2 = parentOf(z2); m2 = z2 == z; }
    }
    size *= 2.6457513; lsize += 0.97295507;                          // this level's tiles, in px
    bool diff = !m0 || !m2;
    if (diff){
      float w = smoothstep(7.0, 30.0, size) * (1.0 - smoothstep(900.0, 3000.0, size));
      ink = max(ink, w * clamp((lsize - 1.7917595) / 5.2983174, 0.15, 1.0));
      if (L == 3) regionInk = clamp((lsize - 1.3862944) / 3.6888795, 0.0, 1.0) * (1.0 - smoothstep(1500.0, 4000.0, size));
    }
    if (i >= 1 && i <= 5 && L <= TOP){
      float w = smoothstep(5.0, 22.0, size) * (1.0 - smoothstep(500.0, 1800.0, size));
      if (w > 0.0){
        uint hh = hsh(L, z, 7);
        h += w * 0.16 * (float(hh & 0xffffU) / 32768.0 - 1.0);
        m += w * 0.16 * (float(hh >> 16) / 32768.0 - 1.0);
      }
    }
    if (L == 0){ dep = (hsh(0, z, ${DEPOSIT_SALT}) >> 8) < uDepThr; depEdge = diff; }
    if (L == 3){ rk = regionKind(z); rk0 = regionKind(z0); rk2 = regionKind(z2); }
    if (L == 0){ a0 = z; b0 = z0; c0 = z2; }
    if (L == 1){ a1 = z; b1 = z0; c1 = z2; }
    if (L == 3){ a3 = z; b3 = z0; c3 = z2; }
    if (L == 4){ a4 = z; b4 = z0; c4 = z2; }
    if (L == 6){ a6 = z; b6 = z0; c6 = z2; }
  }
  for (int k = 0; k < ${MAX_AREAS}; k++){
    if (k >= uAreaN) break;
    ivec4 ar = uArea[k];
    if (ar.x < uN) continue;
    ivec2 ta = ar.x == 0 ? a0 : ar.x == 1 ? a1 : ar.x == 3 ? a3 : ar.x == 4 ? a4 : a6;
    ivec2 tb = ar.x == 0 ? b0 : ar.x == 1 ? b1 : ar.x == 3 ? b3 : ar.x == 4 ? b4 : b6;
    ivec2 tc = ar.x == 0 ? c0 : ar.x == 1 ? c1 : ar.x == 3 ? c3 : ar.x == 4 ? c4 : c6;
    if (inTile(ta, ar)) inM |= 1 << k;
    if (inTile(tb, ar)) in0 |= 1 << k;
    if (inTile(tc, ar)) in2 |= 1 << k;
  }

  // control areas: regions from the table, then the few listed areas
  bool auto = false, held = false;
  vec3 tintIn = vec3(0.0); float tintW = 0.0; vec3 edgeCol = vec3(0.0); float edgeW = 0.0;
  for (int k = -1; k < ${MAX_AREAS}; k++){
    if (k >= uAreaN) break;
    int kind; bool c, edge;
    if (k < 0){
      kind = max(rk, max(rk0, rk2));
      if (kind == 0) continue;
      c = rk != 0; edge = rk != rk0 || rk != rk2;
      if (c) kind = rk;
    } else {
      kind = uArea[k].w & 15;
      int bit = 1 << k;
      c = (inM & bit) != 0;
      edge = c != ((in0 & bit) != 0) || c != ((in2 & bit) != 0);
    }
    vec3 tint = areaTint(kind);
    if (c){
      if (kind == ${AREA.AUTO} || kind == ${AREA.HUB}) auto = true;
      if (kind == ${AREA.FLAG} || kind == ${AREA.HELD} || kind == ${AREA.AUTO} || kind == ${AREA.HUB}) held = true;
      if (kind != ${AREA.SELECT}){
        float w = kind == ${AREA.TARGET} ? 0.22 : (kind == ${AREA.AUTO} || kind == ${AREA.HUB}) ? 0.13 : 0.09;
        if (w > tintW){ tintW = w; tintIn = tint; }
      }
    }
    if (edge){
      float w = kind == ${AREA.TARGET} ? 0.9 : kind == ${AREA.SELECT} ? 0.85 : kind == ${AREA.HUB} ? 0.55 : 0.75;
      if (kind == ${AREA.BUILDING} && mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 7.0), 2.0) < 1.0) w = 0.0;
      if (w >= edgeW){ edgeW = w; edgeCol = tint; }
    }
  }

  // an automated area is drawn calm: little ground detail, faint lines
  float calm = auto ? 0.2 : 1.0;
  vec3 col = ground(h * calm, m * calm);
  col = mix(col, vec3(0.02, 0.03, 0.04), 0.5 * ink * (auto ? 0.35 : 1.0));
  col = mix(col, vec3(0.32, 0.38, 0.44), 0.35 * regionInk);

  // deposits: bright where you hold them, dim elsewhere, fading out as they shrink to a few pixels
  if (dep){
    float vis = smoothstep(3.0, 9.0, uCell * pow(2.6457513, float(-uN))) * (auto ? 0.6 : 1.0);
    col = held ? mix(col, vec3(0.66, 0.44, 1.0), 0.72 * max(vis, 0.35)) : mix(col, vec3(0.42, 0.34, 0.56), 0.45 * vis);
    if (depEdge) col = mix(col, held ? vec3(0.9, 0.8, 1.0) : vec3(0.55, 0.48, 0.66), 0.7 * vis);
  }

  col = mix(col, tintIn, tintW);
  col = mix(col, edgeCol, edgeW);
  o = vec4(col, 1.0);
}`

const vert = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`

export function createTerrain(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false })
  if (!gl) return null
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vert)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
  gl.useProgram(prog)
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const u = {}
  for (const n of ['Z0', 'F', 'K', 'Half', 'N', 'Cell', 'Seed', 'DepThr', 'Area', 'AreaN', 'Reg', 'R0']) u[n] = gl.getUniformLocation(prog, 'u' + n)
  const SIZE = REG_HALF * 2, regData = new Uint8Array(SIZE * SIZE)
  const regTex = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, regTex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, SIZE, SIZE, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, regData)
  gl.uniform1i(u.Reg, 0)
  let regSig = ''
  const areaBuf = new Int32Array(MAX_AREAS * 4)

  /**
   * Draw the ground for camera centre (cx, cy), scale s (device px per world unit), on a canvas W×H.
   * areas: [{ level, z, kind, neighbours }].
   */
  function draw({ cx, cy, s, W, H, seed, areas, regions = [] }) {
    // the region table, centred on the camera's level-3 tile; uploaded only when it changes
    const [r0a, r0b] = tileAt(cx, cy, 3)
    const sig = r0a + ',' + r0b + '|' + regions.map(r => r.z[0] + ',' + r.z[1] + ':' + r.kind).join(';')
    if (sig !== regSig) {
      regSig = sig
      regData.fill(0)
      for (const r of regions) {
        const x = r.z[0] - r0a + REG_HALF, y = r.z[1] - r0b + REG_HALF
        if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) regData[y * SIZE + x] = r.kind
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIZE, SIZE, gl.RED_INTEGER, gl.UNSIGNED_BYTE, regData)
    }
    gl.uniform2i(u.R0, r0a, r0b)
    gl.viewport(0, 0, W, H)
    const uN = Math.max(ATOM, Math.ceil(2 * Math.log(1.2 / s) / Math.log(7)))
    const D = -uN                                          // depth: lattice coords = world · β^D
    const mod = Math.pow(7, D / 2), ang = D * THETA
    const bx = mod * Math.cos(ang), by = mod * Math.sin(ang)
    const px = cx * bx - cy * by, py = cx * by + cy * bx
    const [a, b] = roundHex(px, py)
    const [fx, fy] = toXY([a, b])
    gl.uniform2i(u.Z0, a, b)
    gl.uniform2f(u.F, px - fx, py - fy)
    gl.uniform2f(u.K, bx / s, by / s)
    gl.uniform2f(u.Half, W / 2, H / 2)
    gl.uniform1i(u.N, uN)
    gl.uniform1f(u.Cell, s / mod)
    gl.uniform1ui(u.Seed, seed >>> 0)
    gl.uniform1ui(u.DepThr, DEPOSIT_THRESHOLD)
    const n = Math.min(areas.length, MAX_AREAS)
    areaBuf.fill(0)
    for (let i = 0; i < n; i++) {
      const ar = areas[i]
      areaBuf.set([ar.level, ar.z[0], ar.z[1], ar.kind | (ar.neighbours ? NEIGHBOURS : 0)], i * 4)
    }
    gl.uniform4iv(u.Area, areaBuf)
    gl.uniform1i(u.AreaN, n)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  return { draw, gl }
}
