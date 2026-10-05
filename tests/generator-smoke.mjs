import {
  GENERATOR_VERSION,
  InfiniteMapGenerator,
  SITE_GRID,
  SITE_MIN_DISTANCE,
  isSiteCell,
  parentCell,
  roomsOverlap,
  sitePosition,
} from '../src/generator.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function polygonArea(vertices) {
  let sum = 0;

  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];

    sum += a.x * b.y - b.x * a.y;
  }

  return Math.abs(sum) * 0.5;
}

function pointInPolygon(point, vertices) {
  let inside = false;

  for (
    let i = 0, j = vertices.length - 1;
    i < vertices.length;
    j = i++
  ) {
    const a = vertices[i];
    const b = vertices[j];

    const intersects =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x <
        (
          (b.x - a.x) *
            (point.y - a.y)
        ) /
          (b.y - a.y + 1e-12) +
        a.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  let t =
    lengthSq > 0
      ? (
          (point.x - a.x) * dx +
          (point.y - a.y) * dy
        ) / lengthSq
      : 0;

  t = Math.max(0, Math.min(1, t));

  const x = a.x + dx * t;
  const y = a.y + dy * t;

  return Math.hypot(
    point.x - x,
    point.y - y,
  );
}

function sceneSnapshot(scene) {
  return JSON.stringify({
    rooms: scene.rooms.map((room) => ({
      id: room.id,
      kind: room.kind,
      color: room.color,
      vertices: room.vertices.map((point) => [
        Number(point.x.toFixed(4)),
        Number(point.y.toFixed(4)),
      ]),
      doors: room.doors
        .map((door) => [
          door.edgeIndex,
          Number(door.t.toFixed(5)),
          Number(door.width.toFixed(3)),
        ])
        .sort((a, b) =>
          a[0] - b[0] ||
          a[1] - b[1] ||
          a[2] - b[2],
        ),
    })),
    connectors: scene.connectors.map((connector) => ({
      id: connector.id,
      edgeKey: connector.edgeKey,
      primary: connector.primary,
      fromRoomId: connector.fromRoomId,
      toRoomId: connector.toRoomId,
      width: Number(connector.width.toFixed(3)),
      points: connector.points.map((point) => [
        Number(point.x.toFixed(4)),
        Number(point.y.toFixed(4)),
      ]),
    })),
  });
}

function verifySiteField(seed) {
  const sites = [];

  for (let sy = -20; sy <= 20; sy++) {
    for (let sx = -20; sx <= 20; sx++) {
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
        `Missing parent for ${seed} at ${sx},${sy}`,
      );

      assert(
        isSiteCell(seed, parent[0], parent[1]),
        `Parent for ${seed} at ${sx},${sy} is not accepted`,
      );

      const root = sitePosition(seed, 0, 0);
      const parentPoint = sitePosition(
        seed,
        parent[0],
        parent[1],
      );

      const before =
        (point.x - root.x) ** 2 +
        (point.y - root.y) ** 2;

      const after =
        (parentPoint.x - root.x) ** 2 +
        (parentPoint.y - root.y) ** 2;

      assert(
        after < before,
        `Parent failed root-rank decrease for ${seed} at ${sx},${sy}`,
      );

      const parentDistance = Math.hypot(
        parentPoint.x - point.x,
        parentPoint.y - point.y,
      );

      assert(
        parentDistance < 500,
        `Parent link too long for ${seed}: ${parentDistance.toFixed(2)}`,
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
    minimumDistance >= SITE_MIN_DISTANCE - 0.01,
    `Hard-core site spacing failed for ${seed}: ${minimumDistance.toFixed(2)}`,
  );

  const bucketSize = 500;
  const bucketCounts = new Map();

  for (const site of sites) {
    const bx = Math.floor(site.x / bucketSize);
    const by = Math.floor(site.y / bucketSize);
    const key = `${bx},${by}`;

    bucketCounts.set(
      key,
      (bucketCounts.get(key) || 0) + 1,
    );
  }

  const distinctCounts =
    new Set(bucketCounts.values());

  assert(
    distinctCounts.size >= 2,
    `Expected irregular site counts for ${seed}`,
  );

  return {
    siteCount: sites.length,
    minimumDistance,
  };
}

function coverageMetrics(scene, bounds, cell = 18) {
  const width = Math.ceil(
    (bounds.maxX - bounds.minX) / cell,
  );

  const height = Math.ceil(
    (bounds.maxY - bounds.minY) / cell,
  );

  const occupied =
    new Uint8Array(width * height);

  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      const point = {
        x: bounds.minX + (gx + 0.5) * cell,
        y: bounds.minY + (gy + 0.5) * cell,
      };

      let on = false;

      for (const room of scene.rooms) {
        if (
          point.x < room.aabb.minX ||
          point.x > room.aabb.maxX ||
          point.y < room.aabb.minY ||
          point.y > room.aabb.maxY
        ) {
          continue;
        }

        if (
          pointInPolygon(
            point,
            room.vertices,
          )
        ) {
          on = true;
          break;
        }
      }

      if (!on) {
        connectorLoop:
        for (const connector of scene.connectors) {
          for (
            let index = 0;
            index < connector.points.length - 1;
            index++
          ) {
            if (
              pointSegmentDistance(
                point,
                connector.points[index],
                connector.points[index + 1],
              ) <=
              connector.width * 0.5
            ) {
              on = true;
              break connectorLoop;
            }
          }
        }
      }

      if (on) {
        occupied[gy * width + gx] = 1;
      }
    }
  }

  let occupiedCount = 0;

  for (const value of occupied) {
    occupiedCount += value;
  }

  const seen =
    new Uint8Array(occupied.length);

  const queue =
    new Int32Array(occupied.length);

  let largestVoid = 0;

  for (
    let index = 0;
    index < occupied.length;
    index++
  ) {
    if (
      occupied[index] ||
      seen[index]
    ) {
      continue;
    }

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

        if (
          !occupied[next] &&
          !seen[next]
        ) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }

      if (x < width - 1) {
        const next = current + 1;

        if (
          !occupied[next] &&
          !seen[next]
        ) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }

      if (y > 0) {
        const next = current - width;

        if (
          !occupied[next] &&
          !seen[next]
        ) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }

      if (y < height - 1) {
        const next = current + width;

        if (
          !occupied[next] &&
          !seen[next]
        ) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    largestVoid = Math.max(
      largestVoid,
      count,
    );
  }

  return {
    coverage:
      occupiedCount /
      occupied.length,
    largestVoidFraction:
      largestVoid /
      occupied.length,
  };
}

function verifyScene(seed) {
  const generator =
    new InfiniteMapGenerator(seed);

  const bounds = {
    minX: -1100,
    maxX: 1100,
    minY: -700,
    maxY: 700,
  };

  const scene =
    generator.query(bounds);

  assert(
    scene.rooms.length >= 80,
    `Expected dense room population for ${seed}`,
  );

  assert(
    scene.connectors.length >= 80,
    `Expected connected room graph for ${seed}`,
  );

  for (let i = 0; i < scene.rooms.length; i++) {
    for (
      let j = i + 1;
      j < scene.rooms.length;
      j++
    ) {
      assert(
        !roomsOverlap(
          scene.rooms[i],
          scene.rooms[j],
        ),
        `Room overlap in ${seed}: ${scene.rooms[i].id} and ${scene.rooms[j].id}`,
      );
    }
  }

  const connectorLengths = [];

  for (const connector of scene.connectors) {
    assert(
      connector.fromRoomId &&
        connector.toRoomId,
      `Missing connector room topology in ${seed}`,
    );

    for (
      let index = 0;
      index < connector.points.length - 1;
      index++
    ) {
      connectorLengths.push(
        Math.hypot(
          connector.points[index + 1].x -
            connector.points[index].x,
          connector.points[index + 1].y -
            connector.points[index].y,
        ),
      );
    }
  }

  connectorLengths.sort((a, b) => a - b);

  const p90 =
    connectorLengths[
      Math.floor(
        connectorLengths.length * 0.90,
      )
    ];

  const maxConnector =
    connectorLengths[
      connectorLengths.length - 1
    ];

  assert(
    p90 <= 75,
    `Too many long passage segments for ${seed}: p90=${p90.toFixed(2)}`,
  );

  assert(
    maxConnector <= 150,
    `Uninterrupted passage too long for ${seed}: ${maxConnector.toFixed(2)}`,
  );

  const totalDoors =
    scene.rooms.reduce(
      (sum, room) =>
        sum + room.doors.length,
      0,
    );

  assert(
    totalDoors >=
      scene.connectors.length * 1.75,
    `Expected explicit portal openings for ${seed}`,
  );

  const areas =
    scene.rooms
      .map((room) =>
        polygonArea(
          room.vertices,
        ),
      )
      .sort((a, b) => a - b);

  const medianArea =
    areas[
      Math.floor(areas.length * 0.5)
    ];

  const p90Area =
    areas[
      Math.floor(areas.length * 0.9)
    ];

  const maxArea =
    areas[areas.length - 1];

  assert(
    maxArea / medianArea >= 6,
    `Insufficient room-scale hierarchy for ${seed}`,
  );

  assert(
    p90Area / areas[0] >= 3,
    `Insufficient small/large-room variation for ${seed}`,
  );

  const kinds =
    new Set(
      scene.rooms.map(
        (room) => room.kind,
      ),
    );

  assert(
    kinds.size >= 7,
    `Insufficient room-style variation for ${seed}: ${kinds.size}`,
  );

  const coverage =
    coverageMetrics(
      scene,
      bounds,
    );

  assert(
    coverage.coverage >= 0.14 &&
      coverage.coverage <= 0.38,
    `Architectural coverage outside target range for ${seed}: ${coverage.coverage.toFixed(3)}`,
  );

  assert(
    coverage.largestVoidFraction >= 0.08,
    `Negative space collapsed for ${seed}: ${coverage.largestVoidFraction.toFixed(3)}`,
  );

  const standalone =
    sceneSnapshot(
      new InfiniteMapGenerator(
        seed,
      ).query(bounds),
    );

  const larger =
    new InfiniteMapGenerator(seed);

  larger.query({
    minX: -2500,
    maxX: 2500,
    minY: -1700,
    maxY: 1700,
  });

  const afterLarge =
    sceneSnapshot(
      larger.query(bounds),
    );

  assert(
    standalone === afterLarge,
    `Query-size determinism failed for ${seed}`,
  );

  const remote =
    new InfiniteMapGenerator(seed);

  remote.query({
    minX: 9000,
    maxX: 11200,
    minY: -7600,
    maxY: -6200,
  });

  const afterRemote =
    sceneSnapshot(
      remote.query(bounds),
    );

  assert(
    standalone === afterRemote,
    `Exploration-order determinism failed for ${seed}`,
  );

  return {
    rooms: scene.rooms.length,
    connectors:
      scene.connectors.length,
    doors: totalDoors,
    roomKinds: kinds.size,
    coverage:
      coverage.coverage,
    largestVoidFraction:
      coverage.largestVoidFraction,
    medianRoomArea:
      medianArea,
    maxRoomArea:
      maxArea,
    p90ConnectorLength: p90,
    maxConnectorLength:
      maxConnector,
  };
}

assert(
  GENERATOR_VERSION === 10,
  'Expected generator version 10',
);

assert(
  SITE_GRID > SITE_MIN_DISTANCE,
  'Site enumeration grid must exceed hard-core distance',
);

const seeds = [
  'backrooms-71',
  'alpha',
  'reference',
];

const results = [];

for (const seed of seeds) {
  const siteField =
    verifySiteField(seed);

  const scene =
    verifyScene(seed);

  results.push({
    seed,
    ...siteField,
    ...scene,
  });
}

console.log(
  JSON.stringify({
    generatorVersion:
      GENERATOR_VERSION,
    results:
      results.map(
        (result) => ({
          seed: result.seed,
          sites:
            result.siteCount,
          minimumSiteDistance:
            Number(
              result.minimumDistance.toFixed(2),
            ),
          rooms:
            result.rooms,
          connectors:
            result.connectors,
          doors:
            result.doors,
          roomKinds:
            result.roomKinds,
          coverage:
            Number(
              result.coverage.toFixed(3),
            ),
          largestVoidFraction:
            Number(
              result.largestVoidFraction.toFixed(3),
            ),
          medianRoomArea:
            Number(
              result.medianRoomArea.toFixed(1),
            ),
          maxRoomArea:
            Number(
              result.maxRoomArea.toFixed(1),
            ),
          p90ConnectorLength:
            Number(
              result.p90ConnectorLength.toFixed(2),
            ),
          maxConnectorLength:
            Number(
              result.maxConnectorLength.toFixed(2),
            ),
        }),
      ),
    status: 'ok',
  }),
);
