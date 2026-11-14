# The first prototype

*November 2026.* A narrow version of the concept
([`CONCEPT.md`](https://github.com/grge/idle-games-project/blob/master/prototypes/hold/CONCEPT.md)),
to test whether commanding ships, a command budget, automating what you hold and zooming out as
progression are fun together. No rivals, no fires yet.

## The model

**The map.** Gosper islands at every scale. A level-L tile is an Eisenstein integer z, centred at
z·β^L with β = 3 + ω; seven level-L tiles make one level-(L+1) tile exactly. The atoms are the level −1
hexagons (the terrain's level), so every tile is exactly a union of them and the game, the shader and
the outlines agree on which tile a point is in.

| Thing | Level | Size in level-0 tiles |
|---|---|---|
| Terrain detail | −1 | 1/7 |
| Miner, deposit | 0 | 1 |
| Mothership, relay | 1 | 7 |
| A region (what a relay holds and automation covers) | 3 | 343 |
| Seeder (a tier-2 unit) | 3 | 343 |
| Carrier (the tier-2 flagship) | 4 | 2,401 |
| Hub region | 6 | 117,649 |

**Control.** A control area is tiles: the flagship's own tile and its six neighbours (level 1 for the
mothership, level 4 for the carrier), a region with a built relay, or the hub's region once automated.
Amber is held by hand, teal is automated. Deposits you hold glow; others are dim.

**Deposits** are on level-0 tiles, placed by a seeded hash (5.5% of tiles), each with 1–3 slots and a
richness. One miner per slot; extra miners at a deposit wait.

**Commanding.** A miner ordered to a deposit flies there, fills its hold, flies back to the drop-off
(the mothership, or the region's relay once built), unloads, and repeats. Each commanded ship uses a
command; there are 3 (a Command link upgrade adds up to 3 more). Idle ships escort the flagship and
use none.

**Automation.** Once a relay is built, the region can be automated. Its commanded miners join it and
their commands come back. From then on the region is a few numbers: its miners, and its income, which
is the steady state of those miners on its best slots,

  income = Σ over the n best slots of cargo / (2·distance/speed + cargo/(rate·richness)),

paid every tick, not when ships unload. The ships still drawn in it are a pure function of time along
those same trips, so what you see is what is paid. A test checks that ships simulated one by one earn
the same rate to within 3%. Automated regions earn exactly while you're away.

**Moving on.** Miner prices rise with the miners already in their region (×1.2 each), so a region
saturates and moving to a fresh one is where growth comes from. Relays cost more each time (×2.8).

**Tier 2.** A carrier (once a region is automated) is a level-4 flagship whose area holds 49 regions. It
launches seeders: level-3 ships that fly to a region you pick and settle it, automated, with 6
miners; each uses a command while it flies and establishes. A hub holds the carrier's level-6 region;
automated, it seeds all 343 regions inside, one after another. That's the end of the prototype.

**Zoom.** You can zoom out to level 3.2 at first, and 1.6 levels further for your first automated
region, the carrier and the automated hub. Ships are drawn while they're at least a few pixels across;
further out you see the control areas and labels.

## Decisions made while building (not in the brief)

- **Orders persist.** "Mine this deposit" loops until you release the ship or it loses control.
- **Per-region miner prices.** A global price made income flat-line after the third region (the bot
  found it): every miner ever bought made the next dearer while income only grew linearly with
  regions. Pricing by region makes each new region start cheap, which is also the push to move on.
- **Selecting a miner then clicking a deposit orders it**, even if another miner is parked there.
- **Upgrades** are global multipliers (drills, holds, engines) plus Command link; they apply to
  automated regions too, by recomputing their steady state.
- **The flagship can move anywhere**; commanded miners whose deposit leaves control stop and escort.

## Pacing

Measured by `tools/bot.mjs` (seed 1, an attentive player looking every 2 s); targets in
`tools/targets.json`:

| | minutes |
|---|---|
| first region automated | 3.6 |
| second, third | 6.0, 7.9 |
| carrier | 17 |
| hub | 33 |
| every region in the hub automated | 40 |

A casual player (every 15 s) takes about 42 minutes, an idle one (every 60 s) about 54. The longest
stretch with nothing new is about 6.5 minutes, saving for the hub; everything else is under 5.

## Known gaps

- No rivals, hazards or fires: nothing yet pulls you back down to a lower zoom.
- Saving for the hub is a flat stretch.
- The tier-2 view gets busy (labels, many regions); ships at far zoom are hidden, not aggregated.
- Desktop first: touch works (tap, drag, pinch) but the panel is cramped on phones.

## Drawing, and what it costs

The ground is one fragment shader (`src/render/terrain.js`). Its first version was far too slow in the
late game: about 700 hashes per pixel for the terrain, five ancestor chains per pixel (for lines), and
every control area checked for every pixel, five times. Measured by running the page with `?perf`
(it shows where each frame's time goes) and taking parts of the shader out one at a time:

- **Terrain detail degrades with zoom.** Only about five levels of detail show at any zoom, each
  shaded by one hash, faded in as its tiles pass a few pixels and out as they fill the screen. Close up
  you see the level −1 hexagons; far out only broad tiles.
- **Automated areas are calm**: little ground detail, faint lines, quieter deposits, and their ships
  only close up (as dots before shapes). Neighbouring automated regions merge into one field.
- **Regions come from a lookup table**: a small integer texture of level-3 regions around the camera,
  one fetch per sample however many you hold. Only the flagship, hub, selection and cursor target are
  checked individually, at the five levels areas live at.
- **One climb, no arrays.** The pixel and its two neighbours (for lines) climb the levels together in
  one loop of scalars; a neighbour that meets the pixel's ancestor stops climbing. No integer division
  (it's emulated on GPUs): every division in the lattice maths is exact, so floats give the same tiles.
- **Resolution.** The ground is drawn at CSS pixels, and at half that while the camera moves; it sharpens
  a fifth of a second after it stops.

A frame of ground while panning went from 2.5–7 s to 75–110 ms in headless Chromium's software
renderer (30–70×), and no longer grows with the game. A check in the browser renders the ground and
reads back the pixel at every tile centre in view: deposits, and whether each is held, agree with the
game's own `depositAt` and control areas exactly.
