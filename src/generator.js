export const CELL_SIZE = 900;
export const QUERY_HALO = 1;
export const GENERATOR_VERSION = 6;

const TAU = Math.PI * 2;
const SITE_GRID = 420;
const SITE_MIN_DISTANCE = 460;
const SITE_NEIGHBOR_RADIUS = 3;
const SITE_PARENT_RADIUS = 4;
const MAX_COMPLEX_RADIUS = 190;
const ROUTE_STEP = 64;
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
  // Most of the world stays in the common cream family. Rare color regions
  // are correlated over several structural cells so color does not expose the
  // indexing lattice as a checkerboard of separate islands.
  const zoneX = Math.floor(cx / 3);
  const zoneY = Math.floor(cy / 3);
  const rareZone = hash01(seed, zoneX, zoneY, 701);

  let index;
  if (rareZone < 0.11) {
    index = 5 + Math.floor(
      hash01(seed, zoneX, zoneY, 703) * (FLOOR_PALETTES.length - 5),
    );
  } else {
    index = Math.floor(hash01(seed, cx, cy, 702) * 5);
  }

  return FLOOR_PALETTES[Math.min(index, FLOOR_PALETTES.length - 1)];
}

function siteCandidate(seed, sx, sy) {
  const root = sx === 0 && sy === 0;
  const x =
    sx * SITE_GRID +
    SITE_GRID * (0.08 + hash01(seed, sx, sy, 11) * 0.84);
  const y =
    sy * SITE_GRID +
    SITE_GRID * (0.08 + hash01(seed, sx, sy, 12) * 0.84);

  return {
    sx,
    sy,
    x,
    y,
    priority: root ? 0 : hashInt(seed, sx, sy, 13),
  };
}

function anchorFor(seed, sx, sy) {
  const candidate = siteCandidate(seed, sx, sy);
  return { x: candidate.x, y: candidate.y };
}

function candidateWins(a, b) {
  if (a.priority !== b.priority) return a.priority < b.priority;
  if (a.sx !== b.sx) return a.sx < b.sx;
  return a.sy < b.sy;
}

function isAcceptedSite(seed, sx, sy) {
  const candidate = siteCandidate(seed, sx, sy);

  for (let oy = -SITE_NEIGHBOR_RADIUS; oy <= SITE_NEIGHBOR_RADIUS; oy++) {
    for (let ox = -SITE_NEIGHBOR_RADIUS; ox <= SITE_NEIGHBOR_RADIUS; ox++) {
      if (ox === 0 && oy === 0) continue;

      const other = siteCandidate(seed, sx + ox, sy + oy);
      const dx = other.x - candidate.x;
      const dy = other.y - candidate.y;

      if (dx * dx + dy * dy >= SITE_MIN_DISTANCE * SITE_MIN_DISTANCE) {
        continue;
      }

      if (candidateWins(other, candidate)) return false;
    }
  }

  return true;
}

function siteKey(sx, sy) {
  return sx + ',' + sy;
}

function siteRank(seed, sx, sy) {
  const root = siteCandidate(seed, 0, 0);
  const site = siteCandidate(seed, sx, sy);
  const dx = site.x - root.x;
  const dy = site.y - root.y;
  return dx * dx + dy * dy;
}

function acceptedSitesAround(seed, sx, sy, radius) {
  const output = [];

  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      if (ox === 0 && oy === 0) continue;
      const nx = sx + ox;
      const ny = sy + oy;
      if (!isAcceptedSite(seed, nx, ny)) continue;
      output.push([nx, ny]);
    }
  }

  return output;
}

function parentFor(seed, sx, sy) {
  if (sx === 0 && sy === 0) return null;
  if (!isAcceptedSite(seed, sx, sy)) return null;

  const current = siteCandidate(seed, sx, sy);
  const currentRank = siteRank(seed, sx, sy);
  let best = null;

  for (let radius = 1; radius <= SITE_PARENT_RADIUS; radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== radius) continue;

        const nx = sx + ox;
        const ny = sy + oy;
        if (!isAcceptedSite(seed, nx, ny)) continue;

        const rank = siteRank(seed, nx, ny);
        if (rank >= currentRank) continue;

        const other = siteCandidate(seed, nx, ny);
        const dx = other.x - current.x;
        const dy = other.y - current.y;
        const distance = Math.hypot(dx, dy);
        const score =
          distance *
          (0.92 + hash01(seed, sx * 131 + nx, sy * 137 + ny, 24) * 0.16);

        if (
          !best ||
          score < best.score ||
          (score === best.score && siteKey(nx, ny) < siteKey(best.x, best.y))
        ) {
          best = { x: nx, y: ny, score };
        }
      }
    }

    if (best && best.score < (radius + 0.35) * SITE_GRID) break;
  }

  if (best) return [best.x, best.y];

  // The forced root site is a deterministic final fallback. In the normal
  // blue-noise field a lower-rank neighbor is found long before this branch.
  return [0, 0];
}

function parentConnectionCandidates(seed, sx, sy) {
  const parent = parentFor(seed, sx, sy);
  if (!parent) return [];

  const current = siteCandidate(seed, sx, sy);
  const currentRank = siteRank(seed, sx, sy);
  const candidates = [];
  const seen = new Set();

  function add(nx, ny, preferred = false) {
    if (!isAcceptedSite(seed, nx, ny)) return;
    if (siteRank(seed, nx, ny) >= currentRank) return;

    const key = siteKey(nx, ny);
    if (seen.has(key)) return;
    seen.add(key);

    const other = siteCandidate(seed, nx, ny);
    const distance = Math.hypot(other.x - current.x, other.y - current.y);
    candidates.push({
      x: nx,
      y: ny,
      preferred,
      score:
        distance *
        (0.94 + hash01(seed, sx * 173 + nx, sy * 179 + ny, 25) * 0.12),
    });
  }

  add(parent[0], parent[1], true);

  for (const [nx, ny] of acceptedSitesAround(seed, sx, sy, 3)) {
    add(nx, ny, false);
  }

  candidates.sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    if (a.score !== b.score) return a.score - b.score;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });

  return candidates.map((candidate) => [candidate.x, candidate.y]);
}

function isTreeEdge(seed, ax, ay, bx, by) {
  const aParent = parentFor(seed, ax, ay);
  const bParent = parentFor(seed, bx, by);

  return (
    (aParent && aParent[0] === bx && aParent[1] === by) ||
    (bParent && bParent[0] === ax && bParent[1] === ay)
  );
}

function optionalNeighborEdges(seed, sx, sy) {
  const source = siteCandidate(seed, sx, sy);
  const output = [];

  for (const [nx, ny] of acceptedSitesAround(seed, sx, sy, 2)) {
    if (nx < sx || (nx === sx && ny <= sy)) continue;
    if (isTreeEdge(seed, sx, sy, nx, ny)) continue;

    const target = siteCandidate(seed, nx, ny);
    const distance = Math.hypot(target.x - source.x, target.y - source.y);
    if (distance > SITE_GRID * 2.35) continue;

    const edge = canonicalEdgeKey(sx, sy, nx, ny);
    const roll =
      ((hashString(edge) ^ seed ^ 0x37ac91) >>> 0) / 4294967296;

    const threshold =
      distance < SITE_GRID * 1.35 ? 0.24 :
      distance < SITE_GRID * 1.8 ? 0.13 : 0.055;

    if (roll < threshold) output.push([nx, ny]);
  }

  output.sort((a, b) => {
    const da = Math.hypot(
      siteCandidate(seed, a[0], a[1]).x - source.x,
      siteCandidate(seed, a[0], a[1]).y - source.y,
    );
    const db = Math.hypot(
      siteCandidate(seed, b[0], b[1]).x - source.x,
      siteCandidate(seed, b[0], b[1]).y - source.y,
    );
    return da - db;
  });

  return output.slice(0, 2);
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

function pointOutsideRoom(complex, portal, clearance) {
  // Move only far enough to clear the selected room's local footprint. This
  // avoids the old district-radius "spoke" without letting the routed center
  // line immediately clip back through the room it just exited.
  const room = complex.rooms[portal.roomIndex];
  const vx = portal.x - room.x;
  const vy = portal.y - room.y;
  const radius = Math.hypot(room.w, room.h) * 0.5 + clearance;
  const b = vx * portal.normal.x + vy * portal.normal.y;
  const c = vx * vx + vy * vy - radius * radius;
  const disc = Math.max(0, b * b - c);
  const t = Math.max(10, -b + Math.sqrt(disc) + 4);

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

function clearPortalOptions(
  complex,
  target,
  salt,
  width,
  maxOptions = 6,
  globalObstacles = null,
) {
  const candidates = externalPortalCandidates(complex, target, salt);
  const clearance = width * 0.5 + 8;
  const options = [];

  for (const portal of candidates) {
    const localOutside = pointOutsideRoom(complex, portal, clearance);
    const runway =
      62 +
      hash01(
        salt,
        portal.roomIndex,
        portal.side,
        1181,
      ) *
        42;

    const probe = {
      x: localOutside.x + portal.normal.x * runway,
      y: localOutside.y + portal.normal.y * runway,
    };

    if (!neckClear(complex, portal, probe, width)) continue;

    // The route begins at the end of this short runway. Validate the runway
    // against all nearby room obstacles so it cannot overshoot into another
    // complex before pathfinding even starts.
    if (
      globalObstacles &&
      !segmentClear(localOutside, probe, globalObstacles)
    ) {
      continue;
    }

    options.push({
      portal,
      localOutside,
      outside: probe,
    });

    if (options.length >= maxOptions) break;
  }

  if (!options.length && candidates.length) {
    const portal = candidates[0];
    const localOutside = pointOutsideRoom(
      complex,
      portal,
      clearance,
    );

    options.push({
      portal,
      localOutside,
      outside: localOutside,
    });
  }

  return options;
}

function chooseClearPortal(complex, target, salt, width) {
  return clearPortalOptions(
    complex,
    target,
    salt,
    width,
    1,
    null,
  )[0];
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

function buildBlockedGrid(obstacles, minX, maxX, minY, maxY) {
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height);

  const indexOf = (gx, gy) =>
    (gy - minY) * width + (gx - minX);

  for (const obstacle of obstacles) {
    // Inflate raster obstacles by half a grid diagonal. This guarantees that
    // a legal edge between two unblocked grid nodes cannot slice through a
    // room circle between those nodes.
    const rasterRadius = obstacle.r + ROUTE_STEP * 0.72;
    const minGX = Math.max(
      minX,
      Math.floor((obstacle.x - rasterRadius) / ROUTE_STEP),
    );
    const maxGX = Math.min(
      maxX,
      Math.ceil((obstacle.x + rasterRadius) / ROUTE_STEP),
    );
    const minGY = Math.max(
      minY,
      Math.floor((obstacle.y - rasterRadius) / ROUTE_STEP),
    );
    const maxGY = Math.min(
      maxY,
      Math.ceil((obstacle.y + rasterRadius) / ROUTE_STEP),
    );
    const r2 = rasterRadius * rasterRadius;

    for (let gy = minGY; gy <= maxGY; gy++) {
      const wy = gy * ROUTE_STEP;

      for (let gx = minGX; gx <= maxGX; gx++) {
        const wx = gx * ROUTE_STEP;
        const dx = wx - obstacle.x;
        const dy = wy - obstacle.y;

        if (dx * dx + dy * dy < r2) {
          data[indexOf(gx, gy)] = 1;
        }
      }
    }
  }

  return {
    data,
    width,
    height,
    minX,
    minY,
    maxX,
    maxY,
    indexOf,
  };
}

function gridBlocked(grid, gx, gy) {
  if (
    gx < grid.minX ||
    gx > grid.maxX ||
    gy < grid.minY ||
    gy > grid.maxY
  ) {
    return true;
  }

  return grid.data[grid.indexOf(gx, gy)] !== 0;
}

function nearestClearGridPoint(point, grid, obstacles) {
  const baseX = Math.round(point.x / ROUTE_STEP);
  const baseY = Math.round(point.y / ROUTE_STEP);

  for (let radius = 0; radius <= 5; radius++) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (
          radius > 0 &&
          Math.abs(ox) !== radius &&
          Math.abs(oy) !== radius
        ) {
          continue;
        }

        const gx = baseX + ox;
        const gy = baseY + oy;

        if (gridBlocked(grid, gx, gy)) continue;

        const candidate = {
          gx,
          gy,
          x: gx * ROUTE_STEP,
          y: gy * ROUTE_STEP,
        };

        // Only a handful of candidates are examined here, so retain the exact
        // segment test for the short lead-in from the portal to the route grid.
        if (segmentClear(point, candidate, obstacles)) return candidate;
      }
    }
  }

  return {
    gx: baseX,
    gy: baseY,
    x: baseX * ROUTE_STEP,
    y: baseY * ROUTE_STEP,
  };
}

function routeAStar(start, goal, obstacles, routeSeed) {
  const rawSX = Math.round(start.x / ROUTE_STEP);
  const rawSY = Math.round(start.y / ROUTE_STEP);
  const rawGX = Math.round(goal.x / ROUTE_STEP);
  const rawGY = Math.round(goal.y / ROUTE_STEP);
  const margin = 16;

  const minX = Math.min(rawSX, rawGX) - margin;
  const maxX = Math.max(rawSX, rawGX) + margin;
  const minY = Math.min(rawSY, rawGY) - margin;
  const maxY = Math.max(rawSY, rawGY) + margin;
  const grid = buildBlockedGrid(obstacles, minX, maxX, minY, maxY);

  const startGrid = nearestClearGridPoint(start, grid, obstacles);
  const goalGrid = nearestClearGridPoint(goal, grid, obstacles);

  const sx = startGrid.gx;
  const sy = startGrid.gy;
  const gx = goalGrid.gx;
  const gy = goalGrid.gy;

  if (gridBlocked(grid, sx, sy) || gridBlocked(grid, gx, gy)) {
    return null;
  }

  const totalNodes = grid.width * grid.height;
  const gScore = new Float64Array(totalNodes);
  gScore.fill(Infinity);

  const cameFrom = new Int32Array(totalNodes);
  cameFrom.fill(-1);

  const closed = new Uint8Array(totalNodes);
  const open = new MinHeap();

  const startIndex = grid.indexOf(sx, sy);
  const goalIndex = grid.indexOf(gx, gy);
  gScore[startIndex] = 0;

  function world(gxValue, gyValue) {
    return {
      x: gxValue * ROUTE_STEP,
      y: gyValue * ROUTE_STEP,
    };
  }

  function heuristic(x, y) {
    const dx = gx - x;
    const dy = gy - y;
    return Math.hypot(dx, dy);
  }

  open.push({
    gx: sx,
    gy: sy,
    index: startIndex,
    g: 0,
    f: heuristic(sx, sy),
    tie: hashInt(routeSeed, sx, sy, 1),
  });

  const neighbors = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];

  let iterations = 0;

  while (open.size && iterations++ < 9000) {
    const current = open.pop();

    if (closed[current.index]) continue;
    closed[current.index] = 1;

    if (current.index === goalIndex) {
      const path = [];
      let walkIndex = goalIndex;

      while (walkIndex !== -1) {
        const localX = walkIndex % grid.width;
        const localY = Math.floor(walkIndex / grid.width);
        const walkGX = grid.minX + localX;
        const walkGY = grid.minY + localY;

        path.push(world(walkGX, walkGY));

        if (walkIndex === startIndex) break;
        walkIndex = cameFrom[walkIndex];
      }

      path.reverse();
      return path;
    }

    for (const [ox, oy, baseCost] of neighbors) {
      const nx = current.gx + ox;
      const ny = current.gy + oy;

      if (gridBlocked(grid, nx, ny)) continue;

      const nextIndex = grid.indexOf(nx, ny);
      if (closed[nextIndex]) continue;

      // Prevent diagonal corner cutting through a blocked room footprint.
      if (
        ox !== 0 &&
        oy !== 0 &&
        (
          gridBlocked(grid, current.gx + ox, current.gy) ||
          gridBlocked(grid, current.gx, current.gy + oy)
        )
      ) {
        continue;
      }

      const noise = hash01(routeSeed, nx, ny, 712) * 0.045;
      const tentative = current.g + baseCost + noise;

      if (tentative >= gScore[nextIndex]) continue;

      gScore[nextIndex] = tentative;
      cameFrom[nextIndex] = current.index;

      open.push({
        gx: nx,
        gy: ny,
        index: nextIndex,
        g: tentative,
        f: tentative + heuristic(nx, ny),
        tie: hashInt(routeSeed, nx, ny, 713),
      });
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

  return null;
}

function firstSegmentIntersection(a, b, obstacles) {
  for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
    const obstacle = obstacles[obstacleIndex];

    if (
      segmentCircleDistanceSq(
        a.x,
        a.y,
        b.x,
        b.y,
        obstacle.x,
        obstacle.y,
      ) < obstacle.r * obstacle.r
    ) {
      return { obstacleIndex, obstacle };
    }
  }

  return null;
}

function localDetourScore(points, obstacles, ignoredObstacleIndex) {
  let score = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
      if (obstacleIndex === ignoredObstacleIndex) continue;

      const obstacle = obstacles[obstacleIndex];

      if (
        segmentCircleDistanceSq(
          a.x,
          a.y,
          b.x,
          b.y,
          obstacle.x,
          obstacle.y,
        ) < obstacle.r * obstacle.r
      ) {
        score += 1;
      }
    }
  }

  return score;
}

function detourAroundObstacles(start, goal, obstacles, routeSeed) {
  const output = [start];
  const stack = [{ a: start, b: goal, depth: 0, salt: 0 }];
  let guard = 0;

  while (stack.length && guard++ < 420) {
    const segment = stack.pop();
    const hit = firstSegmentIntersection(segment.a, segment.b, obstacles);

    if (!hit) {
      const last = output[output.length - 1];
      if (Math.hypot(segment.b.x - last.x, segment.b.y - last.y) > 1) {
        output.push(segment.b);
      }
      continue;
    }

    if (segment.depth >= 16) return null;

    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const depthScale = 1 + segment.depth * 0.08;
    const clearance =
      (hit.obstacle.r + ROUTE_STEP * 0.92) * depthScale;
    const tangentReach = clearance * 1.16;

    const candidates = [];

    for (const side of [-1, 1]) {
      const before = {
        x:
          hit.obstacle.x -
          ux * tangentReach +
          px * clearance * side,
        y:
          hit.obstacle.y -
          uy * tangentReach +
          py * clearance * side,
      };

      const after = {
        x:
          hit.obstacle.x +
          ux * tangentReach +
          px * clearance * side,
        y:
          hit.obstacle.y +
          uy * tangentReach +
          py * clearance * side,
      };

      const points = [segment.a, before, after, segment.b];

      candidates.push({
        before,
        after,
        score: localDetourScore(
          points,
          obstacles,
          hit.obstacleIndex,
        ),
        tie: hashInt(
          routeSeed,
          segment.depth * 97 + segment.salt,
          hit.obstacleIndex,
          side < 0 ? 1701 : 1702,
        ),
      });
    }

    candidates.sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.tie - right.tie;
    });

    const chosen = candidates[0];
    const nextDepth = segment.depth + 1;
    const nextSalt = segment.salt + 1;

    // Stack is LIFO, so push the three replacement segments in reverse order.
    stack.push({
      a: chosen.after,
      b: segment.b,
      depth: nextDepth,
      salt: nextSalt + 2,
    });
    stack.push({
      a: chosen.before,
      b: chosen.after,
      depth: nextDepth,
      salt: nextSalt + 1,
    });
    stack.push({
      a: segment.a,
      b: chosen.before,
      depth: nextDepth,
      salt: nextSalt,
    });
  }

  if (stack.length) return null;

  const simplified = simplifyPath(output);
  return pathClear(simplified, obstacles) ? simplified : null;
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

function organicizeRoute(points, obstacles, routeSeed) {
  if (points.length < 2) return points.slice();

  const output = [{ ...points[0] }];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);

    if (len < 150) {
      output.push({ ...b });
      continue;
    }

    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const bends = Math.max(1, Math.min(3, Math.floor(len / 230)));
    const candidate = [{ ...a }];

    let previousOffset = 0;

    for (let bend = 1; bend <= bends; bend++) {
      const t = bend / (bends + 1);
      const envelope = Math.sin(Math.PI * t);
      const rawOffset =
        hashSigned(
          routeSeed,
          i * 31 + bend,
          points.length,
          1901,
        ) *
        Math.min(82, len * 0.13) *
        envelope;

      const offset = previousOffset * 0.28 + rawOffset * 0.72;
      previousOffset = offset;

      const tangentJitter =
        hashSigned(
          routeSeed,
          i * 37 + bend,
          points.length,
          1902,
        ) *
        Math.min(34, len * 0.045);

      candidate.push({
        x: a.x + dx * t + nx * offset + ux * tangentJitter,
        y: a.y + dy * t + ny * offset + uy * tangentJitter,
      });
    }

    candidate.push({ ...b });

    if (pathClear(candidate, obstacles)) {
      for (let p = 1; p < candidate.length; p++) {
        output.push(candidate[p]);
      }
    } else {
      output.push({ ...b });
    }
  }

  return simplifyPath(output);
}

function appendSegmentedPoint(output, point, maxStep = 78) {
  const last = output[output.length - 1];
  if (!last) {
    output.push({ ...point });
    return;
  }

  const dx = point.x - last.x;
  const dy = point.y - last.y;
  const len = Math.hypot(dx, dy);

  if (len <= 1) return;

  const pieces = Math.max(1, Math.ceil(len / maxStep));

  for (let i = 1; i <= pieces; i++) {
    const t = i / pieces;
    output.push({
      x: last.x + dx * t,
      y: last.y + dy * t,
    });
  }
}

function resamplePath(points, maxStep, routeSeed) {
  if (!points.length) return [];
  const output = [{ ...points[0] }];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-6) continue;

    const localStep = Math.max(
      58,
      maxStep * (0.84 + hash01(routeSeed, i, points.length, 1401) * 0.24),
    );
    const pieces = Math.max(1, Math.ceil(len / localStep));

    for (let j = 1; j <= pieces; j++) {
      const t = j / pieces;
      output.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
      });
    }
  }

  return output;
}

function fabricRoomClear(room, obstacles, accepted, corridorWidth, ignoreIndex = -1) {
  if (!chamberClear(room, obstacles, corridorWidth)) return false;

  for (let i = 0; i < accepted.length; i++) {
    if (i === ignoreIndex) continue;
    if (roomsOverlap(room, accepted[i], 2)) return false;
  }

  return true;
}

function connectionRoomDetails(room, routeSeed, index) {
  room.partitions = [];
  room.columns = [];
  room.cutouts = [];
  room.blockedSides = [];
  room.detailStyle = 'connection';

  const rng = seededRng(hashInt(routeSeed, index, Math.round(room.w + room.h), 1501));

  if (room.major || rng() < 0.38) {
    const count = room.major ? 1 + Math.floor(rng() * 2) : 1;
    for (let i = 0; i < count; i++) {
      room.partitions.push({
        axis: rng() < 0.5 ? 'x' : 'y',
        t: 0.24 + rng() * 0.52,
        gap: 0.22 + rng() * 0.20,
      });
    }
  }

  if (room.major && rng() < 0.36) {
    const cols = Math.max(1, Math.min(3, Math.floor(room.w / 62)));
    const rows = Math.max(1, Math.min(3, Math.floor(room.h / 62)));
    for (let y = 1; y <= rows; y++) {
      for (let x = 1; x <= cols; x++) {
        if (rng() < 0.70) {
          room.columns.push({
            u: x / (cols + 1),
            v: y / (rows + 1),
            r: 2.5 + rng() * 2.5,
          });
        }
      }
    }
  }
}

function buildConnectionFabric(points, width, color, routeSeed, obstacles) {
  const spine = resamplePath(points, 92, routeSeed);
  const chambers = [];
  const fabricDoors = [];

  if (spine.length < 3) {
    return { spine, chambers, fabricDoors };
  }

  for (let i = 1; i < spine.length - 1; i++) {
    const prev = spine[i - 1];
    const point = spine[i];
    const next = spine[i + 1];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x);
    const rng = seededRng(hashInt(routeSeed, i, spine.length, 1601));

    const major = i % 4 === 0 || rng() < 0.18;
    const along = major
      ? 88 + rng() * 54
      : 54 + rng() * 42;
    const cross = major
      ? 64 + rng() * 58
      : 42 + rng() * 42;

    let chamber = {
      id: 'fabric:' + routeSeed + ':' + i,
      x: point.x,
      y: point.y,
      w: along,
      h: cross,
      angle,
      color,
      major,
      kind: major ? 'waystation' : (rng() < 0.45 ? 'connector-room' : 'hall-room'),
    };

    connectionRoomDetails(chamber, routeSeed, i);

    if (!fabricRoomClear(chamber, obstacles, chambers, width)) {
      // Do not allow a rejected large room to turn this section back into a
      // featureless hallway. Try smaller architectural waypoints before
      // leaving the route bare.
      let fallback = null;

      for (let retry = 1; retry <= 3; retry++) {
        const scale = 1 - retry * 0.16;
        const shifted = (retry - 2) * width * 0.30;
        const nx = -Math.sin(angle);
        const ny = Math.cos(angle);

        const candidate = {
          id: 'fabric:' + routeSeed + ':' + i + ':fallback:' + retry,
          x: point.x + nx * shifted,
          y: point.y + ny * shifted,
          w: Math.max(34, along * scale),
          h: Math.max(width * 1.55, cross * scale),
          angle,
          color,
          major: false,
          kind: retry === 3 ? 'passage-room' : 'connector-room',
        };

        connectionRoomDetails(
          candidate,
          routeSeed ^ (0x7100 + retry),
          i * 7 + retry,
        );

        if (fabricRoomClear(candidate, obstacles, chambers, width)) {
          fallback = candidate;
          break;
        }
      }

      if (!fallback) continue;
      chamber = fallback;
    }

    const chamberIndex = chambers.length;
    chambers.push(chamber);

    // Side accretion makes the connection itself architectural. A hidden graph
    // edge becomes a chain of rooms and branches rather than a long empty road.
    const annexCount =
      major ? 1 + (rng() < 0.42 ? 1 : 0) :
      (rng() < 0.44 ? 1 : 0);

    for (let a = 0; a < annexCount; a++) {
      const side = (rng() < 0.5 ? -1 : 1) * (a % 2 === 0 ? 1 : -1);
      const normal = {
        x: -Math.sin(angle) * side,
        y: Math.cos(angle) * side,
      };
      const tangent = {
        x: Math.cos(angle),
        y: Math.sin(angle),
      };

      const annexW = 38 + rng() * (major ? 62 : 42);
      const annexH = 34 + rng() * (major ? 58 : 38);
      const tangentOffset = (rng() - 0.5) * Math.max(0, chamber.w - annexW) * 0.42;
      const distance = chamber.h * 0.5 + annexH * 0.5;

      const annex = {
        id: chamber.id + ':annex:' + a,
        x: chamber.x + normal.x * distance + tangent.x * tangentOffset,
        y: chamber.y + normal.y * distance + tangent.y * tangentOffset,
        w: annexW,
        h: annexH,
        angle,
        color,
        major: false,
        kind: rng() < 0.5 ? 'annex' : 'side-room',
      };

      connectionRoomDetails(annex, routeSeed ^ 0x2f3a1, i * 5 + a);

      if (!fabricRoomClear(annex, obstacles, chambers, width, chamberIndex)) continue;

      chambers.push(annex);
      const wallX = chamber.x + normal.x * chamber.h * 0.5 + tangent.x * tangentOffset;
      const wallY = chamber.y + normal.y * chamber.h * 0.5 + tangent.y * tangentOffset;

      fabricDoors.push({
        x: wallX,
        y: wallY,
        angle,
        width: Math.max(14, Math.min(34, annexW * 0.52)),
        color,
        kind: rng() < 0.38 ? 'opening' : 'internal',
      });

      // Some side rooms continue for one more generation. These short branch
      // chains fill lateral voids and stop the connection fabric from reading
      // as a simple necklace along one center line.
      if (rng() < (major ? 0.48 : 0.24)) {
        const branchW = 34 + rng() * 54;
        const branchH = 30 + rng() * 50;
        const branchTurn = rng() < 0.34;
        const branchTurnSign = rng() < 0.5 ? -1 : 1;
        const branchNormal = branchTurn
          ? {
              x: tangent.x * branchTurnSign,
              y: tangent.y * branchTurnSign,
            }
          : normal;
        const branchTangent = {
          x: -branchNormal.y,
          y: branchNormal.x,
        };

        const branchParentHalf = branchTurn
          ? annex.w * 0.5
          : annex.h * 0.5;
        const branchChildHalf = branchTurn
          ? branchW * 0.5
          : branchH * 0.5;
        const branchOffset =
          (rng() - 0.5) *
          Math.max(0, (branchTurn ? annex.h : annex.w) - (branchTurn ? branchH : branchW)) *
          0.34;

        const branch = {
          id: annex.id + ':branch',
          x:
            annex.x +
            branchNormal.x * (branchParentHalf + branchChildHalf) +
            branchTangent.x * branchOffset,
          y:
            annex.y +
            branchNormal.y * (branchParentHalf + branchChildHalf) +
            branchTangent.y * branchOffset,
          w: branchW,
          h: branchH,
          angle: branchTurn ? angle + Math.PI / 2 : angle,
          color,
          major: false,
          kind: rng() < 0.5 ? 'branch-room' : 'alcove',
        };

        connectionRoomDetails(
          branch,
          routeSeed ^ 0x61a7d,
          i * 11 + a,
        );

        const annexIndex = chambers.length - 1;

        if (
          fabricRoomClear(
            branch,
            obstacles,
            chambers,
            width,
            annexIndex,
          )
        ) {
          chambers.push(branch);

          const branchWallX =
            annex.x +
            branchNormal.x * branchParentHalf +
            branchTangent.x * branchOffset;
          const branchWallY =
            annex.y +
            branchNormal.y * branchParentHalf +
            branchTangent.y * branchOffset;

          fabricDoors.push({
            x: branchWallX,
            y: branchWallY,
            angle: Math.atan2(
              branchTangent.y,
              branchTangent.x,
            ),
            width: Math.max(
              12,
              Math.min(
                30,
                (branchTurn ? branchH : branchW) * 0.48,
              ),
            ),
            color,
            kind: rng() < 0.30 ? 'opening' : 'internal',
          });
        }
      }
    }
  }

  return { spine, chambers, fabricDoors };
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

function findSafeRoute(start, goal, obstacles, routeSeed) {
  // Most neighboring growth regions can connect without a full graph search.
  // Prefer cheap deterministic visibility/dogleg routes and reserve A* for
  // genuinely blocked dense pockets.
  const direct = [start, goal];
  if (pathClear(direct, obstacles)) return direct;

  const dogleg = fallbackRoute(start, goal, obstacles, routeSeed);
  if (dogleg) return dogleg;

  const gridRoute = routeAStar(start, goal, obstacles, routeSeed);
  if (gridRoute) {
    const candidate = [start];

    for (const point of gridRoute) {
      const last = candidate[candidate.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1) {
        candidate.push(point);
      }
    }

    const last = candidate[candidate.length - 1];
    if (Math.hypot(goal.x - last.x, goal.y - last.y) > 1) {
      candidate.push(goal);
    }

    if (pathClear(candidate, obstacles)) return candidate;
  }

  return detourAroundObstacles(start, goal, obstacles, routeSeed);
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
    if (!isAcceptedSite(this.seed, cx, cy)) return null;

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

  getObstacleRooms(ax, ay, bx, by, corridorWidth) {
    const minX = Math.min(ax, bx) - 1;
    const maxX = Math.max(ax, bx) + 1;
    const minY = Math.min(ay, by) - 1;
    const maxY = Math.max(ay, by) + 1;
    const obstacles = [];

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const complex = this.getComplex(cx, cy);
        if (!complex) continue;

        // Routing sees actual room-scale occupied space from the irregular
        // growth field, never a regular structural-cell exclusion zone.
        for (const room of complex.rooms) {
          obstacles.push({
            x: room.x,
            y: room.y,
            r:
              Math.hypot(room.w, room.h) * 0.5 +
              corridorWidth * 0.5 +
              7,
          });
        }
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

    // Hall links are intentionally narrow. The connection gains visual mass
    // from rooms, junctions, and annexes placed every short distance.
    const width = 16 + (routeSeed % 11);
    const obstacles = this.getObstacleRooms(ax, ay, bx, by, width);

    const sourceOptions = clearPortalOptions(
      source,
      target.anchor,
      routeSeed ^ 0x1122,
      width,
      12,
      obstacles,
    );
    const targetOptions = clearPortalOptions(
      target,
      source.anchor,
      routeSeed ^ 0x3344,
      width,
      12,
      obstacles,
    );

    const combinations = [];
    for (let sourceIndex = 0; sourceIndex < sourceOptions.length; sourceIndex++) {
      for (let targetIndex = 0; targetIndex < targetOptions.length; targetIndex++) {
        combinations.push({
          sourceIndex,
          targetIndex,
          rank:
            sourceIndex +
            targetIndex +
            hash01(
              routeSeed,
              sourceIndex,
              targetIndex,
              1821,
            ) * 0.15,
        });
      }
    }

    combinations.sort((left, right) => left.rank - right.rank);

    let chosen = null;

    for (const combination of combinations) {
      const sourceExit = sourceOptions[combination.sourceIndex];
      const targetExit = targetOptions[combination.targetIndex];
      const attemptSeed =
        routeSeed ^
        hashInt(
          routeSeed,
          combination.sourceIndex,
          combination.targetIndex,
          1822,
        );

      const routed = findSafeRoute(
        sourceExit.outside,
        targetExit.outside,
        obstacles,
        attemptSeed,
      );

      if (!routed) continue;

      chosen = {
        sourceExit,
        targetExit,
        routed,
        attemptSeed,
      };
      break;
    }

    if (!chosen) {
      this.edgeCache.set(edgeKey, {
        corridor: null,
        used: this.frame,
      });
      return null;
    }

    const sourcePortal = chosen.sourceExit.portal;
    const targetPortal = chosen.targetExit.portal;
    const simplified = simplifyPath(chosen.routed);
    const organicRoute = organicizeRoute(
      simplified,
      obstacles,
      chosen.attemptSeed,
    );
    const color =
      hash01(routeSeed, 1, 2, 3) < 0.56
        ? source.color
        : target.color;

    const fabric = buildConnectionFabric(
      organicRoute,
      width,
      color,
      chosen.attemptSeed,
      obstacles,
    );

    const points = [{ x: sourcePortal.x, y: sourcePortal.y }];

    appendSegmentedPoint(
      points,
      chosen.sourceExit.localOutside,
      72,
    );

    for (const point of fabric.spine) {
      appendSegmentedPoint(points, point, 84);
    }

    appendSegmentedPoint(
      points,
      chosen.targetExit.localOutside,
      72,
    );
    appendSegmentedPoint(
      points,
      { x: targetPortal.x, y: targetPortal.y },
      72,
    );

    const corridor = {
      edgeKey,
      points,
      width,
      color,
      chambers: fabric.chambers,
      fabricDoors: fabric.fabricDoors,
      doors: [corridorDoor(sourcePortal), corridorDoor(targetPortal)],
    };

    this.edgeCache.set(edgeKey, { corridor, used: this.frame });
    return corridor;
  }

  getCell(cx, cy) {
    if (!isAcceptedSite(this.seed, cx, cy)) return null;

    const key = keyOf(cx, cy);
    const cached = this.cellCache.get(key);
    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }

    const complex = this.getComplex(cx, cy);
    if (!complex) return null;

    const corridors = [];

    const parentCandidates = parentConnectionCandidates(
      this.seed,
      cx,
      cy,
    );

    if (parentCandidates.length) {
      let parentCorridor = null;

      for (const parent of parentCandidates) {
        parentCorridor = this.getCorridor(
          cx,
          cy,
          parent[0],
          parent[1],
        );

        if (parentCorridor) break;
      }

      if (!parentCorridor) {
        throw new Error(
          'Unable to connect growth site ' +
            cx +
            ',' +
            cy +
            ' toward root',
        );
      }

      corridors.push(parentCorridor);
    }

    for (const neighbor of optionalNeighborEdges(this.seed, cx, cy)) {
      const corridor = this.getCorridor(
        cx,
        cy,
        neighbor[0],
        neighbor[1],
      );

      if (corridor) corridors.push(corridor);
    }

    const geometry = {
      cx,
      cy,
      siteId: siteKey(cx, cy),
      color: complex.color,
      rooms: complex.rooms,
      doors: complex.doors,
      corridors,
      anchor: complex.anchor,
      parent: parentFor(this.seed, cx, cy),
    };

    this.cellCache.set(key, { geometry, used: this.frame });
    return geometry;
  }

  query(bounds) {
    this.frame++;

    // CELL_SIZE now controls only the query/cache halo. Architectural sources
    // come from the independent blue-noise site field.
    const haloWorld = CELL_SIZE * QUERY_HALO;
    const minX = Math.floor((bounds.minX - haloWorld) / SITE_GRID) - 1;
    const maxX = Math.floor((bounds.maxX + haloWorld) / SITE_GRID) + 1;
    const minY = Math.floor((bounds.minY - haloWorld) / SITE_GRID) - 1;
    const maxY = Math.floor((bounds.maxY + haloWorld) / SITE_GRID) + 1;
    const cells = [];

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (!isAcceptedSite(this.seed, cx, cy)) continue;
        const geometry = this.getCell(cx, cy);
        if (geometry) cells.push(geometry);
      }
    }

    cells.sort((a, b) => {
      if (a.cx !== b.cx) return a.cx - b.cx;
      return a.cy - b.cy;
    });

    if (this.complexCache.size > 620) this.pruneCache(this.complexCache, 440);
    if (this.edgeCache.size > 900) this.pruneCache(this.edgeCache, 640);
    if (this.cellCache.size > 520) this.pruneCache(this.cellCache, 360);
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

export function isSiteCell(seedText, cx, cy) {
  const seed = hashString('v' + GENERATOR_VERSION + ':' + String(seedText));
  return isAcceptedSite(seed, cx, cy);
}

export function sitePosition(seedText, cx, cy) {
  const seed = hashString('v' + GENERATOR_VERSION + ':' + String(seedText));
  return anchorFor(seed, cx, cy);
}
