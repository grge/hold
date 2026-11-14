// Every tunable number in one place. tools/bot.mjs plays the game against tools/targets.json to tune them.

/** A miner before upgrades: speed (world units/s), hold (resources), mining rate per slot (resources/s). */
export const BASE = { speed: 2.0, cargo: 8, rate: 1.2 }

export const UPGRADES = {
  drill: { name: 'Drills', what: 'mine 35% faster', base: 40, growth: 3.4, max: 8, apply: p => { p.rate *= 1.35 } },
  hold: { name: 'Holds', what: 'carry 30% more', base: 90, growth: 3.4, max: 8, apply: p => { p.cargo *= 1.3 } },
  engine: { name: 'Engines', what: 'fly 25% faster', base: 220, growth: 3.4, max: 8, apply: p => { p.speed *= 1.25 } },
  link: { name: 'Command link', what: 'one more command', base: 900, growth: 9, max: 3, apply: () => {} },
}
export const upgradeCost = (name, level) => Math.ceil(UPGRADES[name].base * Math.pow(UPGRADES[name].growth, level))

/** A miner's numbers after upgrades. */
export function params(up) {
  const p = { ...BASE }
  for (const [name, u] of Object.entries(UPGRADES)) for (let i = 0; i < (up[name] || 0); i++) u.apply(p)
  return p
}

export const COMMANDS_BASE = 3
export const commandsMax = up => COMMANDS_BASE + (up.link || 0)

/** A miner's price rises with the miners already in its region, so each new region starts cheap. */
export const minerCost = inRegion => Math.ceil(10 * Math.pow(1.2, inRegion))
export const relayCost = built => Math.ceil(450 * Math.pow(2.8, built))
export const RELAY_BUILD = 8            // seconds
export const AUTOMATE_LEVEL = 3          // a relay controls a level-3 region

/** Flagships by tier: the level of tile they occupy, their control area's level, and their speed. */
export const FLAGSHIPS = {
  1: { name: 'Mothership', level: 1, speed: 1.6 },
  2: { name: 'Carrier', level: 4, speed: 12 },
}
export const CARRIER_COST = 90000

// Tier 2: seeders are level-3 units: each flies to a region and sets it up, automated, with miners.
export const seederCost = bought => Math.ceil(12000 * Math.pow(1.1, bought))
export const SEED_MINERS = 6
export const SEED_TIME = 15              // seconds establishing
export const SEEDER_SPEED = 22

// The hub: a tier-2 relay over a level-6 region, which seeds every region inside it in turn.
export const HUB_LEVEL = 6
export const HUB_COST = 3000000
export const HUB_BUILD = 25
export const HUB_SEED_INTERVAL = 1.2     // seconds per region seeded
