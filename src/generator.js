export const CELL_SIZE = 900;
export const QUERY_HALO = 2;

const TAU = Math.PI * 2;
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
  if (rare < 0.78) index = Math.floor(hash01(seed, cx, cy, 702) * 5);
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
    const threshold = rankDelta === 0 ? 0.24 : 0.13;
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
  const bends = 3 + Math.floor(rng() * 4);
  const points = [{ ...a }];

  let previousOffset = 0;
  for (let i = 1; i < bends; i++) {
    const t = i / bends;
    const envelope = Math.sin(Math.PI * t);
    const targetOffset = (rng() * 2 - 1) * CELL_SIZE * 0.22 * envelope;
    const offset = previousOffset * 0.35 + targetOffset * 0.65;
    previousOffset = offset;
    const tangentJitter = (rng() * 2 - 1) * CELL_SIZE * 0.045;
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

function addRoom(geometry, rng, x, y, angle, color, scale = 1, major = false) {
  const w = (major ? 120 + rng() * 180 : 44 + rng() * 105) * scale;
  const h = (major ? 90 + rng() * 150 : 36 + rng() * 88) * scale;
  const rotation = angle + (rng() - 0.5) * (major ? 0.22 : 0.12);
  const room = { x, y, w, h, angle: rotation, color, major, partitions: [] };

  if (major || rng() < 0.42) {
    const count = major ? 1 + Math.floor(rng() * 3) : 1;
    for (let i = 0; i < count; i++) {
      room.partitions.push({
        axis: rng() < 0.5 ? 'x' : 'y',
        t: 0.25 + rng() * 0.5,
        gap: 0.18 + rng() * 0.22,
      });
    }
  }
  geometry.rooms.push(room);
  return room;
}

function addBranchGrowth(geometry, rng, start, baseAngle, color, density, depthLimit = 3, maxRadius = 560) {
  const origin = { x: start.x, y: start.y };
  const queue = [{
    x: start.x,
    y: start.y,
    angle: baseAngle,
    depth: 0,
    energy: 2 + Math.floor(rng() * 4),
  }];
  let budget = Math.floor(14 + density * 18);

  while (queue.length && budget > 0) {
    const front = queue.shift();
    let x = front.x;
    let y = front.y;
    let angle = front.angle;
    const steps = Math.min(front.energy, 2 + Math.floor(rng() * 4));

    for (let step = 0; step < steps && budget > 0; step++) {
      budget--;
      angle += (rng() - 0.5) * 0.72;
      if (rng() < 0.46) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      const len = 48 + rng() * 112;
      const next = { x: x + Math.cos(angle) * len, y: y + Math.sin(angle) * len };
      if (Math.hypot(next.x - origin.x, next.y - origin.y) > maxRadius) break;
      const width = 18 + rng() * 26;
      geometry.corridors.push({ points: [{ x, y }, next], width, color, detail: true });

      const roomChance = 0.54 + density * 0.16;
      if (rng() < roomChance) {
        const side = rng() < 0.5 ? -1 : 1;
        const roomScale = 0.72 + density * 0.34;
        const major = rng() < 0.06 * density;
        const normalAngle = angle + side * Math.PI / 2;
        const roomWEstimate = major ? 125 : 60;
        const offset = width * 0.16 + roomWEstimate * 0.28;
        addRoom(
          geometry,
          rng,
          next.x + Math.cos(normalAngle) * offset,
          next.y + Math.sin(normalAngle) * offset,
          angle,
          color,
          roomScale,
          major
        );
      }

      if (front.depth < depthLimit && budget > 2 && rng() < 0.24 * density) {
        const side = rng() < 0.5 ? -1 : 1;
        queue.push({
          x: next.x,
          y: next.y,
          angle: angle + side * (0.7 + rng() * 0.9),
          depth: front.depth + 1,
          energy: 1 + Math.floor(rng() * 4),
        });
      }

      x = next.x;
      y = next.y;
    }
  }
}

function addEdgeDecorations(geometry, seed, ownerX, ownerY, edgeKey, route, color, density) {
  const rng = seededRng(edgeSalt(edgeKey, seed ^ 0x98a2c9));
  const count = 3 + Math.floor(rng() * (4 + density * 5));
  for (let i = 0; i < count; i++) {
    const t = 0.10 + rng() * 0.80;
    const point = pointAlongRoute(route, t);
    if (rng() < 0.75) {
      const side = rng() < 0.5 ? -1 : 1;
      addBranchGrowth(
        geometry,
        rng,
        point,
        point.angle + side * (0.9 + rng() * 0.9),
        color,
        density * (0.76 + rng() * 0.34),
        2,
        360
      );
    } else {
      addRoom(geometry, rng, point.x, point.y, point.angle, color, 1.1 + density * 0.16, true);
    }
  }
}

function addHubGrowth(geometry, seed, cx, cy, anchor, color, density) {
  const rng = seededRng(hashInt(seed, cx, cy, 901));
  const hubAngle = rng() * TAU;
  addRoom(geometry, rng, anchor.x, anchor.y, hubAngle, color, 1 + density * 0.18, true);

  const fronts = 2 + Math.floor(rng() * (3 + density * 2));
  for (let i = 0; i < fronts; i++) {
    const angle = hubAngle + (i / fronts) * TAU + (rng() - 0.5) * 0.8;
    addBranchGrowth(geometry, rng, anchor, angle, color, density, 3, 620);
  }
}

function makeCellGeometry(seed, cx, cy) {
  const color = choosePalette(seed, cx, cy);
  const density = 0.55 + hash01(seed, cx, cy, 800) * 0.95;
  const geometry = {
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
    const width = 24 + hash01(seed, cx, cy, 220) * 28;
    geometry.corridors.push({ points: route, width, color, detail: false });
    addEdgeDecorations(geometry, seed, cx, cy, edgeKey, route, color, density);
  }

  for (const [nx, ny] of optionalNeighborEdges(seed, cx, cy)) {
    const edgeKey = canonicalEdgeKey(cx, cy, nx, ny);
    const route = makeRoute(seed, cx, cy, nx, ny, edgeKey);
    const width = 18 + (edgeSalt(edgeKey, 77) % 18);
    geometry.corridors.push({ points: route, width, color, detail: false });
    if (hash01(seed, cx, cy, 555 + nx * 7 + ny * 13) < 0.42) {
      addEdgeDecorations(geometry, seed, cx, cy, edgeKey + ':loop', route, color, density * 0.7);
    }
  }

  return geometry;
}

export class InfiniteMapGenerator {
  constructor(seedText = 'backrooms-71') {
    this.cache = new Map();
    this.frame = 0;
    this.setSeed(seedText);
  }

  setSeed(seedText) {
    this.seedText = String(seedText || 'backrooms-71');
    this.seed = hashString(this.seedText);
    this.cache.clear();
  }

  getCell(cx, cy) {
    const key = keyOf(cx, cy);
    const cached = this.cache.get(key);
    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }
    const geometry = makeCellGeometry(this.seed, cx, cy);
    this.cache.set(key, { geometry, used: this.frame });
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

    if (this.cache.size > 900) this.pruneCache(640);
    return cells;
  }

  pruneCache(targetSize) {
    const entries = [...this.cache.entries()];
    entries.sort((a, b) => a[1].used - b[1].used);
    const removeCount = Math.max(0, entries.length - targetSize);
    for (let i = 0; i < removeCount; i++) this.cache.delete(entries[i][0]);
  }
}

export function parentCell(seedText, cx, cy) {
  return parentFor(hashString(String(seedText)), cx, cy);
}
