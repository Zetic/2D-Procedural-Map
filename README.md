# Infinite 2D Procedural Map

A deterministic, exploration-order-independent infinite 2D procedural architecture map for the browser.

The visual structure is generated as **organic growth constrained by a hidden connectivity skeleton**:

- Every structural cell has a deterministic parent that moves one step closer to the origin, so every generated district has a finite path into one globally connected component.
- Structural anchors are heavily jittered and connection paths meander in world space, preventing the streaming/query grid from becoming visible in the architecture.
- Rooms and secondary branches grow from already-connected corridors and hubs, so decorative growth cannot create disconnected islands.
- Optional deterministic cross-links add loops and denser regions without changing the connectivity guarantee.
- Every decision is derived from `seed + stable world coordinates + feature salt`; generation never depends on exploration order or a global RNG stream.
- Query cells are only an indexing/cache mechanism. They do not define doors, rooms, or visible boundaries.

## Run locally

This project is static. Serve the repository root with any local HTTP server, for example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Controls

- Drag: pan through the infinite map.
- Mouse wheel / trackpad: zoom around the pointer.
- Seed field: switch to a different deterministic world.
- `?seed=...`: share a specific world through the URL.

## GitHub Pages

`.github/workflows/pages.yml` deploys the repository root whenever `main` changes. In repository **Settings → Pages**, set the source to **GitHub Actions** if it is not already selected.

## Determinism

The generator uses 32-bit integer hashing (`Math.imul`, shifts, and stable string hashing) for structural decisions. Each structural cell can be regenerated independently, so visiting east then north produces the same geometry as visiting north then east.

The generator version is currently implicit in the source code. Before introducing breaking generation changes for persistent worlds, add an explicit generator-version value to the seed/hash namespace.
