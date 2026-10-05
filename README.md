# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D architectural map for the browser.

Generator version 7 replaces the previous **local complex + connector** model with one continuous architectural accretion system.

## Generator v7: one architectural fabric

Visible generation no longer contains separate concepts for:

- source complexes
- destination complexes
- corridors between complexes
- connector rooms
- connector-specific rendering
- per-site door layers

The renderer receives only:

- floor mass
- exterior boundary walls
- architectural details

That means required global connectivity is buried inside the same geometry as ordinary rooms and branches.

## How the world grows

A sparse hidden macro tree still guarantees that every region ultimately has a finite topological path toward the origin, but that tree is not rendered directly.

Each hidden edge is converted into a dense sequence of overlapping architectural events:

- ordinary rooms
- transverse rooms
- galleries
- large chambers
- side annexes
- multi-step branches
- branch forks
- occasional non-rectangular spaces
- internal partitions
- column fields

The architectural events deliberately overlap before rasterization. Overlap is treated as a **union of floor space**, not as two rooms incorrectly occupying the same floor.

Because only the union boundary is rendered, the original primitives disappear into compound shapes. Internal growth events can merge, cross, and reconnect without producing visual overpasses or stacked geometry.

## Continuous accretion instead of visible connections

Primary growth events are sampled closely enough that consecutive spaces physically overlap.

There is no fallback operation that draws a long narrow line between two distant architectural islands.

A hidden connectivity obligation therefore becomes:

```text
room → chamber → branching rooms → compound mass → merge
```

rather than:

```text
complex ───────── corridor ───────── complex
```

Optional cross-links add local cycles and make independently growing branches merge into the same floor mass.

## Density and macro variation

Version 7 uses smooth deterministic world-space fields to vary:

- architectural density
- openness
- room scale
- branch frequency
- chamber frequency
- turning frequency
- color regions

These fields vary over much larger distances than streaming chunks, so dense and sparse areas transition gradually rather than changing at chunk boundaries.

The current target density is intentionally broad. Sampled seeds typically occupy roughly 43–58% of a large world region, leaving irregular negative space while maintaining one dominant connected architectural mass.

## Compound room shapes

Room primitives are not rendered independently.

They are raster-unioned at 20-world-unit resolution, then the exterior boundary is extracted from the resulting occupancy field.

This produces:

- stepped compound rooms
- irregular wings
- broad merged chambers
- branching room masses
- natural junctions
- merged crossings
- asymmetrical silhouettes

Large primitives can additionally receive partitions and column fields.

## Streaming and determinism

Streaming chunks are 720 world units wide and exist only for caching/querying.

They do not determine:

- where architecture starts
- room ownership
- connectivity
- color regions
- branching
- style changes

Every chunk is regenerated from deterministic world-space growth primitives plus a one-cell occupancy halo, so exploration order does not affect chunk-edge walls or layout.

All decisions come from:

`generator version + seed + stable world coordinates + feature salt`

Generator version 7 is part of the hash namespace.

## Connectivity guarantee

Every hidden macro cell has a parent that strictly decreases Manhattan rank toward the origin.

Primary architectural events along each parent edge overlap physically, so the hidden tree is represented by ordinary connected floor mass rather than a separate corridor network.

Side branches originate from already-connected architectural events. Optional links only add loops.

Therefore every generated architectural family is attached to the same global connected structure.

## Current validation snapshot

The exact smoke suite currently verifies:

- generator version 7
- JavaScript syntax for generator, renderer, and tests
- strict parent-rank decrease toward the origin
- no exposed `rooms`, `corridors`, or `doors` connection layers in rendered chunk data
- exploration-order determinism after generating a remote region
- streaming chunk/raster alignment
- substantial macro density variation
- one dominant continuous occupied mass inside large sampled crops

Current three-seed samples:

- `backrooms-71`: ~57.8% sampled density, ~98.3% of occupied crop cells in the largest connected mass
- `alpha`: ~51.8% sampled density, ~99.97% in the largest connected mass
- `reference`: ~49.9% sampled density, ~99.88% in the largest connected mass

An additional 20-seed stress pass completed without generation failures, with sampled densities roughly 42.9–58.3%.

## Controls

- Drag: pan through the infinite map.
- Mouse wheel / trackpad: zoom around the pointer.
- Seed field: switch deterministic worlds.
- `?seed=...`: share a specific world through the URL.

## Run locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

For generator validation:

```bash
npm test
```

## GitHub Pages

`.github/workflows/pages.yml` runs the smoke suite before deploying `main`.
