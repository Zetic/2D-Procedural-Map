import {
  GENERATOR_VERSION,
  InfiniteMapGenerator,
  parentCell,
  roomsOverlap,
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
    rooms: cell.rooms.map((room) => [
      room.id,
      Number(room.x.toFixed(4)),
      Number(room.y.toFixed(4)),
      Number(room.w.toFixed(4)),
      Number(room.h.toFixed(4)),
      Number(room.angle.toFixed(6)),
    ]),
    doors: cell.doors.map((door) => [
      Number(door.x.toFixed(3)),
      Number(door.y.toFixed(3)),
      Number(door.angle.toFixed(5)),
      Number(door.width.toFixed(3)),
    ]),
    corridors: cell.corridors.map((corridor) => [
      corridor.edgeKey,
      Number(corridor.width.toFixed(3)),
      corridor.points.map((point) => [
        Number(point.x.toFixed(3)),
        Number(point.y.toFixed(3)),
      ]),
    ]),
  })));
}

function verifyParentChains(seed) {
  for (let cy = -18; cy <= 18; cy += 3) {
    for (let cx = -18; cx <= 18; cx += 3) {
      let x = cx;
      let y = cy;
      let guard = 0;

      while (x !== 0 || y !== 0) {
        const parent = parentCell(seed, x, y);
        assert(parent, `Missing parent for ${seed} at ${x},${y}`);

        const before = Math.abs(x) + Math.abs(y);
        const after = Math.abs(parent[0]) + Math.abs(parent[1]);
        assert(
          after === before - 1,
          `Parent chain did not approach origin for ${seed} at ${x},${y}`,
        );

        [x, y] = parent;
        guard += 1;
        assert(guard < 1000, `Parent chain guard exceeded for ${seed}`);
      }
    }
  }
}

function verifyRegion(generator, bounds) {
  const cells = generator.query(bounds);
  const rooms = [];
  const corridorMap = new Map();

  for (const cell of cells) {
    rooms.push(...cell.rooms);
    for (const corridor of cell.corridors) {
      corridorMap.set(corridor.edgeKey, corridor);
    }
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      assert(
        !roomsOverlap(rooms[i], rooms[j], -0.1),
        `Room interior overlap: ${rooms[i].id} and ${rooms[j].id}`,
      );
    }
  }

  for (const corridor of corridorMap.values()) {
    // First and last segments intentionally cross their selected room wall.
    // Every middle segment must remain clear of room interiors.
    for (let i = 1; i < corridor.points.length - 2; i++) {
      const segment = segmentRect(
        corridor.points[i],
        corridor.points[i + 1],
        corridor.width,
      );

      for (const room of rooms) {
        assert(
          !roomsOverlap(segment, room, -0.1),
          `Corridor ${corridor.edgeKey} crosses room ${room.id}`,
        );
      }
    }

    for (const chamber of corridor.chambers) {
      for (const room of rooms) {
        assert(
          !roomsOverlap(chamber, room, -0.1),
          `Route chamber for ${corridor.edgeKey} overlaps room ${room.id}`,
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
    rooms: rooms.length,
    cells: cells.length,
    corridors: corridorMap.size,
    chambers: [...corridorMap.values()].reduce(
      (total, corridor) => total + corridor.chambers.length,
      0,
    ),
    kinds,
    cutouts,
    wideOpenings,
  };
}

const seeds = ['backrooms-71', 'alpha', 'reference'];
const regions = [
  { minX: -1800, maxX: 1800, minY: -1350, maxY: 1350 },
  { minX: 3600, maxX: 6300, minY: -2700, maxY: 0 },
];

assert(GENERATOR_VERSION === 4, 'Expected generator version 4');

let totals = {
  rooms: 0,
  cells: 0,
  corridors: 0,
  chambers: 0,
  cutouts: 0,
  wideOpenings: 0,
};
const observedKinds = new Set();

for (const seed of seeds) {
  verifyParentChains(seed);

  const generator = new InfiniteMapGenerator(seed);

  for (const region of regions) {
    const result = verifyRegion(generator, region);
    totals.rooms += result.rooms;
    totals.cells += result.cells;
    totals.corridors += result.corridors;
    totals.chambers += result.chambers;
    totals.cutouts += result.cutouts;
    totals.wideOpenings += result.wideOpenings;
    for (const kind of result.kinds) observedKinds.add(kind);
  }

  const home = { minX: -900, maxX: 900, minY: -900, maxY: 900 };
  const before = snapshot(generator.query(home));

  generator.query({
    minX: 10800,
    maxX: 12600,
    minY: -9000,
    maxY: -7200,
  });

  const after = snapshot(generator.query(home));
  assert(before === after, `Exploration-order determinism failed for ${seed}`);
}

const averageRoomsPerCell = totals.rooms / totals.cells;

assert(
  averageRoomsPerCell >= 12,
  `Expected dense generation, got only ${averageRoomsPerCell.toFixed(2)} rooms/cell`,
);
assert(
  observedKinds.size >= 10,
  `Expected room-style variety, observed only ${observedKinds.size} kinds`,
);
assert(totals.cutouts > 0, 'Expected notched/courtyard room shapes');
assert(totals.wideOpenings > 0, 'Expected wide compound-room openings');

console.log(
  JSON.stringify({
    generatorVersion: GENERATOR_VERSION,
    seeds: seeds.length,
    regions: seeds.length * regions.length,
    roomKinds: [...observedKinds].sort(),
    averageRoomsPerCell: Number(averageRoomsPerCell.toFixed(2)),
    ...totals,
    status: 'ok',
  }),
);
