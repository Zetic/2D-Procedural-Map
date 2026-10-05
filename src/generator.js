export const CELL_SIZE = 820;
export const QUERY_HALO = 2;
export const GENERATOR_VERSION = 4;

const TAU = Math.PI * 2;
const MAX_COMPLEX_RADIUS = 304;
const ROUTE_STEP = 42;
const WALL = '#665947';
const FLOOR_PALETTES = [
  '#ead29c', '#e6c98b', '#ecd5a8', '#dfc08b', '#e9d0a2',
  '#e5b6a8', '#b8c5d0', '#b9c998', '#dbc3b7', '#d8b47f'
];

function mix32(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashString(value) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mix32(h);
}

function hashInt(seed, x, y, salt = 0) {
  let h = seed >>> 0;
  h ^= Math.imul((x | 0), 0x9e3779b1);
  h = mix32(h);
  h ^= Math.imul((y | 0), 0x85ebca77);
  h = mix32(h);
  h ^= Math.imul((salt | 0), 0xc2b2ae3d);
  return mix32(h);
}

function hash01(seed, x, y, salt = 0) {
  return hashInt(seed, x, y, salt) / 4294967296;
}

function hashSigned(seed, x, y, salt = 0) {
  return hash01(seed, x, y, salt) * 2 - 1;
}

function keyOf(cx, cy) {
  return String(cx) + ',' + String(cy);
}

function sameCell(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

function distanceRank(cx, cy) {
  return Math.abs(cx) + Math.abs(cy);
}

function canonicalEdgeKey(ax, ay, bx, by) {
  if (ax < bx || (ax === bx && ay <= by)) return ax + ',' + ay + '|' + bx + ',' + by;
  return bx + ',' + by + '|' + ax + ',' + ay;
}

function edgeSalt(edgeKey, salt) {
  return mix32(hashString(edgeKey) ^ salt);
}

function seededRng(seedValue) {
  let s = mix32(seedValue >>> 0) || 0x12345678;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function choosePalette(seed, cx, cy) {
  const rare = hash01(seed, cx, cy, 701);
  let index;
  if (rare < 0.80) index = Math.floor(hash01(seed, cx, cy, 702) * 5);
  else index = 5 + Math.floor(hash01(seed, cx, cy, 703) * (FLOOR_PALETTES.length - 5));
  return FLOOR_PALETTES[Math.min(index, FLOOR_PALETTES.length - 1)];
}

function anchorFor(seed, cx, cy) {
  const jitter = CELL_SIZE * 0.10;
  return {
    x: cx * CELL_SIZE + CELL_SIZE * 0.5 + hashSigned(seed, cx, cy, 11) * jitter,
    y: cy * CELL_SIZE + CELL_SIZE * 0.5 + hashSigned(seed, cx, cy, 12) * jitter,
  };
}

function parentFor(seed, cx, cy) {
  if (cx === 0 && cy === 0) return null;
  if (cx === 0) return [0, cy - sign(cy)];
  if (cy === 0) return [cx - sign(cx), 0];

  if (hash01(seed, cx, cy, 21) < 0.5) return [cx - sign(cx), cy];
  return [cx, cy - sign(cy)];
}

function isTreeEdge(seed, ax, ay, bx, by) {
  const aParent = parentFor(seed, ax, ay);
  const bParent = parentFor(seed, bx, by);
  return (aParent && aParent[0] === bx && aParent[1] === by) ||
    (bParent && bParent[0] === ax && bParent[1] === ay);
}

function optionalNeighborEdges(seed, cx, cy) {
  const output = [];
  const candidates = [
    [cx + 1, cy, 31],
    [cx, cy + 1, 32],
    [cx + 1, cy + 1, 33],
    [cx + 1, cy - 1, 34],
  ];

  for (const [nx, ny, salt] of candidates) {
    if (isTreeEdge(seed, cx, cy, nx, ny)) continue;
    const edge = canonicalEdgeKey(cx, cy, nx, ny);
    const chance = ((hashString(edge) ^ seed ^ salt) >>> 0) / 4294967296;
    const rankDelta = Math.abs(distanceRank(nx, ny) - distanceRank(cx, cy));
    const threshold = rankDelta === 0 ? 0.18 : 0.08;
    if (chance < threshold) output.push([nx, ny]);
  }
  return output;
}

function roomAxes(room) {
  const c = Math.cos(room.angle);
  const s = Math.sin(room.angle);
  return [
    { x: c, y: s },
    { x: -s, y: c },
  ];
}

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

export function roomsOverlap(a, b, padding = 0) {
  const [aX, aY] = roomAxes(a);
  const [bX, bY] = roomAxes(b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const aHalfW = a.w * 0.5 + padding;
  const aHalfH = a.h * 0.5 + padding;
  const bHalfW = b.w * 0.5 + padding;
  const bHalfH = b.h * 0.5 + padding;

  for (const axis of [aX, aY, bX, bY]) {
    const distance = Math.abs(dot(dx, dy, axis.x, axis.y));
    const radiusA =
      aHalfW * Math.abs(dot(aX.x, aX.y, axis.x, axis.y)) +
      aHalfH * Math.abs(dot(aY.x, aY.y, axis.x, axis.y));
    const radiusB =
      bHalfW * Math.abs(dot(bX.x, bX.y, axis.x, axis.y)) +
      bHalfH * Math.abs(dot(bY.x, bY.y, axis.x, axis.y));
    if (distance >= radiusA + radiusB) return false;
  }

  return true;
}

function roomCorners(room) {
  const [xAxis, yAxis] = roomAxes(room);
  const hw = room.w * 0.5;
  const hh = room.h * 0.5;
  return [
    { x: room.x + xAxis.x * hw + yAxis.x * hh, y: room.y + xAxis.y * hw + yAxis.y * hh },
    { x: room.x + xAxis.x * hw - yAxis.x * hh, y: room.y + xAxis.y * hw - yAxis.y * hh },
    { x: room.x - xAxis.x * hw + yAxis.x * hh, y: room.y - xAxis.y * hw + yAxis.y * hh },
    { x: room.x - xAxis.x * hw - yAxis.x * hh, y: room.y - xAxis.y * hw - yAxis.y * hh },
  ];
}

function sideInfo(room, side) {
  const [xAxis, yAxis] = roomAxes(room);
  let normal;
  let tangent;
  let halfNormal;
  let halfTangent;

  if (side === 0) {
    normal = xAxis;
    tangent = yAxis;
    halfNormal = room.w * 0.5;
    halfTangent = room.h * 0.5;
  } else if (side === 1) {
    normal = yAxis;
    tangent = xAxis;
    halfNormal = room.h * 0.5;
    halfTangent = room.w * 0.5;
  } else if (side === 2) {
    normal = { x: -xAxis.x, y: -xAxis.y };
    tangent = yAxis;
    halfNormal = room.w * 0.5;
    halfTangent = room.h * 0.5;
  } else {
    normal = { x: -yAxis.x, y: -yAxis.y };
    tangent = xAxis;
    halfNormal = room.h * 0.5;
    halfTangent = room.w * 0.5;
  }

  return {
    side,
    normal,
    tangent,
    halfNormal,
    halfTangent,
    x: room.x + normal.x * halfNormal,
    y: room.y + normal.y * halfNormal,
  };
}

function oppositeSide(side) {
  return (side + 2) % 4;
}

function complexProfile(seed, cx, cy) {
  const roll = hash01(seed, cx, cy, 744);
  if (roll < 0.18) {
    return {
      name: 'service-maze',
      targetBase: 27,
      targetJitter: 12,
      branch: 0.82,
      majorChance: 0.045,
      openChance: 0.16,
      cutoutChance: 0.08,
      columnChance: 0.12,
      partitionChance: 0.54,
      scale: 0.82,
    };
  }
  if (roll < 0.36) {
    return {
      name: 'galleries',
      targetBase: 23,
      targetJitter: 11,
      branch: 0.74,
      majorChance: 0.075,
      openChance: 0.28,
      cutoutChance: 0.10,
      columnChance: 0.18,
      partitionChance: 0.42,
      scale: 1.02,
    };
  }
  if (roll < 0.53) {
    return {
      name: 'atrium',
      targetBase: 20,
      targetJitter: 9,
      branch: 0.67,
      majorChance: 0.18,
      openChance: 0.48,
      cutoutChance: 0.28,
      columnChance: 0.52,
      partitionChance: 0.30,
      scale: 1.08,
    };
  }
  if (roll < 0.69) {
    return {
      name: 'office-web',
      targetBase: 29,
      targetJitter: 13,
      branch: 0.86,
      majorChance: 0.055,
      openChance: 0.20,
      cutoutChance: 0.06,
      columnChance: 0.10,
      partitionChance: 0.66,
      scale: 0.88,
    };
  }
  if (roll < 0.84) {
    return {
      name: 'warehouse',
      targetBase: 19,
      targetJitter: 9,
      branch: 0.65,
      majorChance: 0.22,
      openChance: 0.42,
      cutoutChance: 0.18,
      columnChance: 0.72,
      partitionChance: 0.22,
      scale: 1.16,
    };
  }
  return {
    name: 'mixed',
    targetBase: 24,
    targetJitter: 12,
    branch: 0.76,
    majorChance: 0.11,
    openChance: 0.31,
    cutoutChance: 0.16,
    columnChance: 0.34,
    partitionChance: 0.40,
    scale: 1.0,
  };
}

function roomDimensions(rng, attachSide, depth, profile) {
  const roll = rng();
  let normal;
  let cross;
  let major = false;
  let kind = 'room';

  if (profile.name === 'service-maze') {
    if (roll < 0.28) {
      normal = 30 + rng() * 38;
      cross = 24 + rng() * 36;
      kind = 'cell';
    } else if (roll < 0.52) {
      normal = 76 + rng() * 92;
      cross = 22 + rng() * 26;
      kind = 'service-hall';
    } else if (roll < 0.76) {
      normal = 28 + rng() * 36;
      cross = 72 + rng() * 82;
      kind = 'cross-hall';
    } else {
      normal = 48 + rng() * 62;
      cross = 40 + rng() * 58;
      kind = 'room';
    }
  } else if (profile.name === 'galleries') {
    if (roll < 0.38) {
      normal = 118 + rng() * 112;
      cross = 28 + rng() * 36;
      kind = 'gallery';
    } else if (roll < 0.62) {
      normal = 40 + rng() * 48;
      cross = 108 + rng() * 104;
      kind = 'transverse-gallery';
    } else if (roll < 0.82) {
      normal = 72 + rng() * 78;
      cross = 54 + rng() * 66;
      kind = 'room';
    } else {
      normal = 118 + rng() * 90;
      cross = 86 + rng() * 78;
      major = depth < 5;
      kind = 'hall';
    }
  } else if (profile.name === 'atrium') {
    if (roll < 0.34 && depth < 5) {
      normal = 126 + rng() * 100;
      cross = 112 + rng() * 98;
      major = true;
      kind = 'atrium';
    } else if (roll < 0.60) {
      normal = 88 + rng() * 88;
      cross = 42 + rng() * 54;
      kind = 'wing';
    } else if (roll < 0.80) {
      normal = 44 + rng() * 54;
      cross = 92 + rng() * 84;
      kind = 'wing';
    } else {
      normal = 54 + rng() * 66;
      cross = 48 + rng() * 62;
      kind = 'room';
    }
  } else if (profile.name === 'office-web') {
    if (roll < 0.36) {
      normal = 34 + rng() * 42;
      cross = 32 + rng() * 44;
      kind = 'office';
    } else if (roll < 0.60) {
      normal = 72 + rng() * 86;
      cross = 24 + rng() * 28;
      kind = 'office-hall';
    } else if (roll < 0.78) {
      normal = 30 + rng() * 34;
      cross = 74 + rng() * 84;
      kind = 'office-hall';
    } else {
      normal = 62 + rng() * 72;
      cross = 52 + rng() * 66;
      kind = 'office-suite';
    }
  } else if (profile.name === 'warehouse') {
    if (roll < 0.44 && depth < 5) {
      normal = 144 + rng() * 112;
      cross = 112 + rng() * 96;
      major = true;
      kind = 'warehouse';
    } else if (roll < 0.70) {
      normal = 110 + rng() * 92;
      cross = 42 + rng() * 54;
      kind = 'loading-hall';
    } else {
      normal = 72 + rng() * 82;
      cross = 58 + rng() * 72;
      kind = 'utility';
    }
  } else {
    if (roll < 0.18) {
      normal = 108 + rng() * 96;
      cross = 26 + rng() * 34;
      kind = 'gallery';
    } else if (roll < 0.34) {
      normal = 34 + rng() * 44;
      cross = 100 + rng() * 96;
      kind = 'transverse-gallery';
    } else if (roll < 0.48 && depth < 5) {
      normal = 118 + rng() * 96;
      cross = 96 + rng() * 92;
      major = true;
      kind = 'hall';
    } else if (roll < 0.66) {
      normal = 38 + rng() * 54;
      cross = 34 + rng() * 58;
      kind = 'cell';
    } else {
      normal = 62 + rng() * 82;
      cross = 48 + rng() * 76;
      kind = 'room';
    }
  }

  major = major || (depth < 5 && rng() < profile.majorChance);
  normal *= profile.scale;
  cross *= profile.scale;

  if (attachSide === 0 || attachSide === 2) {
    return { w: normal, h: cross, major, kind };
  }
  return { w: cross, h: normal, major, kind };
}

function withinComplexRadius(room, anchor, maxRadius = MAX_COMPLEX_RADIUS) {
  for (const corner of roomCorners(room)) {
    if (Math.hypot(corner.x - anchor.x, corner.y - anchor.y) > maxRadius) return false;
  }
  return true;
}

function collidesWithRooms(candidate, rooms, ignoredIndex) {
  for (let i = 0; i < rooms.length; i++) {
    if (i === ignoredIndex) continue;
    if (roomsOverlap(candidate, rooms[i], 4)) return true;
  }
  return false;
}

function addRoomDetails(room, rng, profile, protectedSides = []) {
  room.partitions = [];
  room.columns = [];
  room.cutouts = [];
  room.blockedSides = [];
  room.detailStyle = 'plain';

  const protectedSet = new Set(protectedSides);
  const partitionChance = profile.partitionChance + (room.kind === 'office-suite' ? 0.20 : 0);

  if (room.major || rng() < partitionChance) {
    const maxCount = room.major ? 3 : (room.kind === 'office-suite' ? 2 : 1);
    const count = 1 + Math.floor(rng() * maxCount);
    for (let i = 0; i < count; i++) {
      room.partitions.push({
        axis: rng() < 0.5 ? 'x' : 'y',
        t: 0.18 + rng() * 0.64,
        gap: 0.15 + rng() * 0.24,
      });
    }
    room.detailStyle = 'partitioned';
  }

  const columnChance = profile.columnChance + (room.kind === 'warehouse' || room.kind === 'atrium' ? 0.18 : 0);
  if ((room.major || room.w * room.h > 12000) && rng() < columnChance) {
    const cols = Math.max(1, Math.min(5, Math.floor(room.w / 64)));
    const rows = Math.max(1, Math.min(5, Math.floor(room.h / 64)));
    for (let y = 1; y <= rows; y++) {
      for (let x = 1; x <= cols; x++) {
        if (rng() < 0.72) {
          room.columns.push({
            u: x / (cols + 1),
            v: y / (rows + 1),
            r: 2.4 + rng() * 3.2,
          });
        }
      }
    }
    room.detailStyle = room.detailStyle === 'plain' ? 'columns' : room.detailStyle;
  }

  const canCut =
    room.w > 90 &&
    room.h > 78 &&
    rng() < Math.min(0.55, profile.cutoutChance * 1.4);

  if (canCut) {
    const availableSides = [0, 1, 2, 3].filter((side) => !protectedSet.has(side));

    if (availableSides.length) {
      const primary = availableSides[Math.floor(rng() * availableSides.length)];
      const adjacent = [
        (primary + 1) % 4,
        (primary + 3) % 4,
      ].filter((side) => availableSides.includes(side));

      const makeCorner = adjacent.length > 0 && rng() < 0.42;

      if (makeCorner) {
        const secondary = adjacent[Math.floor(rng() * adjacent.length)];
        const touches = [primary, secondary];
        const cutout = {
          side: primary,
          touches,
          x: 0,
          y: 0,
          w: room.w * (0.22 + rng() * 0.18),
          h: room.h * (0.22 + rng() * 0.18),
        };

        if (touches.includes(0)) {
          cutout.x = room.w * 0.5 - cutout.w * 0.5;
        } else if (touches.includes(2)) {
          cutout.x = -room.w * 0.5 + cutout.w * 0.5;
        }

        if (touches.includes(1)) {
          cutout.y = room.h * 0.5 - cutout.h * 0.5;
        } else if (touches.includes(3)) {
          cutout.y = -room.h * 0.5 + cutout.h * 0.5;
        }

        room.cutouts.push(cutout);
        for (const side of touches) {
          if (!room.blockedSides.includes(side)) room.blockedSides.push(side);
        }
        room.detailStyle = 'corner-notched';
      } else {
        const side = primary;
        const depthFrac = 0.18 + rng() * 0.24;
        const spanFrac = 0.26 + rng() * 0.34;
        const cutout = {
          side,
          touches: [side],
          x: 0,
          y: 0,
          w: side === 0 || side === 2 ? room.w * depthFrac : room.w * spanFrac,
          h: side === 1 || side === 3 ? room.h * depthFrac : room.h * spanFrac,
        };

        if (side === 0) {
          cutout.x = room.w * 0.5 - cutout.w * 0.5;
          cutout.y = (rng() - 0.5) * Math.max(0, room.h - cutout.h) * 0.72;
        } else if (side === 2) {
          cutout.x = -room.w * 0.5 + cutout.w * 0.5;
          cutout.y = (rng() - 0.5) * Math.max(0, room.h - cutout.h) * 0.72;
        } else if (side === 1) {
          cutout.y = room.h * 0.5 - cutout.h * 0.5;
          cutout.x = (rng() - 0.5) * Math.max(0, room.w - cutout.w) * 0.72;
        } else {
          cutout.y = -room.h * 0.5 + cutout.h * 0.5;
          cutout.x = (rng() - 0.5) * Math.max(0, room.w - cutout.w) * 0.72;
        }

        room.cutouts.push(cutout);
        room.blockedSides.push(side);
        room.detailStyle = 'notched';
      }
    }
  }

  if (!room.cutouts.length && room.major && room.w > 130 && room.h > 110 && rng() < 0.16) {
    room.cutouts.push({
      side: -1,
      x: (rng() - 0.5) * room.w * 0.10,
      y: (rng() - 0.5) * room.h * 0.10,
      w: room.w * (0.18 + rng() * 0.16),
      h: room.h * (0.18 + rng() * 0.16),
    });
    room.detailStyle = 'courtyard';
  }
}

function createComplex(seed, cx, cy) {
  const anchor = anchorFor(seed, cx, cy);
  const color = choosePalette(seed, cx, cy);
  const profile = complexProfile(seed, cx, cy);
  const density = 0.82 + hash01(seed, cx, cy, 801) * 0.64;
  const rng = seededRng(hashInt(seed, cx, cy, 9001));
  const orientationStep = Math.PI / 12;
  const angle = Math.round((rng() * TAU) / orientationStep) * orientationStep;

  let rootW = 118 + rng() * 84;
  let rootH = 92 + rng() * 74;
  let rootKind = 'hub';

  if (profile.name === 'service-maze') {
    rootW = 92 + rng() * 58;
    rootH = 76 + rng() * 50;
    rootKind = 'service-hub';
  } else if (profile.name === 'galleries') {
    rootW = 154 + rng() * 94;
    rootH = 62 + rng() * 54;
    rootKind = 'gallery-hub';
  } else if (profile.name === 'atrium') {
    rootW = 150 + rng() * 100;
    rootH = 126 + rng() * 88;
    rootKind = 'atrium';
  } else if (profile.name === 'office-web') {
    rootW = 106 + rng() * 66;
    rootH = 88 + rng() * 58;
    rootKind = 'office-hub';
  } else if (profile.name === 'warehouse') {
    rootW = 172 + rng() * 96;
    rootH = 136 + rng() * 88;
    rootKind = 'warehouse';
  }

  const root = {
    id: cx + ':' + cy + ':0',
    x: anchor.x,
    y: anchor.y,
    w: rootW,
    h: rootH,
    angle,
    color,
    major: true,
    kind: rootKind,
  };
  addRoomDetails(root, rng, profile, []);

  const rooms = [root];
  const doors = [];
  const usedSides = new Set();
  const frontier = [];

  for (let side = 0; side < 4; side++) {
    if (!root.blockedSides.includes(side)) frontier.push({ roomIndex: 0, side, depth: 0, boost: 1.2 });
  }

  const targetRooms =
    profile.targetBase +
    Math.floor(rng() * profile.targetJitter) +
    Math.floor((density - 0.82) * 8);

  let attempts = 0;
  const maxAttempts = targetRooms * 24;

  while (rooms.length < targetRooms && frontier.length && attempts < maxAttempts) {
    attempts++;

    let pickIndex;
    if (rng() < 0.46) {
      let bestScore = -Infinity;
      pickIndex = 0;
      for (let i = 0; i < frontier.length; i++) {
        const front = frontier[i];
        const score =
          (front.boost || 1) * (0.65 + rng() * 0.7) -
          front.depth * 0.018;
        if (score > bestScore) {
          bestScore = score;
          pickIndex = i;
        }
      }
    } else {
      pickIndex = Math.floor(rng() * frontier.length);
    }

    const front = frontier.splice(pickIndex, 1)[0];
    const sideKey = front.roomIndex + ':' + front.side;
    if (usedSides.has(sideKey)) continue;

    const parent = rooms[front.roomIndex];
    if (parent.blockedSides.includes(front.side)) continue;

    const parentSide = sideInfo(parent, front.side);
    const incomingSide = oppositeSide(front.side);

    let child = null;
    let childCrossHalf = 0;
    let lateral = 0;

    // Dense architectural packing requires more than one proposal per wall.
    // If a large room cannot fit, progressively smaller/shifted candidates are
    // tried before the frontier is abandoned.
    for (let placementTry = 0; placementTry < 5; placementTry++) {
      const dims = roomDimensions(rng, front.side, front.depth, profile);
      const shrink = 1 - placementTry * 0.085;
      const candidate = {
        id: cx + ':' + cy + ':' + rooms.length,
        x: 0,
        y: 0,
        w: Math.max(24, dims.w * shrink),
        h: Math.max(22, dims.h * shrink),
        angle,
        color,
        major: dims.major && placementTry < 3,
        kind: dims.kind,
      };

      const childNormalHalf =
        (front.side === 0 || front.side === 2)
          ? candidate.w * 0.5
          : candidate.h * 0.5;
      const candidateCrossHalf =
        (front.side === 0 || front.side === 2)
          ? candidate.h * 0.5
          : candidate.w * 0.5;
      const overlapLimit = Math.min(parentSide.halfTangent, candidateCrossHalf);
      const offsetLimit = Math.max(0, overlapLimit * 0.72 - 7);

      const signedOffset = hashSigned(
        seed,
        cx * 997 + rooms.length + placementTry * 37,
        cy * 991 + front.roomIndex,
        front.side + 410 + placementTry * 19,
      );

      const offsetScale =
        placementTry === 0 ? 0.86 :
        placementTry === 1 ? 0.46 :
        placementTry === 2 ? 0 :
        placementTry === 3 ? 0.68 : 0.28;

      const candidateLateral = signedOffset * offsetLimit * offsetScale;

      candidate.x =
        parentSide.x +
        parentSide.normal.x * childNormalHalf +
        parentSide.tangent.x * candidateLateral;
      candidate.y =
        parentSide.y +
        parentSide.normal.y * childNormalHalf +
        parentSide.tangent.y * candidateLateral;

      if (!withinComplexRadius(candidate, anchor)) continue;
      if (collidesWithRooms(candidate, rooms, front.roomIndex)) continue;

      child = candidate;
      childCrossHalf = candidateCrossHalf;
      lateral = candidateLateral;
      break;
    }

    if (!child) continue;

    addRoomDetails(child, rng, profile, [incomingSide]);

    const childIndex = rooms.length;
    rooms.push(child);

    usedSides.add(sideKey);
    usedSides.add(childIndex + ':' + incomingSide);

    const overlapHalf = Math.min(parentSide.halfTangent, childCrossHalf);
    const fullOverlap = overlapHalf * 2;
    const openingBias =
      profile.openChance +
      (parent.major || child.major ? 0.14 : 0) +
      (parent.kind === 'gallery' || child.kind === 'gallery' ? 0.06 : 0);
    const wideOpening = rng() < Math.min(0.82, openingBias);

    const doorWidth = wideOpening
      ? Math.max(24, Math.min(118, fullOverlap * (0.56 + rng() * 0.28)))
      : Math.max(11, Math.min(42, fullOverlap * (0.26 + rng() * 0.18)));

    const doorX = parentSide.x + parentSide.tangent.x * lateral;
    const doorY = parentSide.y + parentSide.tangent.y * lateral;
    doors.push({
      x: doorX,
      y: doorY,
      angle: Math.atan2(parentSide.tangent.y, parentSide.tangent.x),
      width: doorWidth,
      color,
      kind: wideOpening ? 'opening' : 'internal',
    });

    const branchSides = [0, 1, 2, 3].filter(
      (side) =>
        side !== incomingSide &&
        !child.blockedSides.includes(side),
    );

    for (const side of branchSides) {
      const forward = side === front.side;
      const branchChance = Math.min(
        0.96,
        profile.branch * (forward ? 1.10 : 0.78) +
          (child.major ? 0.05 : 0) +
          (wideOpening ? 0.04 : 0),
      );

      if (rng() < branchChance) {
        frontier.push({
          roomIndex: childIndex,
          side,
          depth: front.depth + 1,
          boost: forward ? 1.25 : (wideOpening ? 1.12 : 1),
        });
      }
    }

    if (wideOpening && rng() < 0.58) {
      const sideA = (front.side + 1) % 4;
      const sideB = (front.side + 3) % 4;
      for (const side of [sideA, sideB]) {
        if (
          side !== incomingSide &&
          !child.blockedSides.includes(side) &&
          !usedSides.has(childIndex + ':' + side)
        ) {
          frontier.push({
            roomIndex: childIndex,
            side,
            depth: front.depth + 1,
            boost: 1.38,
          });
        }
      }
    }

    if (rng() < 0.22) {
      const parentSideCandidate = (front.side + (rng() < 0.5 ? 1 : 3)) % 4;
      if (
        !parent.blockedSides.includes(parentSideCandidate) &&
        !usedSides.has(front.roomIndex + ':' + parentSideCandidate)
      ) {
        frontier.push({
          roomIndex: front.roomIndex,
          side: parentSideCandidate,
          depth: front.depth + 1,
          boost: 1.08,
        });
      }
    }
  }

  let radius = 1;
  for (const room of rooms) {
    for (const corner of roomCorners(room)) {
      radius = Math.max(radius, Math.hypot(corner.x - anchor.x, corner.y - anchor.y));
    }
  }

  return {
    cx,
    cy,
    anchor,
    color,
    angle,
    profile: profile.name,
    rooms,
    doors,
    usedSides,
    radius: Math.min(MAX_COMPLEX_RADIUS + 4, radius + 5),
  };
}

function externalPortalCandidates(complex, target, salt) {
  const dx = target.x - complex.anchor.x;
  const dy = target.y - complex.anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const candidates = [];

  for (let roomIndex = 0; roomIndex < complex.rooms.length; roomIndex++) {
    const room = complex.rooms[roomIndex];
    for (let side = 0; side < 4; side++) {
      if (complex.usedSides.has(roomIndex + ':' + side)) continue;
      if (room.blockedSides && room.blockedSides.includes(side)) continue;
      const info = sideInfo(room, side);
      const facing = info.normal.x * tx + info.normal.y * ty;
      if (facing < 0.12) continue;

      const lateralSeed = hashSigned(salt, roomIndex, side, 991);
      const lateral = lateralSeed * Math.max(0, info.halfTangent - 15) * 0.34;
      const px = info.x + info.tangent.x * lateral;
      const py = info.y + info.tangent.y * lateral;
      const projection = (px - complex.anchor.x) * tx + (py - complex.anchor.y) * ty;
      const score = projection + facing * 86 + hash01(salt, roomIndex, side, 992) * 6;

      candidates.push({
        score,
        x: px,
        y: py,
        normal: info.normal,
        tangent: info.tangent,
        roomIndex,
        side,
        width: Math.max(14, Math.min(32, info.halfTangent * 0.62)),
        color: complex.color,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length) return candidates;

  // Relax only the facing requirement before ever reusing an occupied wall.
  const fallback = [];
  for (let roomIndex = 0; roomIndex < complex.rooms.length; roomIndex++) {
    const room = complex.rooms[roomIndex];
    for (let side = 0; side < 4; side++) {
      if (complex.usedSides.has(roomIndex + ':' + side)) continue;
      if (room.blockedSides && room.blockedSides.includes(side)) continue;
      const info = sideInfo(room, side);
      const facing = info.normal.x * tx + info.normal.y * ty;
      const projection =
        (info.x - complex.anchor.x) * tx +
        (info.y - complex.anchor.y) * ty;
      fallback.push({
        score: projection + facing * 70,
        x: info.x,
        y: info.y,
        normal: info.normal,
        tangent: info.tangent,
        roomIndex,
        side,
        width: Math.max(14, Math.min(30, info.halfTangent * 0.58)),
        color: complex.color,
      });
    }
  }

  if (fallback.length) {
    fallback.sort((a, b) => b.score - a.score);
    return fallback;
  }

  // Extremely saturated complexes may have every exterior side already used.
  // Reuse the best unblocked root side as a last-resort deterministic portal.
  const room = complex.rooms[0];
  for (let side = 0; side < 4; side++) {
    if (room.blockedSides && room.blockedSides.includes(side)) continue;
    const info = sideInfo(room, side);
    const facing = info.normal.x * tx + info.normal.y * ty;
    fallback.push({
      score: facing,
      x: info.x,
      y: info.y,
      normal: info.normal,
      tangent: info.tangent,
      roomIndex: 0,
      side,
      width: 22,
      color: complex.color,
    });
  }

  fallback.sort((a, b) => b.score - a.score);
  return fallback;
}

function pointOutsideComplex(complex, portal, clearance) {
  const vx = portal.x - complex.anchor.x;
  const vy = portal.y - complex.anchor.y;
  const targetRadius = complex.radius + clearance;
  const b = vx * portal.normal.x + vy * portal.normal.y;
  const c = vx * vx + vy * vy - targetRadius * targetRadius;
  const disc = Math.max(0, b * b - c);
  const t = Math.max(8, -b + Math.sqrt(disc) + 4);
  return {
    x: portal.x + portal.normal.x * t,
    y: portal.y + portal.normal.y * t,
  };
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

function neckClear(complex, portal, outside, width) {
  const neck = segmentRect(portal, outside, width);
  for (let i = 0; i < complex.rooms.length; i++) {
    if (i === portal.roomIndex) continue;
    if (roomsOverlap(neck, complex.rooms[i], 3)) return false;
  }
  return true;
}

function chooseClearPortal(complex, target, salt, width) {
  const candidates = externalPortalCandidates(complex, target, salt);
  const clearance = width * 0.5 + 15;

  for (const portal of candidates) {
    const outside = pointOutsideComplex(complex, portal, clearance);
    if (neckClear(complex, portal, outside, width)) return { portal, outside };
  }

  const portal = candidates[0];
  return {
    portal,
    outside: pointOutsideComplex(complex, portal, clearance),
  };
}

function segmentCircleDistanceSq(ax, ay, bx, by, cx, cy) {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const denom = abx * abx + aby * aby;
  const t = denom <= 1e-9 ? 0 : Math.max(0, Math.min(1, (acx * abx + acy * aby) / denom));
  const px = ax + abx * t;
  const py = ay + aby * t;
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy;
}

function segmentClear(a, b, obstacles) {
  for (const obstacle of obstacles) {
    if (segmentCircleDistanceSq(a.x, a.y, b.x, b.y, obstacle.x, obstacle.y) < obstacle.r * obstacle.r) {
      return false;
    }
  }
  return true;
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].f < item.f || (items[p].f === item.f && items[p].tie <= item.tie)) break;
      items[i] = items[p];
      i = p;
    }
    items[i] = item;
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const root = items[0];
    const last = items.pop();
    if (!items.length) return root;

    let i = 0;
    while (true) {
      let child = i * 2 + 1;
      if (child >= items.length) break;
      let right = child + 1;
      if (right < items.length &&
          (items[right].f < items[child].f ||
           (items[right].f === items[child].f && items[right].tie < items[child].tie))) {
        child = right;
      }
      if (items[child].f > last.f || (items[child].f === last.f && items[child].tie >= last.tie)) break;
      items[i] = items[child];
      i = child;
    }
    items[i] = last;
    return root;
  }

  get size() {
    return this.items.length;
  }
}

function gridKey(gx, gy) {
  return gx + ',' + gy;
}

function nearestClearGridPoint(point, obstacles) {
  const baseX = Math.round(point.x / ROUTE_STEP);
  const baseY = Math.round(point.y / ROUTE_STEP);

  for (let radius = 0; radius <= 4; radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (radius > 0 && Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
        const candidate = {
          gx: baseX + ox,
          gy: baseY + oy,
          x: (baseX + ox) * ROUTE_STEP,
          y: (baseY + oy) * ROUTE_STEP,
        };
        if (segmentClear(point, candidate, obstacles)) return candidate;
      }
    }
  }

  return { gx: baseX, gy: baseY, x: baseX * ROUTE_STEP, y: baseY * ROUTE_STEP };
}

function routeAStar(start, goal, obstacles, routeSeed) {
  const startGrid = nearestClearGridPoint(start, obstacles);
  const goalGrid = nearestClearGridPoint(goal, obstacles);
  const sx = startGrid.gx;
  const sy = startGrid.gy;
  const gx = goalGrid.gx;
  const gy = goalGrid.gy;
  const margin = 20;
  const minX = Math.min(sx, gx) - margin;
  const maxX = Math.max(sx, gx) + margin;
  const minY = Math.min(sy, gy) - margin;
  const maxY = Math.max(sy, gy) + margin;

  const open = new MinHeap();
  const startKey = gridKey(sx, sy);
  const gScore = new Map([[startKey, 0]]);
  const cameFrom = new Map();
  const closed = new Set();

  function world(gxValue, gyValue) {
    return { x: gxValue * ROUTE_STEP, y: gyValue * ROUTE_STEP };
  }

  function heuristic(x, y) {
    const dx = gx - x;
    const dy = gy - y;
    return Math.hypot(dx, dy);
  }

  open.push({ gx: sx, gy: sy, g: 0, f: heuristic(sx, sy), tie: hashInt(routeSeed, sx, sy, 1) });

  const neighbors = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  let iterations = 0;
  while (open.size && iterations++ < 9000) {
    const current = open.pop();
    const currentKey = gridKey(current.gx, current.gy);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    if (current.gx === gx && current.gy === gy) {
      const path = [];
      let walkKey = currentKey;
      let walk = { gx: current.gx, gy: current.gy };
      path.push(world(walk.gx, walk.gy));
      while (walkKey !== startKey) {
        const prev = cameFrom.get(walkKey);
        if (!prev) break;
        walk = prev;
        walkKey = gridKey(walk.gx, walk.gy);
        path.push(world(walk.gx, walk.gy));
      }
      path.reverse();
      return path;
    }

    const currentWorld = world(current.gx, current.gy);

    for (const [ox, oy, baseCost] of neighbors) {
      const nx = current.gx + ox;
      const ny = current.gy + oy;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nextKey = gridKey(nx, ny);
      if (closed.has(nextKey)) continue;

      const nextWorld = world(nx, ny);
      if (!segmentClear(currentWorld, nextWorld, obstacles)) continue;

      const noise = hash01(routeSeed, nx, ny, 712) * 0.045;
      const tentative = current.g + baseCost + noise;
      const previous = gScore.get(nextKey);
      if (previous !== undefined && tentative >= previous) continue;

      gScore.set(nextKey, tentative);
      cameFrom.set(nextKey, { gx: current.gx, gy: current.gy });
      const f = tentative + heuristic(nx, ny);
      open.push({ gx: nx, gy: ny, g: tentative, f, tie: hashInt(routeSeed, nx, ny, 713) });
    }
  }

  return null;
}

function simplifyPath(points) {
  if (points.length <= 2) return points.slice();
  const output = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const a = output[output.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = abx * bcy - aby * bcx;
    if (Math.abs(cross) < 0.01) continue;
    output.push(b);
  }

  output.push(points[points.length - 1]);
  return output;
}

function pathClear(path, obstacles) {
  for (let i = 0; i < path.length - 1; i++) {
    if (!segmentClear(path[i], path[i + 1], obstacles)) return false;
  }
  return true;
}

function fallbackRoute(start, goal, obstacles, routeSeed) {
  const offsets = [0.72, -0.72, 1.18, -1.18].map((v) => v * CELL_SIZE);
  if (hash01(routeSeed, 0, 0, 881) > 0.5) offsets.reverse();

  for (const offset of offsets) {
    const midY = (start.y + goal.y) * 0.5 + offset;
    const path = [start, { x: start.x, y: midY }, { x: goal.x, y: midY }, goal];
    if (pathClear(path, obstacles)) return path;
  }

  for (const offset of offsets) {
    const midX = (start.x + goal.x) * 0.5 + offset;
    const path = [start, { x: midX, y: start.y }, { x: midX, y: goal.y }, goal];
    if (pathClear(path, obstacles)) return path;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const obstacle of obstacles) {
    minX = Math.min(minX, obstacle.x - obstacle.r);
    maxX = Math.max(maxX, obstacle.x + obstacle.r);
    minY = Math.min(minY, obstacle.y - obstacle.r);
    maxY = Math.max(maxY, obstacle.y + obstacle.r);
  }

  const pad = 90;
  const outerCandidates = [
    [start, { x: start.x, y: minY - pad }, { x: goal.x, y: minY - pad }, goal],
    [start, { x: start.x, y: maxY + pad }, { x: goal.x, y: maxY + pad }, goal],
    [start, { x: minX - pad, y: start.y }, { x: minX - pad, y: goal.y }, goal],
    [start, { x: maxX + pad, y: start.y }, { x: maxX + pad, y: goal.y }, goal],
  ];

  if (hash01(routeSeed, 0, 0, 882) > 0.5) outerCandidates.reverse();
  for (const path of outerCandidates) {
    if (pathClear(path, obstacles)) return path;
  }

  return [start, goal];
}

function chamberClear(chamber, obstacles, corridorWidth) {
  const halfDiag = Math.hypot(chamber.w, chamber.h) * 0.5;
  const extra = Math.max(0, halfDiag - corridorWidth * 0.5);
  for (const obstacle of obstacles) {
    if (Math.hypot(chamber.x - obstacle.x, chamber.y - obstacle.y) < obstacle.r + extra + 5) {
      return false;
    }
  }
  return true;
}

function buildChambers(points, width, color, routeSeed, obstacles) {
  const chambers = [];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const point = points[i];
    const next = points[i + 1];
    const ax = point.x - prev.x;
    const ay = point.y - prev.y;
    const bx = next.x - point.x;
    const by = next.y - point.y;
    const lenA = Math.hypot(ax, ay) || 1;
    const lenB = Math.hypot(bx, by) || 1;
    const turn = Math.abs((ax / lenA) * (by / lenB) - (ay / lenA) * (bx / lenB));

    if (turn > 0.12 || hash01(routeSeed, i, points.length, 922) < 0.20) {
      const size = width * (1.55 + hash01(routeSeed, i, points.length, 923) * 1.45);
      const chamber = {
        x: point.x,
        y: point.y,
        w: size * (0.90 + hash01(routeSeed, i, points.length, 924) * 0.50),
        h: size * (0.78 + hash01(routeSeed, i, points.length, 925) * 0.56),
        angle: Math.atan2(by, bx),
        color,
        major: false,
        partitions: [],
        columns: [],
      };
      if (chamberClear(chamber, obstacles, width)) chambers.push(chamber);
    }
  }

  return chambers;
}

function corridorDoor(portal) {
  return {
    x: portal.x,
    y: portal.y,
    angle: Math.atan2(portal.tangent.y, portal.tangent.x),
    width: portal.width,
    color: portal.color,
    kind: 'external',
  };
}

export class InfiniteMapGenerator {
  constructor(seedText = 'backrooms-71') {
    this.complexCache = new Map();
    this.edgeCache = new Map();
    this.cellCache = new Map();
    this.frame = 0;
    this.setSeed(seedText);
  }

  setSeed(seedText) {
    this.seedText = String(seedText || 'backrooms-71');
    this.seed = hashString('v' + GENERATOR_VERSION + ':' + this.seedText);
    this.complexCache.clear();
    this.edgeCache.clear();
    this.cellCache.clear();
  }

  getComplex(cx, cy) {
    const key = keyOf(cx, cy);
    const cached = this.complexCache.get(key);
    if (cached) {
      cached.used = this.frame;
      return cached.complex;
    }

    const complex = createComplex(this.seed, cx, cy);
    this.complexCache.set(key, { complex, used: this.frame });
    return complex;
  }

  getObstacleComplexes(ax, ay, bx, by, corridorWidth) {
    const minX = Math.min(ax, bx) - 2;
    const maxX = Math.max(ax, bx) + 2;
    const minY = Math.min(ay, by) - 2;
    const maxY = Math.max(ay, by) + 2;
    const obstacles = [];

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const complex = this.getComplex(cx, cy);
        obstacles.push({
          x: complex.anchor.x,
          y: complex.anchor.y,
          r: complex.radius + corridorWidth * 0.5 + 14,
        });
      }
    }

    return obstacles;
  }

  getCorridor(ax, ay, bx, by) {
    const edgeKey = canonicalEdgeKey(ax, ay, bx, by);
    const cached = this.edgeCache.get(edgeKey);
    if (cached) {
      cached.used = this.frame;
      return cached.corridor;
    }

    const source = this.getComplex(ax, ay);
    const target = this.getComplex(bx, by);
    const routeSeed = edgeSalt(edgeKey, this.seed ^ 0x5a17c3);
    const width = 20 + (routeSeed % 15);
    const sourceExit = chooseClearPortal(source, target.anchor, routeSeed ^ 0x1122, width);
    const targetExit = chooseClearPortal(target, source.anchor, routeSeed ^ 0x3344, width);
    const sourcePortal = sourceExit.portal;
    const targetPortal = targetExit.portal;
    const sourceOutside = sourceExit.outside;
    const targetOutside = targetExit.outside;
    const obstacles = this.getObstacleComplexes(ax, ay, bx, by, width);

    const routed = routeAStar(sourceOutside, targetOutside, obstacles, routeSeed) ||
      fallbackRoute(sourceOutside, targetOutside, obstacles, routeSeed);

    const middle = simplifyPath(routed);
    const points = [sourcePortal, sourceOutside];

    for (const point of middle) {
      const last = points[points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1) points.push(point);
    }

    const lastMiddle = points[points.length - 1];
    if (Math.hypot(targetOutside.x - lastMiddle.x, targetOutside.y - lastMiddle.y) > 1) {
      points.push(targetOutside);
    }
    points.push(targetPortal);

    const color = hash01(routeSeed, 1, 2, 3) < 0.5 ? source.color : target.color;
    const corridor = {
      edgeKey,
      points,
      width,
      color,
      chambers: buildChambers(points.slice(1, -1), width, color, routeSeed, obstacles),
      doors: [corridorDoor(sourcePortal), corridorDoor(targetPortal)],
    };

    this.edgeCache.set(edgeKey, { corridor, used: this.frame });
    return corridor;
  }

  getCell(cx, cy) {
    const key = keyOf(cx, cy);
    const cached = this.cellCache.get(key);
    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }

    const complex = this.getComplex(cx, cy);
    const corridors = [];

    const parent = parentFor(this.seed, cx, cy);
    if (parent) corridors.push(this.getCorridor(cx, cy, parent[0], parent[1]));

    for (const neighbor of optionalNeighborEdges(this.seed, cx, cy)) {
      corridors.push(this.getCorridor(cx, cy, neighbor[0], neighbor[1]));
    }

    const geometry = {
      cx,
      cy,
      color: complex.color,
      rooms: complex.rooms,
      doors: complex.doors,
      corridors,
      anchor: complex.anchor,
    };

    this.cellCache.set(key, { geometry, used: this.frame });
    return geometry;
  }

  query(bounds) {
    this.frame++;
    const haloWorld = CELL_SIZE * QUERY_HALO;
    const minX = Math.floor((bounds.minX - haloWorld) / CELL_SIZE);
    const maxX = Math.floor((bounds.maxX + haloWorld) / CELL_SIZE);
    const minY = Math.floor((bounds.minY - haloWorld) / CELL_SIZE);
    const maxY = Math.floor((bounds.maxY + haloWorld) / CELL_SIZE);
    const cells = [];

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        cells.push(this.getCell(cx, cy));
      }
    }

    if (this.complexCache.size > 760) this.pruneCache(this.complexCache, 560);
    if (this.edgeCache.size > 960) this.pruneCache(this.edgeCache, 700);
    if (this.cellCache.size > 560) this.pruneCache(this.cellCache, 380);
    return cells;
  }

  pruneCache(cache, targetSize) {
    const entries = [...cache.entries()];
    entries.sort((a, b) => a[1].used - b[1].used);
    const removeCount = Math.max(0, entries.length - targetSize);
    for (let i = 0; i < removeCount; i++) cache.delete(entries[i][0]);
  }
}

export function parentCell(seedText, cx, cy) {
  const seed = hashString('v' + GENERATOR_VERSION + ':' + String(seedText));
  return parentFor(seed, cx, cy);
}
