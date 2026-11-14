# Hold

A prototype incremental game: command a swarm on nested Gosper tiles, automate what you hold, zoom out.

**[Play it](https://grge.github.io/hold/)** (desktop browser with WebGL 2).

You start with a mothership and one miner. Miners work deposits inside your control area and bring
the load home, but you can only command a few ships at once. Build a relay to hold a whole region,
automate it, and its miners run themselves at their steady state: the region becomes a few numbers,
earns while you're away, and your commands come back. Move on, zoom out, and do it again at larger
scales: a carrier works a level up and launches seeders that settle whole regions; a hub automates
343 regions at once.

The concept, and why it's built this way, is in
[`idle-games-project/prototypes/hold/CONCEPT.md`](https://github.com/grge/idle-games-project/blob/master/prototypes/hold/CONCEPT.md).
What this first prototype includes, and what it leaves out, is in [docs/prototype.md](docs/prototype.md).

**[Terrain lab](https://grge.github.io/hold/lab/terrain.html)**: a playground for the next terrain, fields
cascading down the scales with phases as biomes ([docs/terrain-lab.md](docs/terrain-lab.md)).

## Playing

- **Click a miner, then click a violet deposit** inside your control (the amber outline). It mines and
  delivers on its own from then on. Each commanded ship uses one of your commands.
- **B** builds a miner, **R** a relay, **A** automates the region the mothership is in, **M** then a
  click moves the flagship, **F** finds it, **Tab** selects the next idle ship, **Esc** deselects.
- Drag to pan, scroll or pinch to zoom. How far out you may zoom grows with what you've automated.
- Click an automated region (teal) to add miners to it or take one out. Click a miner and then an
  automated region to hand it over.
- The ×4 and ×16 buttons are a prototype tool for getting through it quickly.
- Progress saves in your browser; automated regions keep earning while you're away.

## Running it

No build step and no dependencies: serve the folder and open it.

```bash
python3 -m http.server 8000      # then http://localhost:8000
npm test                         # the simulation's tests (node ≥ 20)
node tools/bot.mjs               # a bot plays the whole game and reports the pacing
node tools/bot.mjs --profile idle --trace
```

Pushing to `main` runs the tests and the bot, then deploys to GitHub Pages
(`.github/workflows/pages.yml`).

## How it's built

```
index.html, style.css
src/
  lattice.js     Gosper islands: Eisenstein integers, parents, children, neighbours, outlines, hashing
  world.js       seeded deposits (the shader draws them from the same hash)
  economy.js     every tunable number
  steady.js      an automated region's steady state, and the ships drawn from it
  sim.js         the game: pure state, a fixed-tick step, and the actions
  bot.js         a player for pacing and tests
  main.js, ui.js the page: camera, input, panel, hints, saving
  render/        terrain.js (WebGL 2: ground, tiles, deposits, control areas), overlay.js (2D: ships)
tests/           node --test
tools/           bot.mjs, targets.json (the pacing timeline)
```

The simulation is pure and seeded, separate from rendering, so the bot and the tests drive the same
code as the page.
