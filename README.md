# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D architectural map for the browser.

Generator version 4 increases density and room-shape variation while keeping the single-floor, no-overlap guarantees introduced in v3.

## Generation model

The world uses three separate layers:

1. **Hidden connectivity graph** — every structural district has a deterministic parent, so the generated world remains one connected component.
2. **Architectural room growth** — each district grows a collision-free complex of adjacent rooms from explicit wall frontiers.
3. **Routed inter-district halls** — connections leave rooms only through generated exterior portals and route around neighboring complexes.

Streaming cells are only deterministic indexing/cache units. They do not define visible room edges, doors, or corridor boundaries.

## Generator v4: density and room variety

Districts now use deterministic architectural profiles instead of one universal room distribution:

- service mazes with many small cells and utility halls
- gallery districts with long narrow rooms and transverse halls
- atrium districts with large open chambers and wings
- office webs with small offices, suites, and dense corridor-like rooms
- warehouse districts with larger column-filled spaces and loading halls
- mixed districts combining several room families

Room growth also retries blocked wall frontiers with progressively smaller and differently offset candidates before giving up. This packs usable space substantially more densely without permitting overlap.

Large rooms can contain partitions, column fields, interior courtyards, or exterior-facing cutouts. Exterior cutouts remove part of the room silhouette, producing deterministic L/U-like spaces instead of only rectangles.

Adjacent rooms sometimes use wide openings rather than narrow doors. This merges several rectangles into visually larger compound spaces and creates more irregular silhouettes closer to the reference map.

## No 2D overpasses

The generator assumes one floor and no elevation.

- Room interiors never overlap.
- A corridor cannot route through a room complex.
- Corridor entry into a complex is allowed only through a selected exterior wall portal.
- Notched room sides are excluded from portal placement.
- Portal necks are checked against every other room in the complex.
- Routed corridors use deterministic obstacle-aware A* navigation around complete room complexes.
- Corridor crossings are same-floor junctions rather than overpasses.
- Wider turn chambers are added only when their footprint remains clear of room complexes.

## Determinism

Every structural choice comes from:

`generator version + world seed + stable world coordinates + feature salt`

There is no exploration-driven global random-number stream.

The same seed therefore produces the same room complexes, doors, routes, junctions, cutouts, and layout regardless of exploration order.

Generator version 4 is part of the hash namespace, so algorithm revisions do not silently change an existing deterministic world contract.

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
