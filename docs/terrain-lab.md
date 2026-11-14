# The terrain lab

*November 2026.* [`lab/terrain.html`](../lab/terrain.html) ([live](https://grge.github.io/hold/lab/terrain.html))
is a playground for the game's next terrain, before any of it is wired in. The aim is ground that is
abstract, alien but plausible at every zoom: ecosystems at many scales, none of which look like
anything familiar.

## The model: a cascade down the scales

Every tile, at every level from 10 down to −4, has a **state**: three fields, s = (p, a, c). The fields
mean nothing yet; they are coordinates in which phases live.

**Phases are biomes.** A tile's phase is the nearest of a few **centroids** in field space (a
Voronoi diagram in 3-d). The diagram **drifts** with level: it turns by a few degrees per level in
the p–a plane, so the same state can be one biome at one scale and another a few levels down. That is
how a region can be "Plain" seen from far out and break into something else closer in.

**Children inherit and deviate.** A level-10 tile gets a random state. Each tile's seven children
start from its state, are **pulled** a little toward its phase's centroid, and are pushed apart by a
pattern that depends on the parent's phase's **rule**:

| Rule | Pattern over the seven children |
|---|---|
| calm | a gentle quadrupole: two opposite children up, two down |
| nucleate | one child (or the centre) gets a big push, the other six share the opposite |
| banded | a dipole across the tile plus a little quadrupole: stripes when orientations agree |
| turbulent | alternate children pushed opposite ways, plus a dipole: froth |

Each pattern sums to zero, so a tile is the mean of its children before the pull. A pattern has an
orientation: global plus random **jitter**, measured in the world's frame or the tile's own (**twist**:
Gosper tiles turn by 19.1° per level, so a local frame spirals). The push's direction in field space is
random per tile, unless the phase **pushes toward** another phase's centroid: that is how one biome
seeds another. Pushes grow near phase boundaries (**edge turbulence**), which roughens coastlines at
every scale, and shrink by **decay** per level.

**The warp hides the tiles.** Before a point looks up its tile, it is moved by smooth noise at every
level, each octave about as large as that level's tiles. Hexagons and Gosper islands dissolve into
wiggles at every scale. Strong warp shears features into streaks, like marbled rock.

Seen per level this is a Markov chain on phases. Calm phases with a pull are fixed points: their
children stay. Turbulent ones scatter into their neighbours. Chains of "pushes toward" make
successions: in the default, Bloom seeds Churn (10% of its children per level), Churn decays to Void
(13%), Void breaks into Strata (13%), and Strata seeds Bloom (9%) and Void; Plain is the quiet
background (91% stay). Pull balances the pushes so that the mix of phases is about the same at every
level (statistically self-similar), while any one place changes as you zoom.

## The page

- **The terrain**, coloured by phase at a level just above the finest drawn (**Coarsen by**), shaded
  by where its state sits inside the phase, and tinted by its phase three levels up (**Parent tint**).
  Thin dark lines are phase boundaries; light lines are boundaries three levels up. It can show any
  one field instead, with contours.
- **Phase portrait**: field space at the view level (p across, a up, a slice at the mean c), with the
  diagram as it stands at that level, about 900 sampled points from the view, and the centroids.
  **Drag a centroid** to move it. Hovering the terrain draws that point's chain as a path through field
  space, level by level.
- **Phases by level**: for each level from 10 to −4, the share of each phase among the sampled points.
- **Under the cursor**: the chain itself, the phase and fields at every level.
- **Controls** for the cascade, for every phase (colour, name, rule, push, where it pushes, centroid),
  presets, randomise, and settings in the URL (copy a link to share a world exactly).

The CPU computes the same cascade as the shader (for the readout, the portrait and the bars), with
the same hashes. A check renders the ground and compares pixels with the CPU: they agree everywhere
except within a fifth of a pixel of a boundary.

## What tuning found

Measured with a script that samples 3,000 points over four seeds and counts parent→child phase
transitions:

- **The first defaults were all fixed points**: 85–100% of children kept their parent's phase, so
  zooming in changed nothing and one phase (whichever the root drew) filled the view. Doubling the
  pushes (gain 1.0) and weakening the pull (0.15) brought self-transitions to 76–90% and the mix to
  roughly 20–30% each, steady down the levels.
- **A central calm phase is absorbing** unless its push is large enough to leave. Phases with
  centroids on the outside of the diagram have unbounded regions and collect anything pushed far.
- **A strongly turbulent phase becomes a transient**: it exists mostly as a fringe between others
  (Film in Foam keeps about half its children).
- **Warp 0.2–0.25** hides the tiles without smearing; 0.35 and up reads as flowing fluid rather than
  ground.

Presets: *Default* (the succession above), *Islands* (a sea that nucleates reefs that crown),
*Strata* (aligned bands, local frame, fast drift: rock fabric), *Foam* (froth around cells and
lacunae), *Scale shift* (weak pushes, strong drift: biomes change mainly with scale).

## Precision

Two things broke on the GPU, and both are fixed:

- **Residues at large coordinates.** The shader computes a tile's digit as v − 7·floor(v/7 + ε). With the
  warp, lattice coordinates reach millions, where the GPU's division can be off by more than ε = 10⁻⁴,
  and about 10% of pixels got wrong ancestors. v/7's fraction is a multiple of 1/7, so ε = 1/14 is safe
  at any size. The game's shader had the same ε; its coordinates are small, but it now uses 1/14 too.
- **The warp's size.** Coarse octaves move points by thousands of world units (10⁵ pixels close in),
  beyond float precision. The warp of the camera's own point is computed in double precision on the
  CPU, and the shader adds only each pixel's offset from it.

Cost: about 1 s for a full 1000×820 frame in headless Chromium's software renderer (about 10× the
game's ground shader; a real GPU is far faster). The page draws at half resolution while the camera
moves.

## Open questions for the game

- **What the fields are.** Three abstract numbers now. In the game they could be what deposits,
  hazards and growth read: say p as richness, a as hostility, c as something ships care about.
- **What a biome does.** Resources, speed, visibility, what lives there. Biomes at the scale of a
  region (level 3) and of a hub (level 6) can mean different things.
- **Setting.** Colours and names are placeholders; the same model could be microscopic or galactic.
