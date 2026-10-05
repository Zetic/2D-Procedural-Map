# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D architectural map for the browser.

Generator version 5 removes the previous **blob → long corridor → blob** structure. Hidden connectivity is now expressed as continuous architectural growth: short halls repeatedly expand into rooms, waystations, annexes, branches, and junctions.

## Generation model

The world still has a deterministic connectivity skeleton, but that skeleton is no longer rendered as a visible road network.

1. **Hidden connectivity constraints** — every structural source has deterministic lower-rank connection options toward the origin.
2. **Dense local room growth** — collision-free room complexes grow from wall frontiers.
3. **Continuous connection fabric** — required macro connections are resampled into short segments and populated with rooms/branches along the route.
4. **Local merging and junctions** — crossing connection fabrics render as same-floor unions rather than overpasses.

Streaming cells remain deterministic indexing/cache units only. They do not define visible walls or chunk boundaries.

## Continuous architectural growth

Version 5 specifically targets the visible grid/spoke problem from earlier versions.

- Structural spacing is reduced while local complex radius is increased.
- Hidden parent choices frequently use diagonals instead of Manhattan-only movement.
- Parent connections can deterministically select nearby lower-rank alternatives when dense geometry blocks the preferred connection.
- Macro connections use actual room-scale obstacles instead of one large circular exclusion zone around an entire district.
- Routes can therefore thread through existing architectural gaps rather than wrapping around isolated blobs.
- Connector geometry is resampled so uninterrupted rendered segments stay short.
- Every route repeatedly attempts to create a waystation, connector room, or hall-room.
- Rejected large connector rooms retry as smaller deterministic passage rooms rather than leaving long bare hallway stretches.
- Waystations can grow side annexes and second-generation branch rooms.
- Connection-fabric rooms have partitions/columns just like local complexes.
- Same-floor route/fabric intersections visually merge into junctions.

The smoke suite currently requires connector segments to remain under 115 world units; sampled v5 layouts remain under ~84 units.

## Local architectural variety

The v4 room families remain:

- service mazes
- gallery districts
- atriums
- office webs
- warehouse districts
- mixed districts

Local rooms can include narrow cells, service halls, long galleries, offices, suites, atriums, warehouses, loading halls, partitions, column fields, courtyards, side notches, corner notches, and wide compound openings.

## Single-floor collision rules

The generator assumes one floor and no elevation.

- Local room interiors cannot overlap.
- Main connection centerlines cannot pass through local room interiors.
- Connection-fabric rooms cannot overlap local room interiors.
- Entry into a local complex happens only through explicit exterior portals.
- Portal runways are checked against nearby occupied geometry.
- Crossings between independent connection fabrics are treated as same-floor merged junctions, not one structure passing over another.

## Determinism

Every structural choice comes from:

`generator version + world seed + stable world coordinates + feature salt`

There is no exploration-driven global random stream.

The same seed therefore regenerates the same rooms, routes, branches, openings, and connection fabric regardless of exploration order.

Generator version 5 is part of the hash namespace.

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

`.github/workflows/pages.yml` validates the generator before deploying `main`.
