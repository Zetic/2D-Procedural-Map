export const CELL_SIZE = 900;
export const QUERY_HALO = 2;
export const GENERATOR_VERSION = 3;

const TAU = Math.PI * 2;
const MAX_COMPLEX_RADIUS = 252;
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
  const jitter = CELL_SIZE * 0.145;
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

function roomDimensions(rng, attachSide, depth) {
  const roll = rng();
  let normal;
  let cross;
  let major = false;

  if (roll < 0.15) {
    normal = 96 + rng() * 78;
    cross = 26 + rng() * 24;
  } else if (roll < 0.30) {
    normal = 34 + rng() * 42;
    cross = 92 + rng() * 92;
  } else if (roll < 0.42 && depth < 4) {
    normal = 104 + rng() * 82;
    cross = 92 + rng() * 92;
    major = true;
  } else if (roll < 0.58) {
    normal = 42 + rng() * 48;
    cross = 38 + rng() * 56;
  } else {
    normal = 58 + rng() * 70;
    cross = 48 + rng() * 70;
  }

  if (attachSide === 0 || attachSide === 2) {
    return { w: normal, h: cross, major };
  }
  return { w: cross, h: normal, major };
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

function addPartitions(room, rng) {
  room.partitions = [];
  room.columns = [];

  if (room.major || rng() < 0.30) {
    const count = room.major ? 1 + Math.floor(rng() * 3) : 1;
    for (let i = 0; i < count; i++) {
      room.partitions.push({
        axis: rng() < 0.5 ? 'x' : 'y',
        t: 0.22 + rng() * 0.56,
        gap: 0.18 + rng() * 0.22,
      });
    }
  }

  if (room.major && rng() < 0.65) {
    const cols = Math.max(1, Math.min(4, Math.floor(room.w / 72)));
    const rows = Math.max(1, Math.min(4, Math.floor(room.h / 72)));
    for (let y = 1; y <= rows; y++) {
      for (let x = 1; x <= cols; x++) {
        if (rng() < 0.72) {
          room.columns.push({
            u: x / (cols + 1),
            v: y / (rows + 1),
            r: 2.4 + rng() * 2.8,
          });
        }
      }
    }
  }
}

function createComplex(seed, cx, cy) {
  const anchor = anchorFor(seed, cx, cy);
  const color = choosePalette(seed, cx, cy);
  const density = 0.72 + hash01(seed, cx, cy, 801) * 0.56;
  const rng = seededRng(hashInt(seed, cx, cy, 9001));
  const orientationStep = Math.PI / 12;
  const angle = Math.round((rng() * TAU) / orientationStep) * orientationStep;

  const root = {
    id: cx + ':' + cy + ':0',
    x: anchor.x,
    y: anchor.y,
    w: 112 + rng() * 86,
    h: 86 + rng() * 72,
    angle,
    color,
    major: true,
  };
  addPartitions(root, rng);

  const rooms = [root];
  const doors = [];
  const usedSides = new Set();
  const frontier = [];
  for (let side = 0; side < 4; side++) frontier.push({ roomIndex: 0, side, depth: 0 });

  const targetRooms = 10 + Math.floor(rng() * 8 + density * 5);
  let attempts = 0;

  while (rooms.length < targetRooms && frontier.length && attempts < targetRooms * 14) {
    attempts++;
    const pickIndex = Math.floor(rng() * frontier.length);
    const front = frontier.splice(pickIndex, 1)[0];
    const sideKey = front.roomIndex + ':' + front.side;
    if (usedSides.has(sideKey)) continue;

    const parent = rooms[front.roomIndex];
    const parentSide = sideInfo(parent, front.side);
    const dims = roomDimensions(rng, front.side, front.depth);
    const child = {
      id: cx + ':' + cy + ':' + rooms.length,
      x: 0,
      y: 0,
      w: dims.w,
      h: dims.h,
      angle,
      color,
      major: dims.major,
    };

    const childNormalHalf = (front.side === 0 || front.side === 2) ? child.w * 0.5 : child.h * 0.5;
    const childCrossHalf = (front.side === 0 || front.side === 2) ? child.h * 0.5 : child.w * 0.5;
    const offsetLimit = Math.max(0, Math.min(parentSide.halfTangent, childCrossHalf) * 0.38 - 7);
    const lateral = hashSigned(seed, cx * 997 + rooms.length, cy * 991 + front.roomIndex, front.side + 410) * offsetLimit;

    child.x = parentSide.x + parentSide.normal.x * childNormalHalf + parentSide.tangent.x * lateral;
    child.y = parentSide.y + parentSide.normal.y * childNormalHalf + parentSide.tangent.y * lateral;

    if (!withinComplexRadius(child, anchor)) continue;
    if (collidesWithRooms(child, rooms, front.roomIndex)) continue;

    addPartitions(child, rng);
    const childIndex = rooms.length;
    rooms.push(child);

    usedSides.add(sideKey);
    usedSides.add(childIndex + ':' + oppositeSide(front.side));

    const overlapHalf = Math.min(parentSide.halfTangent, childCrossHalf);
    const doorWidth = Math.max(12, Math.min(36, overlapHalf * 0.80));
    const doorX = parentSide.x + parentSide.tangent.x * lateral;
    const doorY = parentSide.y + parentSide.tangent.y * lateral;
    doors.push({
      x: doorX,
      y: doorY,
      angle: Math.atan2(parentSide.tangent.y, parentSide.tangent.x),
      width: doorWidth,
      color,
      kind: 'internal',
    });

    const branchSides = [0, 1, 2, 3].filter((side) => side !== oppositeSide(front.side));
    for (const side of branchSides) {
      const branchChance = side === front.side ? 0.92 : 0.58 + density * 0.10;
      if (rng() < branchChance) frontier.push({ roomIndex: childIndex, side, depth: front.depth + 1 });
    }

    if (rng() < 0.16 && !usedSides.has(front.roomIndex + ':' + ((front.side + 1) % 4))) {
      frontier.push({ roomIndex: front.roomIndex, side: (front.side + 1) % 4, depth: front.depth + 1 });
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
    rooms,
    doors,
    usedSides,
    radius: Math.min(MAX_COMPLEX_RADIUS + 4, radius + 5),
  };
}

function chooseExternalPortal(complex, target, salt) {
  const dx = target.x - complex.anchor.x;
  const dy = target.y - complex.anchor.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  let best = null;

  for (let roomIndex = 0; roomIndex < complex.rooms.length; roomIndex++) {
    const room = complex.rooms[roomIndex];
    for (let side = 0; side < 4; side++) {
      if (complex.usedSides.has(roomIndex + ':' + side)) continue;
      const info = sideInfo(room, side);
      const facing = info.normal.x * tx + info.normal.y * ty;
      if (facing < 0.18) continue;

      const lateralSeed = hashSigned(salt, roomIndex, side, 991);
      const lateral = lateralSeed * Math.max(0, info.halfTangent - 15) * 0.36;
      const px = info.x + info.tangent.x * lateral;
      const py = info.y + info.tangent.y * lateral;
      const projection = (px - complex.anchor.x) * tx + (py - complex.anchor.y) * ty;
      const score = projection + facing * 84 + hash01(salt, roomIndex, side, 992) * 6;

      if (!best || score > best.score) {
        best = {
          score,
          x: px,
          y: py,
          normal: info.normal,
          tangent: info.tangent,
          roomIndex,
          side,
          width: Math.max(14, Math.min(32, info.halfTangent * 0.62)),
          color: complex.color,
        };
      }
    }
  }

  if (best) return best;

  const room = complex.rooms[0];
  let fallback = sideInfo(room, 0);
  let fallbackDot = -Infinity;
  for (let side = 0; side < 4; side++) {
    const info = sideInfo(room, side);
    const facing = info.normal.x * tx + info.normal.y * ty;
    if (facing > fallbackDot) {
      fallbackDot = facing;
      fallback = info;
    }
  }

  return {
    x: fallback.x,
    y: fallback.y,
    normal: fallback.normal,
    tangent: fallback.tangent,
    roomIndex: 0,
    side: fallback.side,
    width: 22,
    color: complex.color,
  };
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

function routeAStar(start, goal, obstacles, routeSeed) {
  const sx = Math.round(start.x / ROUTE_STEP);
  const sy = Math.round(start.y / ROUTE_STEP);
  const gx = Math.round(goal.x / ROUTE_STEP);
  const gy = Math.round(goal.y / ROUTE_STEP);
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

function fallbackRoute(start, goal, obstacles, routeSeed) {
  const offsets = [0.72, -0.72, 1.18, -1.18].map((v) => v * CELL_SIZE);
  if (hash01(routeSeed, 0, 0, 881) > 0.5) offsets.reverse();

  for (const offset of offsets) {
    const midY = (start.y + goal.y) * 0.5 + offset;
    const path = [
      start,
      { x: start.x, y: midY },
      { x: goal.x, y: midY },
      goal,
    ];
    let clear = true;
    for (let i = 0; i < path.length - 1; i++) {
      if (!segmentClear(path[i], path[i + 1], obstacles)) {
        clear = false;
        break;
      }
    }
    if (clear) return path;
  }

  for (const offset of offsets) {
    const midX = (start.x + goal.x) * 0.5 + offset;
    const path = [
      start,
      { x: midX, y: start.y },
      { x: midX, y: goal.y },
      goal,
    ];
    let clear = true;
    for (let i = 0; i < path.length - 1; i++) {
      if (!segmentClear(path[i], path[i + 1], obstacles)) {
        clear = false;
        break;
      }
    }
    if (clear) return path;
  }

  return [start, goal];
}

function buildChambers(points, width, color, routeSeed) {
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
      chambers.push({
        x: point.x,
        y: point.y,
        w: size * (0.90 + hash01(routeSeed, i, points.length, 924) * 0.50),
        h: size * (0.78 + hash01(routeSeed, i, points.length, 925) * 0.56),
        angle: Math.atan2(by, bx),
        color,
        major: false,
        partitions: [],
        columns: [],
      });
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
    const sourcePortal = chooseExternalPortal(source, target.anchor, routeSeed ^ 0x1122);
    const targetPortal = chooseExternalPortal(target, source.anchor, routeSeed ^ 0x3344);
    const clearance = width * 0.5 + 15;
    const sourceOutside = pointOutsideComplex(source, sourcePortal, clearance);
    const targetOutside = pointOutsideComplex(target, targetPortal, clearance);
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
      chambers: buildChambers(points.slice(1, -1), width, color, routeSeed),
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
