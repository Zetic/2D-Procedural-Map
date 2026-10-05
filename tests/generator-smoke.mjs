import {
  FABRIC_CELL,
  FABRIC_CHUNK,
  GENERATOR_VERSION,
  InfiniteMapGenerator,
  MACRO_SIZE,
  isSiteCell,
  parentCell,
  sitePosition,
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
      spaceCount: chunk.spaceCount,
      floors: chunk.floors.map((rect) => [
        Number(rect.x.toFixed(3)),
        Number(rect.y.toFixed(3)),
        Number(rect.w.toFixed(3)),
        Number(rect.h.toFixed(3)),
        rect.color,
      ]),
      exteriorPaths: chunk.exteriorPaths.map((path) =>
        path.map((point) => [
          Number(point.x.toFixed(3)),
          Number(point.y.toFixed(3)),
        ]),
      ),
      interiorWalls: chunk.interiorWalls.map((wall) => [
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

function rootDistanceSq(seed, sx, sy) {
  const root = sitePosition(seed, 0, 0);
  const point = sitePosition(seed, sx, sy);

  const dx = point.x - root.x;
  const dy = point.y - root.y;

  return dx * dx + dy * dy;
}

function verifySiteField(seed) {
  const sites = [];

  for (let sy = -14; sy <= 14; sy++) {
    for (let sx = -14; sx <= 14; sx++) {
      if (!isSiteCell(seed, sx, sy)) continue;

      const point = sitePosition(seed, sx, sy);

      sites.push({
        sx,
        sy,
        x: point.x,
        y: point.y,
      });

      if (sx === 0 && sy === 0) continue;

      const parent = parentCell(seed, sx, sy);

      assert(
        parent,
        `Missing parent for accepted site ${sx},${sy}`,
      );

      assert(
        isSiteCell(seed, parent[0], parent[1]),
        `Parent is not an accepted site for ${sx},${sy}`,
      );

      const before = rootDistanceSq(seed, sx, sy);
      const after = rootDistanceSq(
        seed,
        parent[0],
        parent[1],
      );

      assert(
        after < before,
        `Parent did not reduce root distance for ${sx},${sy}`,
      );
    }
  }

  let minimumDistance = Infinity;

  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      minimumDistance = Math.min(
        minimumDistance,
        Math.hypot(
          sites[i].x - sites[j].x,
          sites[i].y - sites[j].y,
        ),
      );
    }
  }

  assert(
    minimumDistance >= 494,
    `Growth sites violate hard-core spacing: ${minimumDistance.toFixed(2)}`,
  );

  const bucketSize = 1000;
  const buckets = new Map();

  let minBX = Infinity;
  let maxBX = -Infinity;
  let minBY = Infinity;
  let maxBY = -Infinity;

  for (const site of sites) {
    const bx = Math.floor(site.x / bucketSize);
    const by = Math.floor(site.y / bucketSize);
    const key = `${bx},${by}`;

    minBX = Math.min(minBX, bx);
    maxBX = Math.max(maxBX, bx);
    minBY = Math.min(minBY, by);
    maxBY = Math.max(maxBY, by);

    buckets.set(
      key,
      (buckets.get(key) || 0) + 1,
    );
  }

  const counts = [];

  for (let by = minBY; by <= maxBY; by++) {
    for (let bx = minBX; bx <= maxBX; bx++) {
      counts.push(
        buckets.get(`${bx},${by}`) || 0,
      );
    }
  }

  assert(
    new Set(counts).size >= 3,
    'Expected irregular growth-site density across world buckets',
  );

  assert(
    counts.some((count) => count === 0),
    'Expected some world buckets to contain no growth source',
  );

  assert(
    counts.some((count) => count >= 2),
    'Expected some world buckets to contain multiple growth sources',
  );

  return {
    sites: sites.length,
    minimumDistance,
  };
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
  const {
    occupied,
    width,
    height,
  } = rasterizeCore(chunks, bounds);

  const seen = new Uint8Array(occupied.length);
  const queue = new Int32Array(occupied.length);

  let occupiedCount = 0;

  for (const value of occupied) {
    occupiedCount += value;
  }

  let components = 0;
  let largest = 0;

  for (let index = 0; index < occupied.length; index++) {
    if (!occupied[index] || seen[index]) continue;

    components += 1;

    let head = 0;
    let tail = 0;
    let count = 0;

    queue[tail++] = index;
    seen[index] = 1;

    while (head < tail) {
      const current = queue[head++];
      count += 1;

      const x = current % width;
      const y = Math.floor(current / width);

      if (x > 0) {
        const next = current - 1;
        if (occupied[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }

      if (x < width - 1) {
        const next = current + 1;
        if (occupied[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }

      if (y > 0) {
        const next = current - width;
        if (occupied[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }

      if (y < height - 1) {
        const next = current + width;
        if (occupied[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    largest = Math.max(largest, count);
  }

  return {
    occupiedCount,
    components,
    largestFraction:
      occupiedCount > 0
        ? largest / occupiedCount
        : 0,
  };
}

function contourStats(chunks) {
  let segments = 0;
  let diagonalSegments = 0;

  for (const chunk of chunks) {
    for (const path of chunk.exteriorPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        const dx = path[i + 1].x - path[i].x;
        const dy = path[i + 1].y - path[i].y;

        segments += 1;

        if (
          Math.abs(dx) > 1e-6 &&
          Math.abs(dy) > 1e-6
        ) {
          diagonalSegments += 1;
        }
      }
    }
  }

  return {
    segments,
    diagonalFraction:
      segments > 0
        ? diagonalSegments / segments
        : 0,
  };
}

function verifyFabric(seed) {
  const generator = new InfiniteMapGenerator(seed);

  const bounds = {
    minX: -1350,
    maxX: 1350,
    minY: -900,
    maxY: 900,
  };

  const chunks = generator.query(bounds);

  assert(chunks.length > 0, 'Expected generated chunks');

  for (const chunk of chunks) {
    assert(
      !('corridors' in chunk),
      'v9 must not expose corridor/connector geometry',
    );
    assert(
      !('rooms' in chunk),
      'v9 must not expose source-owned room complexes',
    );
    assert(
      !('doors' in chunk),
      'v9 must not expose a separate connector door layer',
    );
    assert(
      Array.isArray(chunk.exteriorPaths),
      'Expected simplified exterior contour paths',
    );
    assert(
      Array.isArray(chunk.interiorWalls),
      'Expected architectural interior walls',
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

  const densityVariance =
    densities.reduce(
      (sum, value) =>
        sum +
        (value - averageDensity) *
          (value - averageDensity),
      0,
    ) / densities.length;

  const densityDeviation =
    Math.sqrt(densityVariance);

  assert(
    averageDensity >= 0.35 &&
      averageDensity <= 0.78,
    `Unexpected architectural density ${averageDensity.toFixed(3)}`,
  );

  assert(
    densityDeviation >= 0.07,
    `Expected multi-scale density variation, got ${densityDeviation.toFixed(3)}`,
  );

  const connected =
    connectedMassStats(chunks, bounds);

  assert(
    connected.largestFraction >= 0.96,
    `Expected one dominant continuous architectural fabric, got ${(connected.largestFraction * 100).toFixed(1)}%`,
  );

  const contour = contourStats(chunks);

  assert(
    contour.diagonalFraction >= 0.07,
    `Expected non-grid exterior contours, got only ${(contour.diagonalFraction * 100).toFixed(1)}% diagonal segments`,
  );

  const spaces = chunks.reduce(
    (sum, chunk) => sum + chunk.spaceCount,
    0,
  );

  const interiorWalls = chunks.reduce(
    (sum, chunk) => sum + chunk.interiorWalls.length,
    0,
  );

  assert(
    spaces >= 350,
    `Expected many readable architectural spaces, got ${spaces}`,
  );

  assert(
    interiorWalls >= 1800,
    `Expected substantial internal room topology, got ${interiorWalls} wall segments`,
  );

  const colors = new Set();

  for (const chunk of chunks) {
    for (const floor of chunk.floors) {
      colors.add(floor.color);
    }
  }

  assert(
    colors.size >= 2,
    'Expected multiple stable architectural floor tones',
  );

  // Batch shape must not affect geometry.
  const home = {
    minX: -800,
    maxX: 800,
    minY: -600,
    maxY: 600,
  };

  const standalone = snapshot(
    new InfiniteMapGenerator(seed).query(home),
  );

  const batchedGenerator = new InfiniteMapGenerator(seed);

  batchedGenerator.query({
    minX: -5000,
    maxX: 5000,
    minY: -3500,
    maxY: 3500,
  });

  const batched = snapshot(
    batchedGenerator.query(home),
  );

  assert(
    standalone === batched,
    `Batch-size determinism failed for ${seed}`,
  );

  const remoteGenerator = new InfiniteMapGenerator(seed);

  remoteGenerator.query({
    minX: 12000,
    maxX: 14500,
    minY: -11000,
    maxY: -8500,
  });

  const remoteThenHome = snapshot(
    remoteGenerator.query(home),
  );

  assert(
    standalone === remoteThenHome,
    `Exploration-order determinism failed for ${seed}`,
  );

  return {
    chunks: chunks.length,
    averageDensity,
    densityDeviation,
    largestFraction: connected.largestFraction,
    components: connected.components,
    spaces,
    interiorWalls,
    diagonalContourFraction: contour.diagonalFraction,
    colors: colors.size,
  };
}

assert(
  GENERATOR_VERSION === 9,
  'Expected generator version 9',
);

assert(
  FABRIC_CHUNK % FABRIC_CELL === 0,
  'Fabric chunk must align to occupancy cell size',
);

assert(
  MACRO_SIZE !== FABRIC_CHUNK,
  'Growth-site indexing and streaming chunks must remain independent',
);

const seeds = [
  'backrooms-71',
  'alpha',
  'reference',
];

const results = [];

for (const seed of seeds) {
  const siteField = verifySiteField(seed);
  const fabric = verifyFabric(seed);

  results.push({
    seed,
    ...siteField,
    ...fabric,
  });
}

console.log(
  JSON.stringify({
    generatorVersion: GENERATOR_VERSION,
    seeds: results.length,
    results: results.map((result) => ({
      seed: result.seed,
      growthSites: result.sites,
      minimumSiteDistance: Number(
        result.minimumDistance.toFixed(2),
      ),
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
      spaces: result.spaces,
      interiorWallSegments: result.interiorWalls,
      diagonalContourFraction: Number(
        result.diagonalContourFraction.toFixed(3),
      ),
      colors: result.colors,
    })),
    status: 'ok',
  }),
);
