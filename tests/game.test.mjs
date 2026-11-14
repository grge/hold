import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as L from '../src/lattice.js'
import * as S from '../src/sim.js'
import { rateOf } from '../src/steady.js'
import { depositAt, depositsIn } from '../src/world.js'
import { botAct } from '../src/bot.js'
import * as E from '../src/economy.js'

test('lattice: parents and children invert, a parent is centred on its children', () => {
  for (let a = -15; a <= 15; a++) for (let b = -15; b <= 15; b++) {
    const z = [a, b], p = L.parent(z)
    assert.ok(Number.isInteger(p[0]) && Number.isInteger(p[1]))
    assert.ok(L.children(p).some(c => L.same(c, z)))
  }
  const w = [3, -2], cs = L.children(w).map(c => L.centre(c, 2))
  const mean = cs.reduce((s, c) => [s[0] + c[0] / 7, s[1] + c[1] / 7], [0, 0])
  const c = L.centre(w, 3)
  assert.ok(Math.hypot(mean[0] - c[0], mean[1] - c[1]) < 1e-9)
})

test('lattice: every tile finds itself, and descendants lie inside their ancestor', () => {
  for (const lv of [-1, 0, 1, 3, 4]) for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
    const [x, y] = L.centre([a, b], lv)
    assert.deepEqual(L.tileAt(x, y, lv), [a, b])
  }
  for (const z of L.descendants([2, 1], 3, 0)) {
    const [x, y] = L.centre(z, 0)
    assert.deepEqual(L.tileAt(x, y, 3), [2, 1])
  }
})

test('lattice: a tile outline has the area of its seven children', () => {
  const area = poly => poly.reduce((s, [x1, y1], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return s + (x1 * y2 - x2 * y1) / 2 }, 0)
  assert.ok(Math.abs(area(L.outline(1)) - 7 * area(L.outline(0))) < 1e-9)
})

test('world: deposits are a pure function of the seed', () => {
  const a = depositsIn(5, [0, 0], 3).map(d => d.key), b = depositsIn(5, [0, 0], 3).map(d => d.key)
  assert.deepEqual(a, b)
  assert.ok(a.length > 5)
  assert.notDeepEqual(depositsIn(6, [1, 0], 3).map(d => d.key), depositsIn(5, [1, 0], 3).map(d => d.key))
})

/** A game with a built relay in the starting region and `n` miners commanded onto its best slots. */
function minedRegion(n) {
  const s = S.newGame(3)
  s.res = 1e9
  S.buildRelay(s)
  for (let i = 0; i < 200; i++) S.step(s)
  const rk = S.flagRegion(s)
  assert.ok(s.regions[rk].relay.built)
  s.up.link = 3
  while (s.ships.filter(x => x.kind === 'miner').length < n) S.buyMiner(s)
  const slots = S.slotsOf(s, rk).slots
  s.ships.filter(x => x.kind === 'miner').forEach((sh, i) => {
    const r = S.orderMine(s, sh.id, slots[i].deposit.key)
    assert.ok(r.ok, r.msg)
  })
  return { s, rk, slots }
}

test('steady state: what an automated region is paid is what its ships would earn', () => {
  const n = 5
  const { s, rk, slots } = minedRegion(n)
  // the fine simulation, ships flying, for a long while after a warm-up
  for (let i = 0; i < 1200; i++) S.step(s)
  const e0 = s.earned, t0 = s.t
  for (let i = 0; i < 24000; i++) S.step(s)
  const fine = (s.earned - e0) / (s.t - t0)
  const coarse = rateOf(slots, n)
  assert.ok(Math.abs(fine - coarse) / coarse < 0.03, `fine ${fine.toFixed(3)} vs steady state ${coarse.toFixed(3)}`)
  // and automating keeps the rate, exactly, while freeing every command
  S.automate(s, rk)
  assert.equal(S.commandsUsed(s), 0)
  assert.ok(Math.abs(S.regionRate(s, rk) - coarse) < 1e-9)
})

test('commands: three at first; automating gives them back', () => {
  const s = S.newGame(2)
  s.res = 1e6
  for (let i = 0; i < 4; i++) S.buyMiner(s)
  const miners = s.ships.filter(x => x.kind === 'miner')
  const deps = L.neighbours(S.flagTile(s)).concat([S.flagTile(s)]).flatMap(t => depositsIn(s.seed, t, 1))
  const multi = deps.flatMap(d => Array(d.slots).fill(d.key))
  let ok = 0, refused = null
  for (const sh of miners) { const r = S.orderMine(s, sh.id, multi[ok] || multi[0]); if (r.ok) ok++; else refused = r.msg }
  assert.equal(ok, 3)
  assert.match(refused, /No commands free/)
  assert.equal(S.release(s, miners[0].id).ok, true)
  assert.equal(S.commandsUsed(s), 2)
})

test('saving: the state survives JSON, and the game carries on the same', () => {
  const { s } = minedRegion(3)
  for (let i = 0; i < 500; i++) S.step(s)
  const copy = JSON.parse(JSON.stringify(s))
  for (let i = 0; i < 500; i++) { S.step(s); S.step(copy) }
  assert.equal(copy.earned, s.earned)
  assert.deepEqual(copy.ships, s.ships)
})

test('offline: automated regions earn exactly their rate while away', () => {
  const { s, rk } = minedRegion(4)
  S.automate(s, rk)
  const r0 = s.res, rate = S.automatedRate(s)
  S.fastForward(s, 3600)
  assert.ok(Math.abs(s.res - r0 - rate * 3600) < 1e-6)
})

test('the bot plays the whole prototype through within an hour', () => {
  const s = S.newGame(1)
  let next = 0
  while (s.t < 3600 && !(s.hub && s.hub.automated && s.hub.next >= s.hub.order.length)) {
    if (s.t >= next) { botAct(s); next = s.t + 2 }
    S.step(s, 0.1)
  }
  assert.ok('carrier' in s.seen, 'built a carrier')
  assert.ok('hub-done' in s.seen, 'automated a whole level-6 region')
  assert.ok(s.seen['automated-1'] < 6 * 60, 'first region automated within six minutes')
})

test('economy: costs are positive and rise', () => {
  assert.ok(E.minerCost(1) > E.minerCost(0))
  assert.ok(E.relayCost(1) > E.relayCost(0))
  assert.ok(depositAt(1, [0, 0]) === null || depositAt(1, [0, 0]).slots >= 1)
})
