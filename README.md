# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D architectural map for the browser.

Generator version 3 is a structural rewrite aimed at the dense, irregular, connected floor-plan style in the reference map.

## Generation model

The world uses three separate layers:

1. **Hidden connectivity graph** — every structural district has a deterministic parent, so the generated world remains one connected component.
2. **Architectural room growth** — each district grows a collision-free complex of adjacent rooms from explicit wall frontiers.
3. **Routed inter-district halls** — connections leave rooms only through generated exterior portals and route around neighboring complexes.

Streaming cells are only a deterministic indexing mechanism. They do not define visible room edges, doors, or corridor boundaries.

## Architectural growth

Each district starts from a large anchor room, then expands through deterministic wall frontiers.

Generated room types include:

- broad chambers
- narrow halls
- long rooms
- short connector rooms
- small chambers
- large partitioned rooms
- rooms containing deterministic column layouts

A new room is accepted only when its oriented footprint is free. It is placed directly against an existing room wall and an explicit doorway is recorded at that shared boundary.

This creates compound, irregular floor-plan silhouettes instead of independent rectangles scattered around a hub.

## No 2D overpasses

The generator assumes one floor and no elevation.

- Room interiors never overlap.
- A corridor cannot route through a room complex.
- Corridor entry into a complex is allowed only through a selected exterior wall portal.
- The short portal-to-route neck is checked against every other room in that complex.
- Routed corridors use deterministic obstacle-aware A* navigation around complete room complexes.
- Corridor crossings are same-floor junctions rather than overpasses.
- Wider turn chambers are added only when their footprint remains clear of room complexes.

## Determinism

Every structural choice comes from:

`generator version + world seed + stable world coordinates + feature salt`

There is no exploration-driven global random-number stream.

The same seed therefore produces the same room complexes, doors, routes, junctions, and layout regardless of which direction is explored first.

Generator version 3 is part of the hash namespace, so older algorithm versions do not silently produce different geometry under the same deterministic contract.

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

`.github/workflows/pages.yml` validates the generator and deploys the repository root whenever `main` changes.

In repository **Settings → Pages**, set the source to **GitHub Actions** if it is not already selected.
