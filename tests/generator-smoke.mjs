import {
  GENERATOR_VERSION,
  InfiniteMapGenerator,
  isSiteCell,
  parentCell,
  roomsOverlap,
  sitePosition,
} from '../src/generator.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function segmentRect(a, b, width) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
    w: Math.max(1, Math.hypot(dx, dy)),
    h: width,
    angle: Math.atan2(dy, dx),
  };
}

function snapshot(cells) {
  return JSON.stringify(cells.map((cell) => ({
    cx: cell.cx,
    cy: cell.cy,
    siteId: cell.siteId,
    parent: cell.parent,
    anchor: [
      Number(cell.anchor.x.toFixed(4)),
      Number(cell.anchor.y.toFixed(4)),
    ],
    rooms: cell.rooms.map((room) => [
      room.id,
      Number(room.x.toFixed(4)),
      Number(room.y.toFixed(4)),
      Number(room.w.toFixed(4)),
      Number(room.h.toFixed(4)),
      Number(room.angle.toFixed(6)),
      room.kind,
    ]),
    doors: cell.doors.map((door) => [
      Number(door.x.toFixed(3)),
      Number(door.y.toFixed(3)),
      Number(door.angle.toFixed(5)),
      Number(door.width.toFixed(3)),
      door.kind,
    ]),
    corridors: cell.corridors.map((corridor) => [
      corridor.edgeKey,
      Number(corridor.width.toFixed(3)),
      corridor.points.map((point) => [
        Number(point.x.toFixed(3)),
        Number(point.y.toFixed(3)),
      ]),
      corridor.chambers.map((room) => [
        room.id,
        Number(room.x.toFixed(3)),
        Number(room.y.toFixed(3)),
        Number(room.w.toFixed(3)),
        Number(room.h.toFixed(3)),
        room.kind,
      ]),
      (corridor.fabricDoors || []).map((door) => [
        Number(door.x.toFixed(3)),
        Number(door.y.toFixed(3)),
        Number(door.width.toFixed(3)),
        door.kind,
      ]),
    ]),
  })));
}

function rootDistanceSq(seed, cx, cy) {
  const root = sitePosition(seed, 0, 0);
  const point = sitePosition(seed, cx, cy);
  const dx = point.x - root.x;
  const dy = point.y - root.y;
  return dx * dx + dy * dy;
}

function verifyParentChain(seed, cx, cy) {
  let x = cx;
  let y = cy;
  let guard = 0;

  while (x !== 0 || y !== 0) {
    assert(isSiteCell(seed, x, y), `Expected accepted site at ${x},${y}`);

    const parent = parentCell(seed, x, y);
    assert(parent, `Missing parent for site ${x},${y}`);

    const before = rootDistanceSq(seed, x, y);
    const after = rootDistanceSq(seed, parent[0], parent[1]);

    assert(
      after < before,
      `Parent did not decrease root distance for ${x},${y}`,
    );

    [x, y] = parent;
    guard += 1;
    assert(guard < 500, `Parent chain guard exceeded for ${cx},${cy}`);
  }
}

function verifyBlueNoiseSites(seed, cells) {
  const sites = cells.map((cell) => ({
    cx: cell.cx,
    cy: cell.cy,
    x: cell.anchor.x,
    y: cell.anchor.y,
  }));

  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const dx = sites[i].x - sites[j].x;
      const dy = sites[i].y - sites[j].y;
      const distance = Math.hypot(dx, dy);

      assert(
        distance >= 499.9,
        `Blue-noise sites too close: ${sites[i].cx},${sites[i].cy} and ${sites[j].cx},${sites[j].cy} at ${distance.toFixed(2)}`,
      );
    }
  }

  const bucketCounts = new Map();
  const bucketSize = 900;
  let minBX = Infinity;
  let maxBX = -Infinity;
  let minBY = Infinity;
  let maxBY = -Infinity;

  for (const site of sites) {
    const bx = Math.floor(site.x / bucketSize);
    const by = Math.floor(site.y / bucketSize);
    minBX = Math.min(minBX, bx);
    maxBX = Math.max(maxBX, bx);
    minBY = Math.min(minBY, by);
    maxBY = Math.max(maxBY, by);
    const key = `${bx},${by}`;
    bucketCounts.set(key, (bucketCounts.get(key) || 0) + 1);
  }

  const counts = [];

  for (let by = minBY; by <= maxBY; by++) {
    for (let bx = minBX; bx <= maxBX; bx++) {
      counts.push(bucketCounts.get(`${bx},${by}`) || 0);
    }
  }

  assert(
    new Set(counts).size >= 3,
    'Expected strongly varying site counts per query-sized bucket',
  );
  assert(
    counts.some((count) => count === 0),
    'Expected some query-sized buckets to contain no growth source',
  );
  assert(
    counts.some((count) => count >= 2),
    'Expected some query-sized buckets to contain multiple growth sources',
  );
}

function verifyRegion(seed, generator, bounds) {
  const cells = generator.query(bounds);
  const rooms = [];
  const corridorMap = new Map();

  for (const cell of cells) {
    verifyParentChain(seed, cell.cx, cell.cy);
    rooms.push(...cell.rooms);

    for (const corridor of cell.corridors) {
      corridorMap.set(corridor.edgeKey, corridor);
    }
  }

  verifyBlueNoiseSites(seed, cells);

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      assert(
        !roomsOverlap(rooms[i], rooms[j], -0.1),
        `Local room interior overlap: ${rooms[i].id} and ${rooms[j].id}`,
      );
    }
  }

  let maxSegmentLength = 0;
  let fabricRooms = 0;
  let fabricDoors = 0;

  for (const corridor of corridorMap.values()) {
    fabricRooms += corridor.chambers.length;
    fabricDoors += (corridor.fabricDoors || []).length;

    for (let i = 0; i < corridor.points.length - 1; i++) {
      const a = corridor.points[i];
      const b = corridor.points[i + 1];

      maxSegmentLength = Math.max(
        maxSegmentLength,
        Math.hypot(b.x - a.x, b.y - a.y),
      );
    }

    for (let i = 1; i < corridor.points.length - 2; i++) {
      const segment = segmentRect(
        corridor.points[i],
        corridor.points[i + 1],
        corridor.width,
      );

      for (const room of rooms) {
        assert(
          !roomsOverlap(segment, room, -0.1),
          `Growth spine ${corridor.edgeKey} crosses local room ${room.id}`,
        );
      }
    }

    for (const chamber of corridor.chambers) {
      for (const room of rooms) {
        assert(
          !roomsOverlap(chamber, room, -0.1),
          `Growth-fabric room for ${corridor.edgeKey} overlaps local room ${room.id}`,
        );
      }
    }
  }

  const kinds = new Set();
  let cutouts = 0;
  let wideOpenings = 0;

  for (const cell of cells) {
    for (const room of cell.rooms) {
      kinds.add(room.kind);
      if ((room.cutouts || []).length) cutouts += 1;
    }

    for (const door of cell.doors) {
      if (door.kind === 'opening') wideOpenings += 1;
    }
  }

  return {
    sites: cells.length,
    rooms: rooms.length,
    corridors: corridorMap.size,
    fabricRooms,
    fabricDoors,
    maxSegmentLength,
    cutouts,
    wideOpenings,
    kinds,
  };
}

assert(GENERATOR_VERSION === 6, 'Expected generator version 6');

const seeds = ['backrooms-71', 'alpha', 'reference'];
const regions = [
  { minX: -2200, maxX: 2200, minY: -1650, maxY: 1650 },
  { minX: 3200, maxX: 6200, minY: -3000, maxY: 0 },
];

const totals = {
  sites: 0,
  rooms: 0,
  corridors: 0,
  fabricRooms: 0,
  fabricDoors: 0,
  cutouts: 0,
  wideOpenings: 0,
  maxSegmentLength: 0,
};
const observedKinds = new Set();

for (const seed of seeds) {
  const generator = new InfiniteMapGenerator(seed);

  for (const region of regions) {
    const result = verifyRegion(seed, generator, region);

    totals.sites += result.sites;
    totals.rooms += result.rooms;
    totals.corridors += result.corridors;
    totals.fabricRooms += result.fabricRooms;
    totals.fabricDoors += result.fabricDoors;
    totals.cutouts += result.cutouts;
    totals.wideOpenings += result.wideOpenings;
    totals.maxSegmentLength = Math.max(
      totals.maxSegmentLength,
      result.maxSegmentLength,
    );

    for (const kind of result.kinds) observedKinds.add(kind);
  }

  const home = { minX: -1000, maxX: 1000, minY: -800, maxY: 800 };
  const before = snapshot(generator.query(home));

  generator.query({
    minX: 12000,
    maxX: 14000,
    minY: -10000,
    maxY: -8000,
  });

  const after = snapshot(generator.query(home));

  assert(
    before === after,
    `Exploration-order determinism failed for ${seed}`,
  );
}

const averageRoomsPerSite = totals.rooms / Math.max(1, totals.sites);
const averageFabricRoomsPerCorridor =
  totals.fabricRooms / Math.max(1, totals.corridors);

assert(
  averageRoomsPerSite >= 7,
  `Expected dense local growth, got only ${averageRoomsPerSite.toFixed(2)} rooms/site`,
);
assert(
  averageFabricRoomsPerCorridor >= 3,
  `Expected dense connection fabric, got only ${averageFabricRoomsPerCorridor.toFixed(2)} rooms/connection`,
);
assert(
  totals.maxSegmentLength <= 115,
  `Uninterrupted growth segment too long: ${totals.maxSegmentLength.toFixed(2)}`,
);
assert(
  observedKinds.size >= 10,
  `Expected architectural variety, observed only ${observedKinds.size} kinds`,
);
assert(totals.cutouts > 0, 'Expected notched/courtyard room shapes');
assert(totals.wideOpenings > 0, 'Expected wide compound-room openings');

console.log(
  JSON.stringify({
    generatorVersion: GENERATOR_VERSION,
    seeds: seeds.length,
    regions: seeds.length * regions.length,
    sites: totals.sites,
    rooms: totals.rooms,
    corridors: totals.corridors,
    fabricRooms: totals.fabricRooms,
    fabricDoors: totals.fabricDoors,
    averageRoomsPerSite: Number(averageRoomsPerSite.toFixed(2)),
    averageFabricRoomsPerCorridor: Number(
      averageFabricRoomsPerCorridor.toFixed(2),
    ),
    maxSegmentLength: Number(totals.maxSegmentLength.toFixed(2)),
    roomKinds: [...observedKinds].sort(),
    cutouts: totals.cutouts,
    wideOpenings: totals.wideOpenings,
    status: 'ok',
  }),
);
