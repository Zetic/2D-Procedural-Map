# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D architectural map for the browser.

Generator version 6 removes the last architectural dependency on a regular structural grid.

## Generator v6: irregular growth field

Earlier versions still had one main architectural source per regular structural cell. Even with jittered anchors, diagonal parents, and room-filled connectors, zooming far out could reveal the original lattice.

Version 6 replaces that model with a deterministic blue-noise growth field:

- a small internal hash lattice creates only **candidate** world-space points
- candidates compete with nearby candidates by stable hash priority
- candidates closer than the minimum separation suppress one another
- the surviving sites form an irregular deterministic point field
- there is no one-site-per-cell rule
- query/cache buckets are completely separate from architectural ownership
- architecture can extend across any query boundary

The internal candidate lattice is therefore only an enumeration mechanism. Its cells do not own rooms, districts, doors, connections, colors, or visible boundaries.

## Connectivity without visible roads

Every accepted growth site has a deterministic lower-rank parent toward the root site.

The parent relationship is a connectivity obligation, not a request to draw a straight road. Required connections are converted into architectural fabric:

- short growth-spine segments
- waystations
- connector rooms
- hall rooms
- passage rooms
- side annexes
- second-generation branch rooms
- wide openings and junctions

A blocked preferred parent can use another deterministic lower-rank nearby site. Parent rank always decreases, so every accepted site still has a finite chain toward the root.

Optional local links add loops without changing that guarantee.

## No regular placement rhythm

Accepted sites are separated by a deterministic hard-core distance and can occur at arbitrary positions inside their candidate buckets.

The smoke suite verifies:

- accepted sites maintain the required minimum separation
- query-sized world buckets contain varying numbers of architectural sites
- parent chains monotonically approach the root
- exploration order does not alter generated geometry

This specifically prevents the previous pattern of one dense island appearing at every fixed interval.

## Continuous architectural fabric

Local growth retains the varied room families from v4/v5:

- service mazes
- galleries
- atriums
- office webs
- warehouse areas
- mixed architectural regions

Rooms may contain partitions, columns, notches, courtyards, wide openings, offices, halls, utility rooms, galleries, and larger chambers.

Between local growth sources, v5-style connection fabric remains, but the sources are now irregularly distributed rather than grid-owned. The connection layer also uses room-scale occupancy and short uninterrupted segments, so it behaves as expanding architecture rather than a long road between regularly spaced blobs.

## Single-floor collision rules

The generator assumes one floor and no elevation.

- local room interiors cannot overlap
- growth spines cannot cross local room interiors
- connection-fabric rooms cannot overlap local room interiors
- entry into a local growth region occurs through explicit exterior portals
- route occupancy includes multiple neighboring candidate rings because accepted sites are heavily jittered
- independent growth fabrics that meet are treated as same-floor junctions rather than overpasses

## Determinism

Every decision comes from:

`generator version + world seed + stable world coordinates + feature salt`

There is no exploration-driven global random stream.

The same seed therefore regenerates the same accepted growth sites, rooms, routes, branches, openings, and junctions regardless of exploration direction.

Generator version 6 is part of the hash namespace.

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

`.github/workflows/pages.yml` runs the generator smoke suite before deploying `main`.
