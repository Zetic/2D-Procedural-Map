import {
  FABRIC_CELL,
  FABRIC_CHUNK,
  GENERATOR_VERSION,
  InfiniteMapGenerator,
  MACRO_SIZE,
  parentCell,
} from '../src/generator.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function snapshot(chunks) {
  return JSON.stringify(
    chunks.map((chunk) => ({
      cx: chunk.cx,
      cy: chunk.cy,
      occupiedCount: chunk.occupiedCount,
      floors: chunk.floors.map((rect) => [
        Number(rect.x.toFixed(3)),
        Number(rect.y.toFixed(3)),
        Number(rect.w.toFixed(3)),
        Number(rect.h.toFixed(3)),
        rect.color,
      ]),
      walls: chunk.walls.map((wall) => [
        Number(wall.x1.toFixed(3)),
        Number(wall.y1.toFixed(3)),
        Number(wall.x2.toFixed(3)),
        Number(wall.y2.toFixed(3)),
      ]),
      details: chunk.details.map((detail) => {
        if (detail.type === 'column') {
          return [
            'column',
            Number(detail.x.toFixed(3)),
            Number(detail.y.toFixed(3)),
            Number(detail.r.toFixed(3)),
          ];
        }

        return [
          'partition',
          Number(detail.a1.x.toFixed(3)),
          Number(detail.a1.y.toFixed(3)),
          Number(detail.a2.x.toFixed(3)),
          Number(detail.a2.y.toFixed(3)),
          Number(detail.b1.x.toFixed(3)),
          Number(detail.b1.y.toFixed(3)),
          Number(detail.b2.x.toFixed(3)),
          Number(detail.b2.y.toFixed(3)),
        ];
      }),
    })),
  );
}

function verifyParentTree(seed) {
  for (let my = -18; my <= 18; my += 2) {
    for (let mx = -18; mx <= 18; mx += 2) {
      let x = mx;
      let y = my;
      let guard = 0;

      while (x !== 0 || y !== 0) {
        const before = Math.abs(x) + Math.abs(y);
        const parent = parentCell(seed, x, y);

        assert(parent, `Missing parent for ${seed} at ${x},${y}`);

        const after =
          Math.abs(parent[0]) +
          Math.abs(parent[1]);

        assert(
          after < before,
          `Parent did not reduce rank for ${seed} at ${x},${y}`,
        );

        [x, y] = parent;

        guard += 1;
        assert(
          guard < 500,
          `Parent chain guard exceeded for ${seed}`,
        );
      }
    }
  }
}

function rasterizeCore(chunks, bounds) {
  const minGX = Math.floor(bounds.minX / FABRIC_CELL);
  const maxGX = Math.ceil(bounds.maxX / FABRIC_CELL) - 1;
  const minGY = Math.floor(bounds.minY / FABRIC_CELL);
  const maxGY = Math.ceil(bounds.maxY / FABRIC_CELL) - 1;
  const width = maxGX - minGX + 1;
  const height = maxGY - minGY + 1;
  const occupied = new Uint8Array(width * height);

  for (const chunk of chunks) {
    for (const rect of chunk.floors) {
      const startX = Math.max(
        minGX,
        Math.floor(rect.x / FABRIC_CELL),
      );
      const endX = Math.min(
        maxGX,
        Math.ceil((rect.x + rect.w) / FABRIC_CELL) - 1,
      );
      const startY = Math.max(
        minGY,
        Math.floor(rect.y / FABRIC_CELL),
      );
      const endY = Math.min(
        maxGY,
        Math.ceil((rect.y + rect.h) / FABRIC_CELL) - 1,
      );

      for (let gy = startY; gy <= endY; gy++) {
        for (let gx = startX; gx <= endX; gx++) {
          occupied[
            (gy - minGY) * width +
            (gx - minGX)
          ] = 1;
        }
      }
    }
  }

  return {
    occupied,
    width,
    height,
  };
}

function connectedMassStats(chunks, bounds) {
  const { occupied, width, height } =
    rasterizeCore(chunks, bounds);

  const seen = new Uint8Array(occupied.length);
  const queueX = new Int32Array(occupied.length);
  const queueY = new Int32Array(occupied.length);

  let occupiedCount = 0;
  for (const value of occupied) occupiedCount += value;

  let components = 0;
  let largest = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!occupied[index] || seen[index]) continue;

      components += 1;

      let head = 0;
      let tail = 0;
      let count = 0;

      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;
      seen[index] = 1;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head += 1;
        count += 1;

        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (
            nx < 0 ||
            ny < 0 ||
            nx >= width ||
            ny >= height
          ) {
            continue;
          }

          const nIndex = ny * width + nx;

          if (
            occupied[nIndex] &&
            !seen[nIndex]
          ) {
            seen[nIndex] = 1;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail += 1;
          }
        }
      }

      largest = Math.max(largest, count);
    }
  }

  return {
    occupiedCount,
    components,
    largestFraction:
      occupiedCount > 0 ? largest / occupiedCount : 0,
  };
}

function verifyFabric(seed) {
  const generator = new InfiniteMapGenerator(seed);

  const bounds = {
    minX: -1440,
    maxX: 1440,
    minY: -1080,
    maxY: 1080,
  };

  const chunks = generator.query(bounds);

  assert(chunks.length > 0, 'Expected generated chunks');

  for (const chunk of chunks) {
    assert(
      !('corridors' in chunk),
      'v7 must not expose connector geometry',
    );
    assert(
      !('rooms' in chunk),
      'v7 must not expose source-owned room complexes',
    );
    assert(
      !('doors' in chunk),
      'v7 must not expose a separate connection-door layer',
    );
  }

  const densities = chunks.map(
    (chunk) =>
      chunk.occupiedCount /
      Math.max(1, chunk.cellCount),
  );

  const averageDensity =
    densities.reduce((a, b) => a + b, 0) /
    densities.length;

  const variance =
    densities.reduce(
      (sum, value) =>
        sum +
        (value - averageDensity) *
          (value - averageDensity),
      0,
    ) / densities.length;

  const densityDeviation = Math.sqrt(variance);

  assert(
    averageDensity >= 0.28 &&
      averageDensity <= 0.72,
    `Unexpected architectural density ${averageDensity.toFixed(3)}`,
  );

  assert(
    densityDeviation >= 0.08,
    `Expected macro density variation, got deviation ${densityDeviation.toFixed(3)}`,
  );

  const connected = connectedMassStats(
    chunks,
    bounds,
  );

  assert(
    connected.largestFraction >= 0.90,
    `Expected one dominant continuous architectural mass, got ${(connected.largestFraction * 100).toFixed(1)}%`,
  );

  const before = snapshot(
    generator.query({
      minX: -900,
      maxX: 900,
      minY: -720,
      maxY: 720,
    }),
  );

  generator.query({
    minX: 16000,
    maxX: 18000,
    minY: -12000,
    maxY: -10000,
  });

  const after = snapshot(
    generator.query({
      minX: -900,
      maxX: 900,
      minY: -720,
      maxY: 720,
    }),
  );

  assert(
    before === after,
    `Exploration-order determinism failed for ${seed}`,
  );

  return {
    chunks: chunks.length,
    averageDensity,
    densityDeviation,
    largestFraction: connected.largestFraction,
    components: connected.components,
    floors: chunks.reduce(
      (sum, chunk) => sum + chunk.floors.length,
      0,
    ),
    walls: chunks.reduce(
      (sum, chunk) => sum + chunk.walls.length,
      0,
    ),
    details: chunks.reduce(
      (sum, chunk) => sum + chunk.details.length,
      0,
    ),
  };
}

assert(
  GENERATOR_VERSION === 7,
  'Expected generator version 7',
);

assert(
  FABRIC_CHUNK % FABRIC_CELL === 0,
  'Fabric chunk must align to raster cell size',
);

assert(
  MACRO_SIZE > FABRIC_CHUNK,
  'Macro topology must remain independent from streaming chunks',
);

const seeds = [
  'backrooms-71',
  'alpha',
  'reference',
];

const results = [];

for (const seed of seeds) {
  verifyParentTree(seed);
  results.push({
    seed,
    ...verifyFabric(seed),
  });
}

console.log(
  JSON.stringify({
    generatorVersion: GENERATOR_VERSION,
    seeds: results.length,
    results: results.map((result) => ({
      seed: result.seed,
      chunks: result.chunks,
      averageDensity: Number(
        result.averageDensity.toFixed(3),
      ),
      densityDeviation: Number(
        result.densityDeviation.toFixed(3),
      ),
      largestContinuousMass: Number(
        result.largestFraction.toFixed(4),
      ),
      componentsInCrop: result.components,
      floors: result.floors,
      walls: result.walls,
      details: result.details,
    })),
    status: 'ok',
  }),
);
