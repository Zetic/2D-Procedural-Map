# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D architectural map for the browser.

Generator version 8 keeps the continuous accretion introduced in v7, but reconstructs that floor mass into readable architecture instead of rendering it like a cave-shaped occupancy mask.

## Generator v8: continuous mass with actual rooms

The visible world still has no separate concepts for:

- source complexes
- destination complexes
- connector corridors
- connector-specific rooms
- connector-specific doors

Global connectivity remains hidden inside one continuous architectural fabric.

The major v8 change is that overlapping growth primitives now carry stable **space identities**. The floor is still unioned into one connected mass, but adjacent spaces retain meaningful internal boundaries.

That produces:

- compound rooms formed from several overlapping primitives
- retained walls between genuinely different rooms
- deterministic door/opening gaps in shared walls
- large chambers with broad openings
- smaller rooms with narrower doors
- annexes and branch rooms that read as architecture rather than path decoration

## No more visible raster striping

The occupancy raster is now an internal generation representation only.

Rendering changes include:

- smaller 15-world-unit occupancy cells
- simplified exterior contour paths instead of raw staircase edges
- diagonal contour simplification for rotated architecture
- screen-space floor bleed to eliminate subpixel seams between raster rows
- sparse structured partitions and columns generated from final owned spaces rather than every hidden growth primitive

The horizontal scanline pattern from v7 is therefore no longer part of the intended rendered output.

## Exterior silhouette vs interior topology

V7 rendered almost exclusively the union's exterior boundary. That removed visible connectors, but also erased most room semantics.

V8 separates two things:

1. **Exterior floor union** — overlapping growth events form irregular compound architecture.
2. **Interior space ownership** — deterministic ownership partitions that mass back into readable rooms.

When two spaces meet, their shared boundary receives one or more deterministic openings. Very short boundaries may be removed entirely, making the spaces one visually compound room.

This preserves the desired sprawling silhouette while restoring a map-like internal floor plan.

## Continuous accretion

A sparse hidden parent tree still provides the formal global connectivity guarantee, but it is never rendered as a road layer.

Each hidden obligation is expanded into ordinary overlapping architectural events:

- rooms
- transverse rooms
- galleries
- large chambers
- annexes
- side branches
- branch forks
- occasional elliptical features

Primary events overlap physically, so connectivity is represented by normal occupied floor area.

Optional links add loops and cause independently generated growth to merge.

## Architectural variation

Smooth deterministic world-space fields vary:

- density
- openness
- room scale
- branch frequency
- chamber frequency
- turn frequency

Growth families also receive stable floor palettes. Most remain within the cream/tan family used by the reference, while occasional muted pink, blue, green, or brown regions persist as architectural sections rather than horizontal world-space color bands.

## Streaming

Streaming chunks are 720 world units wide. The raster cell size is 15 world units.

Chunks are query/cache units only. They do not control:

- room placement
- space ownership
- connectivity
- style
- color families
- growth direction

Each chunk is regenerated from deterministic world-space growth with a raster halo. Exploration direction therefore cannot alter boundaries, rooms, openings, or details.

## Connectivity

Every hidden macro coordinate has a deterministic parent that strictly decreases Manhattan rank toward the root.

Consecutive primary growth events physically overlap. Branches originate from already-connected architecture. Shared space boundaries contain deterministic door/opening gaps.

There is no separate corridor fallback.

## Validation

The v8 smoke suite currently verifies:

- generator version 8
- generator/app/test JavaScript syntax
- strict hidden parent-rank decrease
- no exposed `rooms`, `corridors`, or `doors` connector layers
- exact exploration-order determinism
- one dominant connected occupied mass
- substantial macro density variation
- hundreds of readable owned spaces in sampled crops
- substantial internal room-wall geometry
- simplified diagonal exterior contour segments
- multiple stable architectural floor tones

Current three-seed samples:

- `backrooms-71`: 48.9% average sampled density, 99.83% of occupied crop in the largest connected mass, 884 sampled spaces
- `alpha`: 69.4% density, 99.63% in the largest connected mass, 904 sampled spaces
- `reference`: 58.9% density, 99.99% in the largest connected mass, 883 sampled spaces

Representative normal viewports generate in roughly 0.35–0.45 seconds in connector-side validation. A very wide low-zoom viewport is roughly 1.8 seconds before browser rendering and benefits from chunk caching while panning.

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
