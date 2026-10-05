export const CELL_SIZE = 900;
export const QUERY_HALO = 2;
export const GENERATOR_VERSION = 2;

const TAU = Math.PI * 2;
const ROOM_CONFLICT_CELL_RADIUS = 2;
const ROOM_PADDING = 3;
const WALL = '#6d604d';
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
  const jx = hashSigned(seed, cx, cy, 11) * CELL_SIZE * 0.31;
  const jy = hashSigned(seed, cx, cy, 12) * CELL_SIZE * 0.31;
  return {
    x: cx * CELL_SIZE + CELL_SIZE * 0.5 + jx,
    y: cy * CELL_SIZE + CELL_SIZE * 0.5 + jy,
  };
}

function parentFor(seed, cx, cy) {
  if (cx === 0 && cy === 0) return null;
  if (cx === 0) return [0, cy - sign(cy)];
  if (cy === 0) return [cx - sign(cx), 0];

  if (hash01(seed, cx, cy, 21) < 0.5) return [cx - sign(cx), cy];
  return [cx, cy - sign(cy)];
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
    const edge = canonicalEdgeKey(cx, cy, nx, ny);
    const chance = ((hashString(edge) ^ seed ^ salt) >>> 0) / 4294967296;
    const rankDelta = Math.abs(distanceRank(nx, ny) - distanceRank(cx, cy));
    const threshold = rankDelta === 0 ? 0.22 : 0.11;
    if (chance < threshold) output.push([nx, ny]);
  }
  return output;
}

function makeRoute(seed, ax, ay, bx, by, edgeKey) {
  const a = anchorFor(seed, ax, ay);
  const b = anchorFor(seed, bx, by);
  const rng = seededRng(edgeSalt(edgeKey, seed ^ 0x32f2a1));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;
  const tx = dx / dist;
  const ty = dy / dist;
  const bends = 4 + Math.floor(rng() * 4);
  const points = [{ ...a }];

  let previousOffset = 0;
  for (let i = 1; i < bends; i++) {
    const t = i / bends;
    const envelope = Math.sin(Math.PI * t);
    const targetOffset = (rng() * 2 - 1) * CELL_SIZE * 0.18 * envelope;
    const offset = previousOffset * 0.42 + targetOffset * 0.58;
    previousOffset = offset;
    const tangentJitter = (rng() * 2 - 1) * CELL_SIZE * 0.035;
    points.push({
      x: a.x + dx * t + nx * offset + tx * tangentJitter,
      y: a.y + dy * t + ny * offset + ty * tangentJitter,
    });
  }
  points.push({ ...b });
  return points;
}

function pointAlongRoute(points, t) {
  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy);
    lengths.push(len);
    total += len;
  }
  if (total <= 0) return { x: points[0].x, y: points[0].y, angle: 0 };

  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const segT = lengths[i] ? target / lengths[i] : 0;
      const a = points[i];
      const b = points[i + 1];
      return {
        x: a.x + (b.x - a.x) * segT,
        y: a.y + (b.y - a.y) * segT,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    target -= lengths[i];
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

function roomId(cx, cy, index) {
  return cx + ':' + cy + ':' + index;
}

function addRoom(geometry, rng, x, y, angle, color, scale = 1, major = false, anchor = false) {
  const index = geometry.rooms.length;
  const w = (major ? 108 + rng() * 168 : 42 + rng() * 92) * scale;
  const h = (major ? 84 + rng() * 138 : 34 + rng() * 76) * scale;
  const snappedAngle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
  const rotation = snappedAngle + (rng() - 0.5) * (major ? 0.10 : 0.06);
  const id = roomId(geometry.cx, geometry.cy, index);
  const basePriority = hashInt(geometry.seed, geometry.cx, geometry.cy, 12000 + index);
  const priority = anchor ? (basePriority >>> 3) : basePriority;
  const room = {
    id,
    priority,
    ownerX: geometry.cx,
    ownerY: geometry.cy,
    x,
    y,
    w,
    h,
    angle: rotation,
    color,
    major,
    anchor,
    partitions: [],
  };

  if (major || rng() < 0.38) {
    const count = major ? 1 + Math.floor(rng() * 2) : 1;
    for (let i = 0; i < count; i++) {
      room.partitions.push({
        axis: rng() < 0.5 ? 'x' : 'y',
        t: 0.27 + rng() * 0.46,
        gap: 0.19 + rng() * 0.20,
      });
    }
  }
  geometry.rooms.push(room);
  return room;
}

function addBranchGrowth(geometry, rng, start, baseAngle, color, density, depthLimit = 3, maxRadius = 520, allowCompanion = true) {
  const origin = { x: start.x, y: start.y };
  const queue = [{
    x: start.x,
    y: start.y,
    angle: baseAngle,
    depth: 0,
    energy: 2 + Math.floor(rng() * 4),
  }];
  let budget = Math.floor(12 + density * 15);

  while (queue.length && budget > 0) {
    const front = queue.shift();
    let x = front.x;
    let y = front.y;
    let angle = front.angle;
    const steps = Math.min(front.energy, 2 + Math.floor(rng() * 4));

    for (let step = 0; step < steps && budget > 0; step++) {
      budget--;
      angle += (rng() - 0.5) * 0.62;
      if (rng() < 0.56) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      const len = 50 + rng() * 96;
      const next = { x: x + Math.cos(angle) * len, y: y + Math.sin(angle) * len };
      if (Math.hypot(next.x - origin.x, next.y - origin.y) > maxRadius) break;
      const width = 18 + rng() * 22;
      geometry.corridors.push({ points: [{ x, y }, next], width, color, detail: true });

      const roomChance = 0.58 + density * 0.12;
      if (rng() < roomChance) {
        const side = rng() < 0.5 ? -1 : 1;
        const roomScale = 0.76 + density * 0.25;
        const major = rng() < 0.045 * density;
        const normalAngle = angle + side * Math.PI / 2;
        const roomWEstimate = major ? 120 : 58;
        const offset = width * 0.42 + roomWEstimate * 0.42;
        const room = addRoom(
          geometry,
          rng,
          next.x + Math.cos(normalAngle) * offset,
          next.y + Math.sin(normalAngle) * offset,
          angle,
          color,
          roomScale,
          major
        );

        if (allowCompanion && !major && rng() < 0.16) {
          const companionSide = rng() < 0.5 ? -1 : 1;
          const companionAngle = room.angle + companionSide * Math.PI / 2;
          const companionScale = 0.64 + rng() * 0.28;
          const separation = room.h * 0.5 + 28 + rng() * 22;
          addRoom(
            geometry,
            rng,
            room.x + Math.cos(companionAngle) * separation,
            room.y + Math.sin(companionAngle) * separation,
            room.angle,
            color,
            companionScale,
            false
          );
          geometry.corridors.push({
            points: [
              { x: room.x, y: room.y },
              {
                x: room.x + Math.cos(companionAngle) * separation,
                y: room.y + Math.sin(companionAngle) * separation,
              },
            ],
            width: 16 + rng() * 10,
            color,
            detail: true,
          });
        }
      }

      if (front.depth < depthLimit && budget > 2 && rng() < 0.22 * density) {
        const side = rng() < 0.5 ? -1 : 1;
        queue.push({
          x: next.x,
          y: next.y,
          angle: angle + side * (0.75 + rng() * 0.78),
          depth: front.depth + 1,
          energy: 1 + Math.floor(rng() * 4),
        });
      }

      x = next.x;
      y = next.y;
    }
  }
}

function addEdgeDecorations(geometry, seed, edgeKey, route, color, density) {
  const rng = seededRng(edgeSalt(edgeKey, seed ^ 0x98a2c9));
  const count = 2 + Math.floor(rng() * (4 + density * 4));
  for (let i = 0; i < count; i++) {
    const t = 0.08 + rng() * 0.32;
    const point = pointAlongRoute(route, t);
    if (rng() < 0.82) {
      const side = rng() < 0.5 ? -1 : 1;
      addBranchGrowth(
        geometry,
        rng,
        point,
        point.angle + side * (0.95 + rng() * 0.72),
        color,
        density * (0.72 + rng() * 0.28),
        2,
        240,
        false
      );
    } else {
      addRoom(geometry, rng, point.x, point.y, point.angle, color, 1.00 + density * 0.12, true);
    }
  }
}

function addHubGrowth(geometry, seed, cx, cy, anchor, color, density) {
  const rng = seededRng(hashInt(seed, cx, cy, 901));
  const hubAngle = rng() * TAU;
  addRoom(geometry, rng, anchor.x, anchor.y, hubAngle, color, 0.92 + density * 0.12, true, true);

  const fronts = 2 + Math.floor(rng() * (2 + density * 1.5));
  for (let i = 0; i < fronts; i++) {
    const angle = hubAngle + (i / fronts) * TAU + (rng() - 0.5) * 0.7;
    addBranchGrowth(geometry, rng, anchor, angle, color, density, 3, 540);
  }
}

function makeCellGeometry(seed, cx, cy) {
  const color = choosePalette(seed, cx, cy);
  const density = 0.56 + hash01(seed, cx, cy, 800) * 0.82;
  const geometry = {
    seed,
    cx,
    cy,
    color,
    wall: WALL,
    corridors: [],
    rooms: [],
    anchor: anchorFor(seed, cx, cy),
  };

  addHubGrowth(geometry, seed, cx, cy, geometry.anchor, color, density);

  const parent = parentFor(seed, cx, cy);
  if (parent) {
    const [px, py] = parent;
    const edgeKey = canonicalEdgeKey(cx, cy, px, py);
    const route = makeRoute(seed, cx, cy, px, py, edgeKey);
    const width = 24 + hash01(seed, cx, cy, 220) * 24;
    geometry.corridors.push({ points: route, width, color, detail: false });
    addEdgeDecorations(geometry, seed, edgeKey, route, color, density);
  }

  for (const [nx, ny] of optionalNeighborEdges(seed, cx, cy)) {
    const edgeKey = canonicalEdgeKey(cx, cy, nx, ny);
    const route = makeRoute(seed, cx, cy, nx, ny, edgeKey);
    const width = 18 + (edgeSalt(edgeKey, 77) % 16);
    geometry.corridors.push({ points: route, width, color, detail: false });
    if (hash01(seed, cx, cy, 555 + nx * 7 + ny * 13) < 0.36) {
      addEdgeDecorations(geometry, seed, edgeKey + ':loop', route, color, density * 0.64);
    }
  }

  return geometry;
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

export function roomsOverlap(a, b, padding = ROOM_PADDING) {
  const [aX, aY] = roomAxes(a);
  const [bX, bY] = roomAxes(b);
  const deltaX = b.x - a.x;
  const deltaY = b.y - a.y;
  const aHalfW = a.w * 0.5 + padding;
  const aHalfH = a.h * 0.5 + padding;
  const bHalfW = b.w * 0.5 + padding;
  const bHalfH = b.h * 0.5 + padding;
  const axes = [aX, aY, bX, bY];

  for (const axis of axes) {
    const distance = Math.abs(dot(deltaX, deltaY, axis.x, axis.y));
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

function winsConflict(room, other) {
  if (other.priority !== room.priority) return room.priority < other.priority;
  return room.id < other.id;
}

export class InfiniteMapGenerator {
  constructor(seedText = 'backrooms-71') {
    this.rawCache = new Map();
    this.resolvedCache = new Map();
    this.frame = 0;
    this.setSeed(seedText);
  }

  setSeed(seedText) {
    this.seedText = String(seedText || 'backrooms-71');
    this.seed = hashString('v' + GENERATOR_VERSION + ':' + this.seedText);
    this.rawCache.clear();
    this.resolvedCache.clear();
  }

  getRawCell(cx, cy) {
    const key = keyOf(cx, cy);
    const cached = this.rawCache.get(key);
    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }
    const geometry = makeCellGeometry(this.seed, cx, cy);
    this.rawCache.set(key, { geometry, used: this.frame });
    return geometry;
  }

  roomSurvives(room) {
    for (let dy = -ROOM_CONFLICT_CELL_RADIUS; dy <= ROOM_CONFLICT_CELL_RADIUS; dy++) {
      for (let dx = -ROOM_CONFLICT_CELL_RADIUS; dx <= ROOM_CONFLICT_CELL_RADIUS; dx++) {
        const neighbor = this.getRawCell(room.ownerX + dx, room.ownerY + dy);
        for (const other of neighbor.rooms) {
          if (other.id === room.id) continue;
          if (winsConflict(room, other)) continue;
          if (roomsOverlap(room, other)) return false;
        }
      }
    }
    return true;
  }

  getResolvedCell(cx, cy) {
    const key = keyOf(cx, cy);
    const cached = this.resolvedCache.get(key);
    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }

    const raw = this.getRawCell(cx, cy);
    const geometry = {
      cx: raw.cx,
      cy: raw.cy,
      color: raw.color,
      wall: raw.wall,
      anchor: raw.anchor,
      corridors: raw.corridors,
      rooms: raw.rooms.filter((room) => this.roomSurvives(room)),
    };

    this.resolvedCache.set(key, { geometry, used: this.frame });
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
        cells.push(this.getResolvedCell(cx, cy));
      }
    }

    if (this.rawCache.size > 900) this.pruneCache(this.rawCache, 650);
    if (this.resolvedCache.size > 520) this.pruneCache(this.resolvedCache, 360);
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
