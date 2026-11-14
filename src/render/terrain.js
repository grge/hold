// The ground, in WebGL 2: terrain down to the level −1 hexagons, Gosper tile lines at every scale,
// deposits, and the control areas, tinted and outlined exactly. Every pixel finds its level-uN cell
// (the finest level still at least ~1 px), then climbs to its ancestors with the same integer maths
// as lattice.js; deposits use the same hash as world.js, so what is drawn is what the game knows.

import { ATOM, THETA, roundHex, toXY } from '../lattice.js'
import { DEPOSIT_THRESHOLD, DEPOSIT_SALT } from '../world.js'

export const MAX_AREAS = 96
const LM = 12          // ancestors kept per pixel: levels uN .. uN + 11
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
out vec4 o;
const int LM = ${LM};
const int TOP = ${TOP};
const float S3 = 1.7320508075688772;

int mod7(int x){ if (x >= 0) return x - (x/7)*7; int y = -x; int r = y - (y/7)*7; return r == 0 ? 0 : 7 - r; }
int div7(int x){ return x >= 0 ? x/7 : -((-x)/7); }
ivec2 digitFor(int k){
  if (k==1) return ivec2(1,0);  if (k==6) return ivec2(-1,0);
  if (k==4) return ivec2(0,1);  if (k==3) return ivec2(0,-1);
  if (k==2) return ivec2(-1,-1); if (k==5) return ivec2(1,1);
  return ivec2(0,0);
}
int resid(ivec2 z){ return mod7(mod7(z.x) + 4*mod7(z.y)); }
ivec2 parentOf(ivec2 z){ ivec2 w = z - digitFor(resid(z)); return ivec2(div7(2*w.x + w.y), div7(3*w.y - w.x)); }
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

// ancestors of a pixel's cell: a[i] is its tile at level uN + i
void chain(vec2 px, out ivec2 a[LM]){ ivec2 z = cellAt(px); for (int i=0;i<LM;i++){ a[i] = z; z = parentOf(z); } }
ivec2 at(ivec2 a[LM], int L){ return a[clamp(L - uN, 0, LM-1)]; }

// Terraced fields: each child adds a deviation to its parent, the seven deviations summing to zero,
// so a coarse tile is exactly the mean of its children and zooming out never shifts the colours.
vec2 fields(ivec2 a[LM]){
  float h = 0.0, m = 0.0;
  for (int i = 0; i < LM-1; i++){
    int L = uN + i;
    if (L >= TOP) break;
    ivec2 p = a[i+1]; int k = resid(a[i]);
    float s = 0.0, t = 0.0;
    for (int kk = 0; kk < 7; kk++){ s += rnd(L, p, kk*2); t += rnd(L, p, kk*2+1); }
    float amp = 0.5 * pow(7.0, 0.22 * float(L - TOP));
    h += amp * (rnd(L, p, k*2) - s/7.0);
    m += amp * (rnd(L, p, k*2+1) - t/7.0);
  }
  return vec2(h, m);
}
vec3 ground(float h, float m, float grain){
  vec3 lo = vec3(0.055, 0.075, 0.098), mid = vec3(0.105, 0.135, 0.165), hi = vec3(0.19, 0.215, 0.235);
  float x = clamp(0.5 + 1.1*h, 0.0, 1.0);
  vec3 c = x < 0.55 ? mix(lo, mid, x/0.55) : mix(mid, hi, (x-0.55)/0.45);
  c = mix(c, c * vec3(0.92, 1.0, 1.08), clamp(0.5 + 1.4*m, 0.0, 1.0));   // a cool/warm drift
  return c * (1.0 + grain);
}
bool inArea(ivec2 a[LM], ivec4 ar){
  int kind = ar.w & 15; bool nb = (ar.w & ${NEIGHBOURS}) != 0;
  if (ar.x < uN) return false;
  ivec2 t = at(a, ar.x), z = ar.yz;
  return t == z || (nb && isUnit(t - z));
}
vec3 areaTint(int kind){
  if (kind == ${AREA.FLAG} || kind == ${AREA.HELD} || kind == ${AREA.BUILDING}) return vec3(0.96, 0.66, 0.30);
  if (kind == ${AREA.AUTO} || kind == ${AREA.HUB}) return vec3(0.30, 0.85, 0.78);
  if (kind == ${AREA.SELECT}) return vec3(0.95, 0.95, 0.92);
  return vec3(1.0, 0.97, 0.88);
}

void main(){
  vec2 px = gl_FragCoord.xy - uHalf;
  ivec2 a[LM]; chain(px, a);
  vec2 f = fields(a);
  float grain = 0.05 * rnd(uN, a[0], 99) * smoothstep(4.0, 30.0, uCell);
  vec3 col = ground(f.x, f.y, grain);

  // neighbours a pixel and a bit away, for every kind of line
  ivec2 n0[LM], n1[LM], n2[LM], n3[LM];
  chain(px + vec2(1.25, 0.0), n0); chain(px + vec2(-1.25, 0.0), n1);
  chain(px + vec2(0.0, 1.25), n2); chain(px + vec2(0.0, -1.25), n3);

  // tile lines: the coarsest level at which this pixel and a neighbour differ, inked by its size
  float ink = 0.0, regionInk = 0.0;
  for (int i = 1; i < LM; i++){
    bool d = a[i] != n0[i] || a[i] != n1[i] || a[i] != n2[i] || a[i] != n3[i];
    if (!d) continue;
    float size = uCell * pow(2.6457513, float(i));
    ink = max(ink, clamp(log(size / 6.0) / log(200.0), 0.0, 1.0));
    if (uN + i == 3) regionInk = clamp(log(size / 4.0) / log(40.0), 0.0, 1.0);
  }
  if (a[0] != n0[0] || a[0] != n1[0] || a[0] != n2[0] || a[0] != n3[0]) ink = max(ink, 0.12 * smoothstep(5.0, 24.0, uCell));
  col = mix(col, vec3(0.02, 0.03, 0.04), 0.55 * ink);
  col = mix(col, vec3(0.32, 0.38, 0.44), 0.35 * regionInk);

  // deposits: level-0 tiles that hash under the threshold; bright where you hold them, dim elsewhere
  if (uN <= 0){
    ivec2 z0 = at(a, 0);
    if ((hsh(0, z0, ${DEPOSIT_SALT}) >> 8) < uDepThr){
      bool held = false;
      for (int i = 0; i < ${MAX_AREAS}; i++){
        if (i >= uAreaN) break;
        int kind = uArea[i].w & 15;
        if (kind != ${AREA.SELECT} && kind != ${AREA.TARGET} && kind != ${AREA.BUILDING} && inArea(a, uArea[i])) held = true;
      }
      // fade out as deposits shrink to a few pixels, so the far view isn't speckled
      float px0 = uCell * pow(2.6457513, float(-uN));
      float vis = smoothstep(2.0, 6.0, px0);
      col = held ? mix(col, vec3(0.66, 0.44, 1.0), 0.72 * max(vis, 0.35)) : mix(col, vec3(0.42, 0.34, 0.56), 0.45 * vis);
      ivec2 e0 = at(n0, 0), e1 = at(n1, 0), e2 = at(n2, 0), e3 = at(n3, 0);
      if (e0 != z0 || e1 != z0 || e2 != z0 || e3 != z0) col = mix(col, held ? vec3(0.9, 0.8, 1.0) : vec3(0.55, 0.48, 0.66), 0.7 * vis);
    }
  }

  // control areas: a tint inside, a line along the edge
  for (int i = 0; i < ${MAX_AREAS}; i++){
    if (i >= uAreaN) break;
    ivec4 ar = uArea[i];
    int kind = ar.w & 15;
    bool c = inArea(a, ar);
    bool edge = c != inArea(n0, ar) || c != inArea(n1, ar) || c != inArea(n2, ar) || c != inArea(n3, ar);
    vec3 tint = areaTint(kind);
    if (c && kind != ${AREA.SELECT}) col = mix(col, tint, kind == ${AREA.TARGET} ? 0.22 : kind == ${AREA.HUB} ? 0.05 : 0.09);
    if (edge){
      float w = kind == ${AREA.TARGET} ? 0.9 : kind == ${AREA.SELECT} ? 0.85 : kind == ${AREA.HUB} ? 0.55 : 0.75;
      if (kind == ${AREA.BUILDING} && mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 7.0), 2.0) < 1.0) w = 0.0;
      col = mix(col, tint, w);
    }
  }
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
  for (const n of ['Z0', 'F', 'K', 'Half', 'N', 'Cell', 'Seed', 'DepThr', 'Area', 'AreaN']) u[n] = gl.getUniformLocation(prog, 'u' + n)
  const areaBuf = new Int32Array(MAX_AREAS * 4)

  /**
   * Draw the ground for camera centre (cx, cy), scale s (device px per world unit), on a canvas W×H.
   * areas: [{ level, z, kind, neighbours }].
   */
  function draw({ cx, cy, s, W, H, seed, areas }) {
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
