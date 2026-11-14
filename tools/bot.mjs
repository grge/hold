// Play the whole game headless and report when things happen, against tools/targets.json.
//   node tools/bot.mjs [--profile active|casual|idle] [--seed N] [--hours H] [--quiet]
import { readFileSync } from 'node:fs'
import * as S from '../src/sim.js'
import { botAct } from '../src/bot.js'

const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : d }
const PROFILES = { active: 2, casual: 15, idle: 60 }            // seconds between looks at the game
const profile = arg('profile', 'active'), every = PROFILES[profile] ?? Number(profile)
const seed = Number(arg('seed', 1)), hours = Number(arg('hours', 1.5)), quiet = process.argv.includes('--quiet')
const targets = JSON.parse(readFileSync(new URL('./targets.json', import.meta.url), 'utf8'))

const trace = process.argv.includes('--trace')
export function play({ seed, every, hours, dt = 0.1 }) {
  const s = S.newGame(seed)
  let next = 0, nextTrace = 0
  while (s.t < hours * 3600) {
    if (s.t >= next) { const did = botAct(s); next = s.t + every
      if (trace && (did.some(d => !['order', 'join', 'miner-auto'].includes(d)) || s.t >= nextTrace)) {
        console.log(`${(s.t / 60).toFixed(1).padStart(5)} min  res ${Math.round(s.res).toString().padStart(8)}  ${S.incomeRate(s).toFixed(1).padStart(8)}/s  ${did.join(' ')}`)
        nextTrace = s.t + 60
      }
    }
    S.step(s, dt)
    if (s.hub && s.hub.next >= s.hub.order.length && s.hub.automated) break
  }
  return s
}

const t0 = performance.now()
const s = play({ seed, every, hours })
const ms = performance.now() - t0
const m = t => (t / 60).toFixed(1).padStart(5)
if (!quiet) {
  console.log(`seed ${seed}, profile ${profile} (acts every ${every}s), simulated ${m(s.t)} min in ${(ms / 1000).toFixed(1)} s`)
  console.log('\nmilestone            target   bot   ratio')
  for (const [k, v] of Object.entries(targets)) {
    if (k === '_') continue
    const got = s.seen[k]
    const ratio = got === undefined ? '' : (got / 60 / v).toFixed(2)
    console.log(`${k.padEnd(20)} ${String(v).padStart(5)} ${got === undefined ? '    –' : m(got)}  ${ratio}`)
  }
}
// "Nothing new": the longest stretch without a first-of-its-kind event (purchases count: each new
// miner, upgrade level, relay, region, ship).
const firsts = Object.values(s.seen).sort((a, b) => a - b)
let gap = 0, at = 0
for (let i = 1; i < firsts.length; i++) if (firsts[i] - firsts[i - 1] > gap) { gap = firsts[i] - firsts[i - 1]; at = firsts[i - 1] }
const automated = Object.values(s.regions).filter(r => r.automated).length
console.log(`\nlongest stretch with nothing new: ${(gap / 60).toFixed(1)} min (from ${m(at)} min)`)
console.log(`end: ${automated} regions automated, ${Math.round(S.incomeRate(s)).toLocaleString()}/s, ${s.bought.miners} miners bought, upgrades ${JSON.stringify(s.up)}`)
