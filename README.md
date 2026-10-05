# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite architectural map for the browser.

Generator version 9 uses **frontier accretion** rather than the earlier node/connector or hidden-route systems.

## Final generation model

Visible architecture is generated from persistent room-growth fronts.

There is no rendered concept of:

- a district or complex owned by a streaming cell
- a source complex connected to a destination complex
- a corridor or road generated between two areas
- a hidden polyline that rooms are distributed along
- a connector-specific room or door layer

The generator still maintains a hidden connectivity obligation so the infinite world cannot fragment, but that obligation only biases ordinary architectural growth toward another already-defined growth family.

A front repeatedly performs local architectural events until the required growth families physically merge.

## Frontier growth

Each accepted irregular world-space growth site starts ordinary architecture.

Its main frontier maintains:

- world position
- heading
- previous room scale
- architectural family
- current compound-space identity
- distance to the unresolved merge target
- local density / openness / scale / branch / chamber / turning fields

Every step chooses an architectural event such as:

- ordinary room
- small cell
- suite
- long gallery
- transverse room
- large chamber
- compound wing
- annex cluster
- side branch
- branch fork
- merge chamber

The frontier is gently attracted toward its unresolved connectivity target, but local architecture, turning, scale, branching, and world-space fields remain part of every decision. There is no precomputed route.

As the front approaches its target, attraction strengthens only enough to guarantee a physical merge.

Consecutive growth events are limited by inscribed-room overlap, so every generated branch is physically connected floor space.

## No long hallway mechanism

A narrow passage is not used as the global connectivity primitive.

The generator forces a chamber event after several non-major events, and primary frontier steps always overlap ordinary room geometry.

Global connectivity therefore appears as a sequence of rooms, compound spaces, branches, widenings, turns, and mergers rather than:

```text
complex -------- corridor -------- complex
```

## Irregular growth-site field

The sparse connectivity obligations begin from a deterministic hard-core point field.

A small internal hash lattice only enumerates candidate sites. Nearby candidates suppress one another by stable priority.

Current site constraints include:

- heavy within-cell jitter
- approximately 495-world-unit hard-core separation
- varying numbers of accepted sites per 1000×1000 world region
- empty world buckets as well as multi-site buckets

The indexing lattice therefore does not own visible architecture.

Streaming chunks use a completely different size and serve only as cache/query regions.

## Branching, merging, loops, and infill

Frontier growth is not limited to the required parent merge.

### Side growth

Main fronts continuously create:

- side branches
- recursive one-level forks
- compound wings
- annexes
- chambers with attached spaces

### Local front merging

Nearby primitives from different growth families are detected spatially.

When compatible fronts approach one another, a deterministic broad merge/junction chamber is generated. The chamber physically overlaps both sides, so a merge can never create detached decoration.

### Loops

Nearby accepted growth sites occasionally receive an additional frontier obligation. Those loop fronts use the same room-by-room accretion algorithm, not a separate connector renderer.

### Deterministic infill

A secondary world-space candidate field checks irregular empty pockets surrounded by existing architecture.

When a pocket has architecture on several sides, an infill room can grow outward from the nearest existing space. Infill rooms are forced to overlap their parent geometry.

This fills enclosed and near-enclosed gaps while preserving larger voids.

## Room shapes

Rooms are not limited to individual rectangles.

Ordinary growth can create:

- L-like compound rooms
- multi-wing chambers
- wide merged spaces
- suites
- long galleries
- transverse spaces
- small cells
- annex groups
- rare elliptical rooms
- large merge/junction chambers

Several primitives can share one stable space identity, so they render as one compound room.

## Final floor-plan reconstruction

Growth geometry is unioned into one floor mass at a 15-world-unit internal occupancy resolution.

The raster is not rendered directly.

The final renderer receives:

- merged floor rectangles
- simplified exterior contour paths
- meaningful interior room boundaries
- deterministic door/opening gaps
- structured partitions
- column fields

Shared boundaries between distinct spaces are stitched into architectural wall paths. Deterministic gaps create ordinary doors and occasional broad openings.

Short shared boundaries may disappear completely, allowing adjacent primitives to read as one compound room.

Exterior contours are simplified so rotated architecture produces diagonal/vector-like boundaries instead of raw staircase raster edges.

## Color

Color does not follow connectivity edges.

Most architecture stays within the reference's cream/tan family. Rare muted pink, blue, green, and brown sections come from compact smooth world-space fields and stable space identities.

A connectivity obligation therefore cannot reveal itself as a long colored strip.

## Infinite determinism

All generation decisions are functions of:

`generator version + world seed + stable world coordinates + feature salt`

There is no exploration-order random stream.

The same seed produces the same:

- growth-site field
- parent obligations
- frontier turns
- room events
- branches
- merges
- infill
- room ownership
- openings
- colors
- details

regardless of exploration direction or query batch size.

## Connectivity guarantee

Every accepted growth site except the root receives a deterministic accepted parent whose squared world-space distance to the root is lower.

The parent relation therefore terminates at the root.

For every required relation:

1. the child starts with connected room geometry,
2. each new frontier room physically overlaps the previous room,
3. the frontier continuously steers toward the parent,
4. forced final growth closes any remaining short distance,
5. the final merge geometry contains the target point,
6. the parent has ordinary architecture at that target.

Branches, annexes, merge chambers, and infill rooms are also generated from physically overlapping parent geometry.

The resulting infinite architectural fabric is therefore connected by construction rather than by a separate road layer.

## Validation

The v9 smoke suite checks:

- generator/app/test JavaScript syntax
- generator version 9
- irregular hard-core site spacing
- variable site counts across world-space buckets
- every sampled parent is itself an accepted growth site
- every sampled parent strictly decreases world-space root distance
- no exposed `rooms`, `corridors`, or `doors` connector layers
- substantial multi-scale density variation
- one dominant connected architectural mass in large crops
- hundreds of readable spaces
- thousands of interior architectural wall segments
- diagonal simplified exterior contours
- multiple stable floor tones
- identical geometry when a region is generated alone or inside a much larger batch
- identical geometry after unrelated remote exploration

Representative smoke samples:

- `backrooms-71`: 55.5% average sampled density, 99.36% of occupied crop in the largest connected mass
- `alpha`: 61.0% density, 99.79% in the largest connected mass
- `reference`: 65.8% density, 99.49% in the largest connected mass

Across those crops the suite observes roughly 1,100–1,400 readable spaces and 7,000–8,600 interior wall segments.

An additional 20-seed stress run completed without generation failures.

## Controls

- Drag: pan through the infinite map.
- Mouse wheel / trackpad: zoom around the pointer.
- Seed field: switch deterministic worlds.
- `?seed=...`: share a deterministic world through the URL.

## Run locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Run validation with:

```bash
npm test
```

## GitHub Pages

`.github/workflows/pages.yml` runs the generator smoke suite before deploying `main`.
