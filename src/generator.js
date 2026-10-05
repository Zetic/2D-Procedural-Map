export const GENERATOR_VERSION = 10;

export const CHUNK_SIZE = 900;
export const SITE_GRID = 190;
export const SITE_MIN_DISTANCE = 165;

const SITE_NEIGHBOR_RADIUS = 2;
const SITE_PARENT_RADIUS = 6;
const ROOM_NEIGHBOR_RADIUS = 3;
const QUERY_HALO = 1250;
const MAX_CONNECTOR_SEGMENT = 92;
const WALL_COLOR = '#625747';

const FLOOR_PALETTES = [
  '#ead29c',
  '#e6c98b',
  '#ecd5a8',
  '#dfc08b',
  '#e9d0a2',
  '#e5b6a8',
  '#b8c5d0',
  '#b9c998',
  '#dbc3b7',
  '#d8b47f',
];

const TAU = Math.PI * 2;

let cacheSeed = null;
const acceptedSiteCache = new Map();
const parentSiteCache = new Map();
const nearestDistanceCache = new Map();
const optionalEdgeCache = new Map();

function ensureSeedCaches(seed) {
  if (cacheSeed === seed) return;

  cacheSeed = seed;
  acceptedSiteCache.clear();
  parentSiteCache.clear();
  nearestDistanceCache.clear();
  optionalEdgeCache.clear();
}

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
  h ^= Math.imul(x | 0, 0x9e3779b1);
  h = mix32(h);
  h ^= Math.imul(y | 0, 0x85ebca77);
  h = mix32(h);
  h ^= Math.imul(salt | 0, 0xc2b2ae3d);
  return mix32(h);
}

function hash01(seed, x, y, salt = 0) {
  return hashInt(seed, x, y, salt) / 4294967296;
}

function hashSigned(seed, x, y, salt = 0) {
  return hash01(seed, x, y, salt) * 2 - 1;
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed, x, y, scale, salt) {
  const gx = x / scale;
  const gy = y / scale;

  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);

  const fx = smoothstep(gx - x0);
  const fy = smoothstep(gy - y0);

  const a = hash01(seed, x0, y0, salt);
  const b = hash01(seed, x0 + 1, y0, salt);
  const c = hash01(seed, x0, y0 + 1, salt);
  const d = hash01(seed, x0 + 1, y0 + 1, salt);

  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;

  return ab + (cd - ab) * fy;
}

function worldProfile(seed, x, y) {
  return {
    density: valueNoise(seed, x, y, 2200, 2001),
    scale: valueNoise(seed, x, y, 2900, 2002),
    openness: valueNoise(seed, x, y, 1800, 2003),
    loops: valueNoise(seed, x, y, 2500, 2004),
    angle: valueNoise(seed, x, y, 1650, 2005),
  };
}

function siteCandidate(seed, sx, sy) {
  const root = sx === 0 && sy === 0;
  const jitter = SITE_GRID * 0.43;

  return {
    sx,
    sy,
    x:
      sx * SITE_GRID +
      SITE_GRID * 0.5 +
      hashSigned(seed, sx, sy, 11) * jitter,
    y:
      sy * SITE_GRID +
      SITE_GRID * 0.5 +
      hashSigned(seed, sx, sy, 12) * jitter,
    priority:
      root
        ? 0
        : hashInt(seed, sx, sy, 13),
  };
}

function siteWins(a, b) {
  if (a.priority !== b.priority) {
    return a.priority < b.priority;
  }

  if (a.sx !== b.sx) {
    return a.sx < b.sx;
  }

  return a.sy < b.sy;
}

function isAcceptedSiteInternal(seed, sx, sy) {
  ensureSeedCaches(seed);

  const key = siteKey(sx, sy);

  if (acceptedSiteCache.has(key)) {
    return acceptedSiteCache.get(key);
  }

  const candidate = siteCandidate(seed, sx, sy);

  for (
    let oy = -SITE_NEIGHBOR_RADIUS;
    oy <= SITE_NEIGHBOR_RADIUS;
    oy++
  ) {
    for (
      let ox = -SITE_NEIGHBOR_RADIUS;
      ox <= SITE_NEIGHBOR_RADIUS;
      ox++
    ) {
      if (ox === 0 && oy === 0) continue;

      const other = siteCandidate(
        seed,
        sx + ox,
        sy + oy,
      );

      const dx = other.x - candidate.x;
      const dy = other.y - candidate.y;

      if (
        dx * dx + dy * dy >=
        SITE_MIN_DISTANCE * SITE_MIN_DISTANCE
      ) {
        continue;
      }

      if (siteWins(other, candidate)) {
        acceptedSiteCache.set(key, false);
        return false;
      }
    }
  }

  acceptedSiteCache.set(key, true);
  return true;
}

export function isSiteCell(seedText, sx, sy) {
  const seed = hashString(
    'v' + GENERATOR_VERSION + ':' + String(seedText),
  );

  return isAcceptedSiteInternal(seed, sx, sy);
}

export function sitePosition(seedText, sx, sy) {
  const seed = hashString(
    'v' + GENERATOR_VERSION + ':' + String(seedText),
  );

  const site = siteCandidate(seed, sx, sy);

  return {
    x: site.x,
    y: site.y,
  };
}

function rootDistanceSq(seed, sx, sy) {
  const root = siteCandidate(seed, 0, 0);
  const point = siteCandidate(seed, sx, sy);

  const dx = point.x - root.x;
  const dy = point.y - root.y;

  return dx * dx + dy * dy;
}

function parentFor(seed, sx, sy) {
  ensureSeedCaches(seed);

  const key = siteKey(sx, sy);

  if (parentSiteCache.has(key)) {
    return parentSiteCache.get(key);
  }

  if (sx === 0 && sy === 0) {
    parentSiteCache.set(key, null);
    return null;
  }

  if (!isAcceptedSiteInternal(seed, sx, sy)) {
    parentSiteCache.set(key, null);
    return null;
  }

  const source = siteCandidate(seed, sx, sy);
  const sourceRank = rootDistanceSq(seed, sx, sy);

  let best = null;

  for (
    let radius = 1;
    radius <= SITE_PARENT_RADIUS;
    radius++
  ) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (
          Math.max(Math.abs(ox), Math.abs(oy)) !==
          radius
        ) {
          continue;
        }

        const nx = sx + ox;
        const ny = sy + oy;

        if (!isAcceptedSiteInternal(seed, nx, ny)) {
          continue;
        }

        const rank = rootDistanceSq(seed, nx, ny);

        if (rank >= sourceRank) continue;

        const target = siteCandidate(seed, nx, ny);

        const distance = Math.hypot(
          target.x - source.x,
          target.y - source.y,
        );

        const score =
          distance *
          (
            0.92 +
            hash01(
              seed,
              sx * 193 + nx,
              sy * 197 + ny,
              21,
            ) *
              0.16
          );

        if (
          !best ||
          score < best.score ||
          (
            score === best.score &&
            (
              nx < best.x ||
              (nx === best.x && ny < best.y)
            )
          )
        ) {
          best = {
            x: nx,
            y: ny,
            score,
          };
        }
      }
    }

    if (
      best &&
      best.score <
        (radius + 0.35) * SITE_GRID
    ) {
      break;
    }
  }

  const result = best
    ? [best.x, best.y]
    : [0, 0];

  parentSiteCache.set(key, result);
  return result;
}

export function parentCell(seedText, sx, sy) {
  const seed = hashString(
    'v' + GENERATOR_VERSION + ':' + String(seedText),
  );

  return parentFor(seed, sx, sy);
}

function acceptedNeighbors(seed, sx, sy, radius = 3) {
  const source = siteCandidate(seed, sx, sy);
  const out = [];

  for (let oy = -radius; oy <= radius; oy++) {
    for (let ox = -radius; ox <= radius; ox++) {
      if (ox === 0 && oy === 0) continue;

      const nx = sx + ox;
      const ny = sy + oy;

      if (!isAcceptedSiteInternal(seed, nx, ny)) {
        continue;
      }

      const target = siteCandidate(seed, nx, ny);

      out.push({
        sx: nx,
        sy: ny,
        x: target.x,
        y: target.y,
        distance: Math.hypot(
          target.x - source.x,
          target.y - source.y,
        ),
      });
    }
  }

  out.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }

    if (a.sx !== b.sx) {
      return a.sx - b.sx;
    }

    return a.sy - b.sy;
  });

  return out;
}

function siteKey(sx, sy) {
  return sx + ',' + sy;
}

function edgeKey(ax, ay, bx, by) {
  const a = siteKey(ax, ay);
  const b = siteKey(bx, by);

  return a < b
    ? a + '|' + b
    : b + '|' + a;
}

function nearestAcceptedDistance(seed, sx, sy) {
  ensureSeedCaches(seed);

  const key = siteKey(sx, sy);

  if (nearestDistanceCache.has(key)) {
    return nearestDistanceCache.get(key);
  }

  const source = siteCandidate(seed, sx, sy);
  let nearest = Infinity;

  for (
    let oy = -ROOM_NEIGHBOR_RADIUS;
    oy <= ROOM_NEIGHBOR_RADIUS;
    oy++
  ) {
    for (
      let ox = -ROOM_NEIGHBOR_RADIUS;
      ox <= ROOM_NEIGHBOR_RADIUS;
      ox++
    ) {
      if (ox === 0 && oy === 0) continue;

      const nx = sx + ox;
      const ny = sy + oy;

      if (!isAcceptedSiteInternal(seed, nx, ny)) {
        continue;
      }

      const other = siteCandidate(seed, nx, ny);

      nearest = Math.min(
        nearest,
        Math.hypot(
          other.x - source.x,
          other.y - source.y,
        ),
      );
    }
  }

  const result = Number.isFinite(nearest)
    ? nearest
    : SITE_GRID * 1.7;

  nearestDistanceCache.set(key, result);
  return result;
}

function paletteForRoom(seed, sx, sy, x, y) {
  const rareField = valueNoise(
    seed,
    x,
    y,
    1550,
    3101,
  );

  if (rareField > 0.88) {
    const index =
      5 +
      Math.floor(
        valueNoise(
          seed,
          x,
          y,
          2200,
          3102,
        ) *
          (FLOOR_PALETTES.length - 5),
      );

    return clamp(
      index,
      5,
      FLOOR_PALETTES.length - 1,
    );
  }

  const base =
    valueNoise(
      seed,
      x,
      y,
      1900,
      3103,
    ) *
      0.72 +
    hash01(seed, sx, sy, 3104) * 0.28;

  return clamp(
    Math.floor(base * 5),
    0,
    4,
  );
}

function localShapeVertices(shape, w, h, variant) {
  const hw = w * 0.5;
  const hh = h * 0.5;

  if (shape === 'chamfer') {
    const cut = Math.min(w, h) * 0.16;

    return [
      { x: -hw + cut, y: -hh },
      { x: hw - cut, y: -hh },
      { x: hw, y: -hh + cut },
      { x: hw, y: hh - cut },
      { x: hw - cut, y: hh },
      { x: -hw + cut, y: hh },
      { x: -hw, y: hh - cut },
      { x: -hw, y: -hh + cut },
    ];
  }

  if (shape === 'l') {
    const cutW = w * (0.28 + (variant % 3) * 0.055);
    const cutH = h * (0.28 + ((variant >> 2) % 3) * 0.055);

    const base = [
      { x: -hw, y: -hh },
      { x: hw - cutW, y: -hh },
      { x: hw - cutW, y: -hh + cutH },
      { x: hw, y: -hh + cutH },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];

    const turns = variant % 4;

    return base.map((point) => {
      let x = point.x;
      let y = point.y;

      for (let i = 0; i < turns; i++) {
        const nextX = -y;
        const nextY = x;
        x = nextX;
        y = nextY;
      }

      return { x, y };
    });
  }

  if (shape === 'step') {
    const stepW = w * 0.23;
    const stepH = h * 0.24;

    const base = [
      { x: -hw, y: -hh },
      { x: hw - stepW, y: -hh },
      { x: hw - stepW, y: -hh + stepH },
      { x: hw, y: -hh + stepH },
      { x: hw, y: hh },
      { x: -hw + stepW * 0.7, y: hh },
      { x: -hw + stepW * 0.7, y: hh - stepH * 0.7 },
      { x: -hw, y: hh - stepH * 0.7 },
    ];

    if (variant % 2 === 0) {
      return base;
    }

    return base.map((point) => ({
      x: -point.x,
      y: point.y,
    }));
  }

  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
}

function transformVertices(localVertices, x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return localVertices.map((point) => ({
    x: x + point.x * c - point.y * s,
    y: y + point.x * s + point.y * c,
  }));
}

function polygonAabb(vertices) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of vertices) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
  };
}

function aabbIntersects(a, b) {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

function roomForSite(seed, sx, sy) {
  const site = siteCandidate(seed, sx, sy);
  const nearest = nearestAcceptedDistance(seed, sx, sy);
  const profile = worldProfile(seed, site.x, site.y);
  const rng = seededRng(
    hashInt(seed, sx, sy, 4001),
  );

  const sparse =
    0.92 +
    profile.density * 0.08;

  const maxRadius =
    nearest *
    (
      0.43 +
      profile.density * 0.045
    );

  const major =
    rng() <
    (
      0.065 +
      profile.scale * 0.075
    );

  const kindRoll = rng();

  let kind;
  let aspect;

  if (major) {
    kind = 'chamber';
    aspect = 0.82 + rng() * 1.55;
  } else if (kindRoll < 0.16) {
    kind = 'gallery';
    aspect = 1.65 + rng() * 1.55;
  } else if (kindRoll < 0.31) {
    kind = 'suite';
    aspect = 1.05 + rng() * 0.75;
  } else if (kindRoll < 0.46) {
    kind = 'cell';
    aspect = 0.78 + rng() * 0.55;
  } else {
    kind = 'room';
    aspect = 0.82 + rng() * 1.15;
  }

  const sizeFraction =
    major
      ? 0.98 + rng() * 0.02
      : kind === 'cell'
        ? 0.55 + rng() * 0.17
        : kind === 'gallery'
          ? 0.82 + rng() * 0.14
          : kind === 'suite'
            ? 0.76 + rng() * 0.16
            : 0.72 + rng() * 0.18;

  const targetRadius =
    maxRadius *
    sizeFraction *
    sparse;

  let w;
  let h;

  if (aspect >= 1) {
    w = targetRadius * 1.62;
    h = w / aspect;
  } else {
    h = targetRadius * 1.62;
    w = h * aspect;
  }

  w = Math.max(38, w);
  h = Math.max(36, h);

  let radius = Math.hypot(w, h) * 0.5;

  if (radius > maxRadius) {
    const scale = maxRadius / radius;
    w *= scale;
    h *= scale;
    radius = maxRadius;
  }

  const regionalAngle =
    valueNoise(
      seed,
      site.x,
      site.y,
      1350,
      4101,
    ) *
    TAU;

  const angle =
    Math.round(
      (
        regionalAngle +
        hashSigned(seed, sx, sy, 4102) * 0.88
      ) /
        (Math.PI / 12),
    ) *
    (Math.PI / 12);

  const shapeRoll = rng();

  const shape =
    major && shapeRoll < 0.26
      ? 'chamfer'
      : shapeRoll < 0.16
        ? 'l'
        : shapeRoll < 0.25
          ? 'step'
          : 'rect';

  const variant =
    hashInt(seed, sx, sy, 4103) % 16;

  const localVertices = localShapeVertices(
    shape,
    w,
    h,
    variant,
  );

  const vertices = transformVertices(
    localVertices,
    site.x,
    site.y,
    angle,
  );

  const colorIndex = paletteForRoom(
    seed,
    sx,
    sy,
    site.x,
    site.y,
  );

  const details = [];

  if (
    shape === 'rect' &&
    w * h > 9000 &&
    rng() < 0.34
  ) {
    const vertical = rng() < 0.5;
    const gap = 14 + rng() * 18;

    if (vertical) {
      const localX =
        -w * 0.17 + rng() * w * 0.34;

      details.push({
        type: 'partition-local',
        x1: localX,
        y1: -h * 0.5,
        x2: localX,
        y2: -gap * 0.5,
      });

      details.push({
        type: 'partition-local',
        x1: localX,
        y1: gap * 0.5,
        x2: localX,
        y2: h * 0.5,
      });
    } else {
      const localY =
        -h * 0.17 + rng() * h * 0.34;

      details.push({
        type: 'partition-local',
        x1: -w * 0.5,
        y1: localY,
        x2: -gap * 0.5,
        y2: localY,
      });

      details.push({
        type: 'partition-local',
        x1: gap * 0.5,
        y1: localY,
        x2: w * 0.5,
        y2: localY,
      });
    }
  }

  if (
    major &&
    w * h > 12000 &&
    rng() < 0.34
  ) {
    const cols = clamp(
      Math.floor(w / 75),
      1,
      4,
    );

    const rows = clamp(
      Math.floor(h / 75),
      1,
      4,
    );

    for (let row = 1; row <= rows; row++) {
      for (let col = 1; col <= cols; col++) {
        if (rng() > 0.68) continue;

        details.push({
          type: 'column-local',
          x:
            -w * 0.5 +
            (col / (cols + 1)) * w,
          y:
            -h * 0.5 +
            (row / (rows + 1)) * h,
          r: 2.5 + rng() * 2.7,
        });
      }
    }
  }

  return {
    id: 'site:' + sx + ',' + sy,
    source: 'site',
    sx,
    sy,
    x: site.x,
    y: site.y,
    w,
    h,
    radius,
    angle,
    kind,
    major,
    shape,
    variant,
    vertices,
    aabb: polygonAabb(vertices),
    color: FLOOR_PALETTES[colorIndex],
    colorIndex,
    wallColor: WALL_COLOR,
    doors: [],
    details,
  };
}

function segmentIntersection(a, b, c, d) {
  const r = {
    x: b.x - a.x,
    y: b.y - a.y,
  };

  const s = {
    x: d.x - c.x,
    y: d.y - c.y,
  };

  const denominator =
    r.x * s.y - r.y * s.x;

  if (Math.abs(denominator) < 1e-9) {
    return null;
  }

  const qpx = c.x - a.x;
  const qpy = c.y - a.y;

  const t =
    (qpx * s.y - qpy * s.x) /
    denominator;

  const u =
    (qpx * r.y - qpy * r.x) /
    denominator;

  if (
    t < -1e-8 ||
    t > 1 + 1e-8 ||
    u < -1e-8 ||
    u > 1 + 1e-8
  ) {
    return null;
  }

  return {
    x: a.x + r.x * t,
    y: a.y + r.y * t,
    t,
    u,
  };
}

function rayToRoomBoundary(room, angle) {
  const origin = {
    x: room.x,
    y: room.y,
  };

  const far = {
    x:
      room.x +
      Math.cos(angle) *
        room.radius *
        4,
    y:
      room.y +
      Math.sin(angle) *
        room.radius *
        4,
  };

  let best = null;

  for (
    let edgeIndex = 0;
    edgeIndex < room.vertices.length;
    edgeIndex++
  ) {
    const a = room.vertices[edgeIndex];
    const b =
      room.vertices[
        (edgeIndex + 1) %
          room.vertices.length
      ];

    const hit = segmentIntersection(
      origin,
      far,
      a,
      b,
    );

    if (!hit || hit.t <= 1e-8) continue;

    if (!best || hit.t < best.rayT) {
      best = {
        x: hit.x,
        y: hit.y,
        edgeIndex,
        edgeT: hit.u,
        rayT: hit.t,
      };
    }
  }

  return best;
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

function segmentPolygonHits(a, b, room) {
  const hits = [];

  for (
    let edgeIndex = 0;
    edgeIndex < room.vertices.length;
    edgeIndex++
  ) {
    const p = room.vertices[edgeIndex];
    const q =
      room.vertices[
        (edgeIndex + 1) %
          room.vertices.length
      ];

    const hit = segmentIntersection(
      a,
      b,
      p,
      q,
    );

    if (!hit) continue;

    hits.push({
      x: hit.x,
      y: hit.y,
      segmentT: hit.t,
      edgeIndex,
      edgeT: hit.u,
    });
  }

  hits.sort(
    (left, right) =>
      left.segmentT -
      right.segmentT,
  );

  return hits;
}

export function roomsOverlap(roomA, roomB) {
  if (
    !aabbIntersects(
      roomA.aabb,
      roomB.aabb,
    )
  ) {
    return false;
  }

  for (
    let i = 0;
    i < roomA.vertices.length;
    i++
  ) {
    const a1 = roomA.vertices[i];
    const a2 =
      roomA.vertices[
        (i + 1) %
          roomA.vertices.length
      ];

    for (
      let j = 0;
      j < roomB.vertices.length;
      j++
    ) {
      const b1 = roomB.vertices[j];
      const b2 =
        roomB.vertices[
          (j + 1) %
            roomB.vertices.length
        ];

      const hit =
        segmentIntersection(
          a1,
          a2,
          b1,
          b2,
        );

      if (
        hit &&
        hit.t > 1e-6 &&
        hit.t < 1 - 1e-6 &&
        hit.u > 1e-6 &&
        hit.u < 1 - 1e-6
      ) {
        return true;
      }
    }
  }

  return (
    pointInPolygon(
      roomA.vertices[0],
      roomB.vertices,
    ) ||
    pointInPolygon(
      roomB.vertices[0],
      roomA.vertices,
    )
  );
}

function cloneRoom(room) {
  return {
    ...room,
    vertices: room.vertices.map((point) => ({
      x: point.x,
      y: point.y,
    })),
    aabb: { ...room.aabb },
    doors: [],
    details: room.details.map((detail) => ({
      ...detail,
    })),
  };
}

function addDoor(room, edgeIndex, edgeT, width) {
  if (
    edgeIndex < 0 ||
    edgeIndex >= room.vertices.length
  ) {
    return;
  }

  const a = room.vertices[edgeIndex];
  const b =
    room.vertices[
      (edgeIndex + 1) %
        room.vertices.length
    ];

  const edgeLength = Math.hypot(
    b.x - a.x,
    b.y - a.y,
  );

  if (edgeLength < 8) return;

  const half =
    Math.min(
      width * 0.5,
      edgeLength * 0.34,
    );

  const center =
    clamp(
      edgeT * edgeLength,
      half + 2,
      edgeLength - half - 2,
    );

  const normalized = center / edgeLength;

  for (const door of room.doors) {
    if (
      door.edgeIndex === edgeIndex &&
      Math.abs(door.t - normalized) *
        edgeLength <
        Math.max(door.width, width) * 0.6
    ) {
      door.width = Math.max(
        door.width,
        width,
      );
      return;
    }
  }

  room.doors.push({
    edgeIndex,
    t: normalized,
    width,
  });
}

function roomCircleClear(candidate, rooms, ignoreIds = new Set()) {
  for (const room of rooms) {
    if (ignoreIds.has(room.id)) continue;

    const distance = Math.hypot(
      candidate.x - room.x,
      candidate.y - room.y,
    );

    if (
      distance <
      candidate.radius + room.radius + 4
    ) {
      return false;
    }
  }

  return true;
}

function makeAttachedRoom(
  seed,
  sourceRoom,
  index,
) {
  const sx =
    sourceRoom.sx ?? hashString(sourceRoom.id);

  const sy =
    sourceRoom.sy ?? index;

  const rng = seededRng(
    hashInt(
      seed,
      sx,
      sy,
      5001 + index,
    ),
  );

  const profile = worldProfile(
    seed,
    sourceRoom.x,
    sourceRoom.y,
  );

  const sideChoices = [
    0,
    Math.PI / 2,
    Math.PI,
    -Math.PI / 2,
  ];

  const direction =
    sourceRoom.angle +
    sideChoices[
      hashInt(
        seed,
        sx,
        sy,
        5011 + index,
      ) % sideChoices.length
    ] +
    hashSigned(
      seed,
      sx,
      sy,
      5021 + index,
    ) *
      0.16;

  const kindRoll = rng();

  const kind =
    kindRoll < 0.28
      ? 'utility'
      : kindRoll < 0.58
        ? 'office'
        : kindRoll < 0.82
          ? 'side-room'
          : 'small-gallery';

  let w =
    kind === 'small-gallery'
      ? 74 + rng() * 64
      : 48 + rng() * 58;

  let h =
    kind === 'small-gallery'
      ? 38 + rng() * 34
      : 42 + rng() * 54;

  const maxRadius =
    Math.min(
      66,
      sourceRoom.radius *
        (
          0.52 +
          profile.scale * 0.12
        ),
    );

  let radius =
    Math.hypot(w, h) * 0.5;

  if (radius > maxRadius) {
    const scale =
      maxRadius / radius;

    w *= scale;
    h *= scale;
    radius = maxRadius;
  }

  const angle =
    Math.round(
      (
        sourceRoom.angle +
        hashSigned(
          seed,
          sx,
          sy,
          5031 + index,
        ) *
          0.34
      ) /
        (Math.PI / 12),
    ) *
    (Math.PI / 12);

  const shapeRoll = rng();

  const shape =
    shapeRoll < 0.13
      ? 'l'
      : shapeRoll < 0.24
        ? 'step'
        : 'rect';

  const variant =
    hashInt(
      seed,
      sx,
      sy,
      5041 + index,
    ) % 16;

  const localVertices =
    localShapeVertices(
      shape,
      w,
      h,
      variant,
    );

  const sourcePortal =
    rayToRoomBoundary(
      sourceRoom,
      direction,
    );

  if (!sourcePortal) {
    return null;
  }

  const provisionalVertices =
    transformVertices(
      localVertices,
      0,
      0,
      angle,
    );

  const provisional = {
    x: 0,
    y: 0,
    radius,
    vertices:
      provisionalVertices,
  };

  const reversePortal =
    rayToRoomBoundary(
      provisional,
      direction + Math.PI,
    );

  if (!reversePortal) {
    return null;
  }

  const candidateExtent =
    Math.hypot(
      reversePortal.x,
      reversePortal.y,
    );

  const sourceExtent =
    Math.hypot(
      sourcePortal.x -
        sourceRoom.x,
      sourcePortal.y -
        sourceRoom.y,
    );

  const gap =
    8 + rng() * 22;

  const centerDistance =
    sourceExtent +
    candidateExtent +
    gap;

  const x =
    sourceRoom.x +
    Math.cos(direction) *
      centerDistance;

  const y =
    sourceRoom.y +
    Math.sin(direction) *
      centerDistance;

  const vertices =
    transformVertices(
      localVertices,
      x,
      y,
      angle,
    );

  const colorIndex =
    hash01(
      seed,
      sx,
      sy,
      5051 + index,
    ) < 0.84
      ? sourceRoom.colorIndex
      : clamp(
          sourceRoom.colorIndex +
            (
              hash01(
                seed,
                sx,
                sy,
                5061 + index,
              ) < 0.5
                ? -1
                : 1
            ),
          0,
          4,
        );

  return {
    id:
      'attached:' +
      sourceRoom.id +
      ':' +
      index,
    source: 'attached',
    parentRoomId:
      sourceRoom.id,
    priority:
      hashInt(
        seed,
        sx,
        sy,
        5071 + index,
      ),
    x,
    y,
    w,
    h,
    radius,
    angle,
    kind,
    major: false,
    shape,
    variant,
    vertices,
    aabb:
      polygonAabb(vertices),
    color:
      FLOOR_PALETTES[
        colorIndex
      ],
    colorIndex,
    wallColor:
      WALL_COLOR,
    doors: [],
    details: [],
  };
}

function attachedRoomCandidates(
  seed,
  siteRooms,
) {
  const candidates = [];

  for (const room of siteRooms) {
    const profile =
      worldProfile(
        seed,
        room.x,
        room.y,
      );

    const roll =
      hash01(
        seed,
        room.sx,
        room.sy,
        5081,
      );

    let count = 0;

    if (
      roll <
      0.38 +
        profile.density * 0.38
    ) {
      count += 1;
    }

    if (
      hash01(
        seed,
        room.sx,
        room.sy,
        5082,
      ) <
      0.10 +
        profile.density * 0.20
    ) {
      count += 1;
    }

    if (
      room.major &&
      hash01(
        seed,
        room.sx,
        room.sy,
        5083,
      ) < 0.34
    ) {
      count += 1;
    }

    count = Math.min(count, 3);

    for (
      let index = 0;
      index < count;
      index++
    ) {
      const candidate =
        makeAttachedRoom(
          seed,
          room,
          index,
        );

      if (candidate) {
        candidates.push(
          candidate,
        );
      }
    }
  }

  candidates.sort(
    (a, b) => {
      if (
        a.priority !==
        b.priority
      ) {
        return (
          a.priority -
          b.priority
        );
      }

      return a.id.localeCompare(
        b.id,
      );
    },
  );

  return candidates;
}

function makeClusterChildRoom(
  seed,
  rootRoom,
  parentRoom,
  branchIndex,
  depth,
  attempt,
  heading,
) {
  const sx = rootRoom.sx;
  const sy = rootRoom.sy;

  const salt =
    5400 +
    branchIndex * 97 +
    depth * 13 +
    attempt;

  const rng = seededRng(
    hashInt(
      seed,
      sx * 31 + branchIndex,
      sy * 37 + depth,
      salt,
    ),
  );

  const profile = worldProfile(
    seed,
    parentRoom.x,
    parentRoom.y,
  );

  const kindRoll = rng();

  const kind =
    kindRoll < 0.16
      ? 'cluster-gallery'
      : kindRoll < 0.36
        ? 'cluster-cell'
        : kindRoll < 0.61
          ? 'cluster-suite'
          : kindRoll < 0.84
            ? 'cluster-room'
            : 'cluster-chamber';

  let w;
  let h;

  if (kind === 'cluster-gallery') {
    w = 72 + rng() * 78;
    h = 34 + rng() * 32;
  } else if (kind === 'cluster-cell') {
    w = 38 + rng() * 42;
    h = 34 + rng() * 38;
  } else if (kind === 'cluster-chamber') {
    w = 82 + rng() * 78;
    h = 68 + rng() * 72;
  } else if (kind === 'cluster-suite') {
    w = 58 + rng() * 68;
    h = 50 + rng() * 60;
  } else {
    w = 48 + rng() * 64;
    h = 44 + rng() * 56;
  }

  const maxRadius =
    54 +
    profile.scale * 18;

  let radius =
    Math.hypot(w, h) * 0.5;

  if (radius > maxRadius) {
    const scale =
      maxRadius / radius;

    w *= scale;
    h *= scale;
    radius = maxRadius;
  }

  const turn =
    hashSigned(
      seed,
      sx * 101 + branchIndex,
      sy * 103 + depth,
      5411 + attempt,
    ) *
    (
      0.18 +
      depth * 0.075
    );

  const direction =
    heading + turn;

  const angle =
    Math.round(
      (
        direction +
        hashSigned(
          seed,
          sx,
          sy,
          5421 +
            branchIndex * 17 +
            depth * 3 +
            attempt,
        ) *
          0.22
      ) /
        (Math.PI / 12),
    ) *
    (Math.PI / 12);

  const shapeRoll = rng();

  const shape =
    kind === 'cluster-chamber' &&
    shapeRoll < 0.22
      ? 'chamfer'
      : shapeRoll < 0.14
        ? 'l'
        : shapeRoll < 0.26
          ? 'step'
          : 'rect';

  const variant =
    hashInt(
      seed,
      sx + branchIndex,
      sy + depth,
      5431 + attempt,
    ) % 16;

  const localVertices =
    localShapeVertices(
      shape,
      w,
      h,
      variant,
    );

  const sourcePortal =
    rayToRoomBoundary(
      parentRoom,
      direction,
    );

  if (!sourcePortal) {
    return null;
  }

  const provisional = {
    x: 0,
    y: 0,
    radius,
    vertices:
      transformVertices(
        localVertices,
        0,
        0,
        angle,
      ),
  };

  const reversePortal =
    rayToRoomBoundary(
      provisional,
      direction + Math.PI,
    );

  if (!reversePortal) {
    return null;
  }

  const parentExtent =
    Math.hypot(
      sourcePortal.x -
        parentRoom.x,
      sourcePortal.y -
        parentRoom.y,
    );

  const childExtent =
    Math.hypot(
      reversePortal.x,
      reversePortal.y,
    );

  const gap =
    5 + rng() * 13;

  const centerDistance =
    parentExtent +
    childExtent +
    gap;

  const x =
    parentRoom.x +
    Math.cos(direction) *
      centerDistance;

  const y =
    parentRoom.y +
    Math.sin(direction) *
      centerDistance;

  const vertices =
    transformVertices(
      localVertices,
      x,
      y,
      angle,
    );

  const colorIndex =
    hash01(
      seed,
      sx * 43 + branchIndex,
      sy * 47 + depth,
      5441 + attempt,
    ) < 0.90
      ? rootRoom.colorIndex
      : clamp(
          rootRoom.colorIndex +
            (
              hash01(
                seed,
                sx,
                sy,
                5449 + branchIndex + depth,
              ) < 0.5
                ? -1
                : 1
            ),
          0,
          4,
        );

  return {
    id:
      'cluster:' +
      sx +
      ',' +
      sy +
      ':' +
      branchIndex +
      ':' +
      depth,
    source: 'cluster',
    rootSiteKey:
      siteKey(sx, sy),
    parentRoomId:
      parentRoom.id,
    priority:
      hashInt(
        seed,
        sx * 59 + branchIndex,
        sy * 61 + depth,
        5451,
      ),
    x,
    y,
    w,
    h,
    radius,
    angle,
    kind,
    major:
      kind === 'cluster-chamber',
    shape,
    variant,
    vertices,
    aabb:
      polygonAabb(vertices),
    color:
      FLOOR_PALETTES[
        colorIndex
      ],
    colorIndex,
    wallColor:
      WALL_COLOR,
    doors: [],
    details: [],
    heading: direction,
  };
}

function buildLocalClusters(
  seed,
  siteRooms,
) {
  const occupied = [
    ...siteRooms,
  ];

  const clusterRooms = [];
  const localLinks = [];
  const clusterBySite =
    new Map();

  for (const room of siteRooms) {
    clusterBySite.set(
      siteKey(room.sx, room.sy),
      [room],
    );
  }

  const orderedRoots =
    siteRooms
      .slice()
      .sort((a, b) => {
        const ap =
          hashInt(
            seed,
            a.sx,
            a.sy,
            5461,
          );

        const bp =
          hashInt(
            seed,
            b.sx,
            b.sy,
            5461,
          );

        if (ap !== bp) {
          return ap - bp;
        }

        if (a.sy !== b.sy) {
          return a.sy - b.sy;
        }

        return a.sx - b.sx;
      });

  for (const root of orderedRoots) {
    const profile =
      worldProfile(
        seed,
        root.x,
        root.y,
      );

    const baseAngle =
      valueNoise(
        seed,
        root.x,
        root.y,
        1200,
        5471,
      ) *
        TAU +
      hashSigned(
        seed,
        root.sx,
        root.sy,
        5472,
      ) *
        0.65;

    let branchCount =
      2 +
      (
        hash01(
          seed,
          root.sx,
          root.sy,
          5473,
        ) <
        0.34 +
          profile.density * 0.34
          ? 1
          : 0
      );

    if (
      root.major &&
      hash01(
        seed,
        root.sx,
        root.sy,
        5474,
      ) < 0.44
    ) {
      branchCount += 1;
    }

    branchCount =
      Math.min(
        branchCount,
        4,
      );

    for (
      let branchIndex = 0;
      branchIndex < branchCount;
      branchIndex++
    ) {
      let parent = root;

      const spread =
        TAU /
        branchCount;

      let heading =
        baseAngle +
        branchIndex * spread +
        hashSigned(
          seed,
          root.sx * 71 + branchIndex,
          root.sy * 73 - branchIndex,
          5481,
        ) *
          0.42;

      const depthCount =
        1 +
        (
          hash01(
            seed,
            root.sx * 79 + branchIndex,
            root.sy * 83,
            5482,
          ) <
          0.48 +
            profile.density * 0.30
            ? 1
            : 0
        ) +
        (
          hash01(
            seed,
            root.sx,
            root.sy + branchIndex,
            5483,
          ) <
          0.08 +
            profile.density * 0.12
            ? 1
            : 0
        );

      for (
        let depth = 0;
        depth < depthCount;
        depth++
      ) {
        let accepted = null;

        for (
          let attempt = 0;
          attempt < 3;
          attempt++
        ) {
          const candidate =
            makeClusterChildRoom(
              seed,
              root,
              parent,
              branchIndex,
              depth,
              attempt,
              heading +
                (
                  attempt === 0
                    ? 0
                    : (
                        attempt === 1
                          ? 0.46
                          : -0.46
                      )
                ),
            );

          if (
            candidate &&
            !roomsOverlap(
              candidate,
              parent,
            ) &&
            roomCircleClear(
              candidate,
              occupied,
              new Set([
                parent.id,
              ]),
            )
          ) {
            accepted =
              candidate;
            break;
          }
        }

        if (!accepted) {
          break;
        }

        clusterRooms.push(
          accepted,
        );

        occupied.push(
          accepted,
        );

        localLinks.push({
          fromRoomId:
            parent.id,
          toRoomId:
            accepted.id,
          key:
            'local:' +
            accepted.id,
        });

        clusterBySite.get(
          siteKey(
            root.sx,
            root.sy,
          ),
        ).push(accepted);

        parent = accepted;
        heading =
          accepted.heading;
      }
    }
  }

  return {
    rooms: clusterRooms,
    links: localLinks,
    clusterBySite,
  };
}

function closestClusterPair(
  clusterA,
  clusterB,
) {
  let best = null;

  for (const roomA of clusterA) {
    for (const roomB of clusterB) {
      const distance =
        Math.hypot(
          roomB.x - roomA.x,
          roomB.y - roomA.y,
        );

      const score =
        distance -
        (
          roomA.radius +
          roomB.radius
        ) *
          0.62;

      if (
        !best ||
        score < best.score
      ) {
        best = {
          roomA,
          roomB,
          score,
        };
      }
    }
  }

  return best;
}

function makeTransitionRoom(
  seed,
  key,
  index,
  center,
  angle,
  spacing,
  colorIndex,
) {
  const rng = seededRng(
    hashString(key + ':transition:' + index) ^ seed,
  );

  const w = clamp(
    spacing * (0.64 + rng() * 0.16),
    46,
    86,
  );

  const h = clamp(
    spacing * (0.50 + rng() * 0.14),
    40,
    70,
  );

  const shapeRoll = rng();

  const shape =
    shapeRoll < 0.12
      ? 'chamfer'
      : shapeRoll < 0.20
        ? 'step'
        : 'rect';

  const variant =
    hashInt(
      seed,
      index,
      hashString(key),
      5201,
    ) % 16;

  const localVertices = localShapeVertices(
    shape,
    w,
    h,
    variant,
  );

  const vertices = transformVertices(
    localVertices,
    center.x,
    center.y,
    angle,
  );

  return {
    id: 'transition:' + key + ':' + index,
    source: 'transition',
    x: center.x,
    y: center.y,
    w,
    h,
    radius: Math.hypot(w, h) * 0.5,
    angle,
    kind:
      index % 3 === 2
        ? 'junction-room'
        : 'transition-room',
    major: false,
    shape,
    variant,
    vertices,
    aabb: polygonAabb(vertices),
    color: FLOOR_PALETTES[colorIndex],
    colorIndex,
    wallColor: WALL_COLOR,
    doors: [],
    details: [],
  };
}

function connectorPolyline(seed, key, a, b, amount) {
  if (amount <= 0) {
    return [a, b];
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 30) {
    return [a, b];
  }

  const nx = -dy / distance;
  const ny = dx / distance;

  const signed =
    hashSigned(
      seed,
      hashString(key),
      0,
      5301,
    );

  const offset =
    signed *
    Math.min(
      amount,
      distance * 0.16,
    );

  return [
    a,
    {
      x: (a.x + b.x) * 0.5 + nx * offset,
      y: (a.y + b.y) * 0.5 + ny * offset,
    },
    b,
  ];
}

function connectionBetween(
  seed,
  roomA,
  roomB,
  key,
  primary,
  siteRooms,
) {
  const centerDistance = Math.hypot(
    roomB.x - roomA.x,
    roomB.y - roomA.y,
  );

  const baseAngle = Math.atan2(
    roomB.y - roomA.y,
    roomB.x - roomA.x,
  );

  const firstA = rayToRoomBoundary(
    roomA,
    baseAngle,
  );

  const firstB = rayToRoomBoundary(
    roomB,
    baseAngle + Math.PI,
  );

  if (!firstA || !firstB) {
    return {
      rooms: [],
      connectors: [],
      endpoints: [],
    };
  }

  const gap = Math.hypot(
    firstB.x - firstA.x,
    firstB.y - firstA.y,
  );

  const width =
    gap < 24
      ? 34
      : gap < 52
        ? 24 + (hashString(key) % 9)
        : primary
          ? 21 + (hashString(key) % 10)
          : 18 + (hashString(key + ':loop') % 9);

  const transitionCount =
    gap > 62
      ? clamp(
          Math.ceil(gap / 78) - 1,
          1,
          3,
        )
      : 0;

  const transitionRooms = [];
  const allForCollision = [
    ...siteRooms,
  ];

  for (
    let index = 0;
    index < transitionCount;
    index++
  ) {
    const t =
      (index + 1) /
      (transitionCount + 1);

    const center = {
      x:
        firstA.x +
        (firstB.x - firstA.x) * t,
      y:
        firstA.y +
        (firstB.y - firstA.y) * t,
    };

    const room = makeTransitionRoom(
      seed,
      key,
      index,
      center,
      baseAngle +
        hashSigned(
          seed,
          hashString(key),
          index,
          5302,
        ) *
          0.18,
      gap / (transitionCount + 1),
      (
        t < 0.5
          ? roomA.colorIndex
          : roomB.colorIndex
      ),
    );

    if (
      !roomsOverlap(
        room,
        roomA,
      ) &&
      !roomsOverlap(
        room,
        roomB,
      ) &&
      roomCircleClear(
        room,
        allForCollision,
        new Set([
          roomA.id,
          roomB.id,
        ]),
      )
    ) {
      transitionRooms.push(room);
      allForCollision.push(room);
    }
  }

  const chain = [
    roomA,
    ...transitionRooms,
    roomB,
  ];

  const connectors = [];
  const endpoints = [];

  for (
    let index = 0;
    index < chain.length - 1;
    index++
  ) {
    const left = chain[index];
    const right = chain[index + 1];

    const angle = Math.atan2(
      right.y - left.y,
      right.x - left.x,
    );

    const portalA = rayToRoomBoundary(
      left,
      angle,
    );

    const portalB = rayToRoomBoundary(
      right,
      angle + Math.PI,
    );

    if (!portalA || !portalB) continue;

    const segmentGap = Math.hypot(
      portalB.x - portalA.x,
      portalB.y - portalA.y,
    );

    const bendAmount =
      segmentGap > 45
        ? 10 +
          hash01(
            seed,
            hashString(key),
            index,
            5303,
          ) *
            18
        : 0;

    const points = connectorPolyline(
      seed,
      key + ':' + index,
      {
        x: portalA.x,
        y: portalA.y,
      },
      {
        x: portalB.x,
        y: portalB.y,
      },
      bendAmount,
    );

    connectors.push({
      id: key + ':connector:' + index,
      edgeKey: key,
      primary,
      fromRoomId: left.id,
      toRoomId: right.id,
      points,
      width,
      color:
        left.colorIndex === right.colorIndex
          ? left.color
          : FLOOR_PALETTES[
              Math.min(
                left.colorIndex,
                right.colorIndex,
              )
            ],
    });

    endpoints.push({
      roomId: left.id,
      edgeIndex: portalA.edgeIndex,
      edgeT: portalA.edgeT,
      width: width + 5,
    });

    endpoints.push({
      roomId: right.id,
      edgeIndex: portalB.edgeIndex,
      edgeT: portalB.edgeT,
      width: width + 5,
    });
  }

  return {
    rooms: transitionRooms,
    connectors,
    endpoints,
    centerDistance,
  };
}

function optionalEdges(seed, sx, sy, room) {
  ensureSeedCaches(seed);

  const cacheKey = siteKey(sx, sy);

  if (optionalEdgeCache.has(cacheKey)) {
    return optionalEdgeCache.get(cacheKey);
  }

  const profile = worldProfile(
    seed,
    room.x,
    room.y,
  );

  const parent = parentFor(seed, sx, sy);
  const out = [];

  for (
    const neighbor of
    acceptedNeighbors(seed, sx, sy, 3)
  ) {
    if (
      neighbor.sx < sx ||
      (
        neighbor.sx === sx &&
        neighbor.sy <= sy
      )
    ) {
      continue;
    }

    if (
      parent &&
      parent[0] === neighbor.sx &&
      parent[1] === neighbor.sy
    ) {
      continue;
    }

    const reverseParent = parentFor(
      seed,
      neighbor.sx,
      neighbor.sy,
    );

    if (
      reverseParent &&
      reverseParent[0] === sx &&
      reverseParent[1] === sy
    ) {
      continue;
    }

    if (
      neighbor.distance >
      SITE_GRID * 1.95
    ) {
      continue;
    }

    const roll =
      (
        mix32(
          hashString(
            edgeKey(
              sx,
              sy,
              neighbor.sx,
              neighbor.sy,
            ),
          ) ^
          seed ^
          0x55ab73,
        ) >>>
        0
      ) /
      4294967296;

    const threshold =
      0.055 +
      profile.loops * 0.105 +
      profile.density * 0.055;

    if (roll < threshold) {
      out.push([
        neighbor.sx,
        neighbor.sy,
      ]);
    }

    if (out.length >= 2) break;
  }

  optionalEdgeCache.set(cacheKey, out);
  return out;
}

function transformDetail(room, detail) {
  const c = Math.cos(room.angle);
  const s = Math.sin(room.angle);

  if (detail.type === 'column-local') {
    return {
      type: 'column',
      x:
        room.x +
        detail.x * c -
        detail.y * s,
      y:
        room.y +
        detail.x * s +
        detail.y * c,
      r: detail.r,
    };
  }

  return {
    type: 'partition',
    a: {
      x:
        room.x +
        detail.x1 * c -
        detail.y1 * s,
      y:
        room.y +
        detail.x1 * s +
        detail.y1 * c,
    },
    b: {
      x:
        room.x +
        detail.x2 * c -
        detail.y2 * s,
      y:
        room.y +
        detail.x2 * s +
        detail.y2 * c,
    },
  };
}

function expandedBounds(bounds, amount) {
  return {
    minX: bounds.minX - amount,
    maxX: bounds.maxX + amount,
    minY: bounds.minY - amount,
    maxY: bounds.maxY + amount,
  };
}

function connectorAabb(connector) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of connector.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const pad = connector.width * 0.5 + 6;

  return {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

export class InfiniteMapGenerator {
  constructor(seedText = 'backrooms-71') {
    this.roomCache = new Map();
    this.setSeed(seedText);
  }

  setSeed(seedText) {
    this.seedText = String(
      seedText || 'backrooms-71',
    );

    this.seed = hashString(
      'v' +
      GENERATOR_VERSION +
      ':' +
      this.seedText,
    );

    this.roomCache.clear();
  }

  getSiteRoom(sx, sy) {
    if (
      !isAcceptedSiteInternal(
        this.seed,
        sx,
        sy,
      )
    ) {
      return null;
    }

    const key = siteKey(sx, sy);

    if (this.roomCache.has(key)) {
      return this.roomCache.get(key);
    }

    const room = roomForSite(
      this.seed,
      sx,
      sy,
    );

    this.roomCache.set(key, room);

    return room;
  }

  query(bounds) {
    const support =
      expandedBounds(
        bounds,
        QUERY_HALO,
      );

    const minSX =
      Math.floor(
        support.minX / SITE_GRID,
      ) - SITE_PARENT_RADIUS;

    const maxSX =
      Math.floor(
        support.maxX / SITE_GRID,
      ) + SITE_PARENT_RADIUS;

    const minSY =
      Math.floor(
        support.minY / SITE_GRID,
      ) - SITE_PARENT_RADIUS;

    const maxSY =
      Math.floor(
        support.maxY / SITE_GRID,
      ) + SITE_PARENT_RADIUS;

    const siteRoomMap = new Map();

    for (
      let sy = minSY;
      sy <= maxSY;
      sy++
    ) {
      for (
        let sx = minSX;
        sx <= maxSX;
        sx++
      ) {
        const room =
          this.getSiteRoom(
            sx,
            sy,
          );

        if (!room) continue;

        if (
          aabbIntersects(
            room.aabb,
            expandedBounds(
              support,
              260,
            ),
          )
        ) {
          siteRoomMap.set(
            siteKey(sx, sy),
            room,
          );
        }
      }
    }

    const siteRooms = [
      ...siteRoomMap.values(),
    ];

    const localClusters =
      buildLocalClusters(
        this.seed,
        siteRooms,
      );

    const clusterRooms =
      localClusters.rooms;

    const clusterBySite =
      localClusters.clusterBySite;

    const localLinks =
      localClusters.links;

    const edgeMap = new Map();

    for (const room of siteRooms) {
      const sx = room.sx;
      const sy = room.sy;

      if (
        sx === undefined ||
        sy === undefined
      ) {
        continue;
      }

      const parent =
        parentFor(
          this.seed,
          sx,
          sy,
        );

      if (parent) {
        const key = edgeKey(
          sx,
          sy,
          parent[0],
          parent[1],
        );

        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            ax: sx,
            ay: sy,
            bx: parent[0],
            by: parent[1],
            primary: true,
          });
        }
      }

      for (
        const [nx, ny] of
        optionalEdges(
          this.seed,
          sx,
          sy,
          room,
        )
      ) {
        const key = edgeKey(
          sx,
          sy,
          nx,
          ny,
        );

        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            ax: sx,
            ay: sy,
            bx: nx,
            by: ny,
            primary: false,
          });
        }
      }
    }

    const allRooms = new Map();

    for (
      const room of [
        ...siteRooms,
        ...clusterRooms,
      ]
    ) {
      allRooms.set(
        room.id,
        cloneRoom(room),
      );
    }

    const connectors = [];
    const endpointRecords = [];
    const collisionRooms = [
      ...siteRooms,
      ...clusterRooms,
    ];

    // Local portal growth creates multi-room architectural masses before any
    // inter-site obligation is connected. Each accepted child is separated
    // from every other room and attached through an explicit short passage.
    for (
      const link of
      localLinks
    ) {
      const source =
        allRooms.get(
          link.fromRoomId,
        );

      const target =
        allRooms.get(
          link.toRoomId,
        );

      if (
        !source ||
        !target
      ) {
        continue;
      }

      const result =
        connectionBetween(
          this.seed,
          source,
          target,
          link.key,
          false,
          collisionRooms,
        );

      connectors.push(
        ...result.connectors,
      );

      endpointRecords.push(
        ...result.endpoints,
      );
    }

    for (const [key, edge] of edgeMap) {
      const centralA =
        this.getSiteRoom(
          edge.ax,
          edge.ay,
        );

      const centralB =
        this.getSiteRoom(
          edge.bx,
          edge.by,
        );

      if (
        !centralA ||
        !centralB
      ) {
        continue;
      }

      const pair =
        closestClusterPair(
          clusterBySite.get(
            siteKey(
              edge.ax,
              edge.ay,
            ),
          ) || [centralA],
          clusterBySite.get(
            siteKey(
              edge.bx,
              edge.by,
            ),
          ) || [centralB],
        );

      const roomA =
        pair.roomA;

      const roomB =
        pair.roomB;

      const edgeBounds = {
        minX:
          Math.min(
            roomA.aabb.minX,
            roomB.aabb.minX,
          ) - 160,
        maxX:
          Math.max(
            roomA.aabb.maxX,
            roomB.aabb.maxX,
          ) + 160,
        minY:
          Math.min(
            roomA.aabb.minY,
            roomB.aabb.minY,
          ) - 160,
        maxY:
          Math.max(
            roomA.aabb.maxY,
            roomB.aabb.maxY,
          ) + 160,
      };

      if (
        !aabbIntersects(
          edgeBounds,
          support,
        )
      ) {
        continue;
      }

      const result =
        connectionBetween(
          this.seed,
          roomA,
          roomB,
          key,
          edge.primary,
          collisionRooms,
        );

      for (
        const transitionRoom
        of result.rooms
      ) {
        collisionRooms.push(transitionRoom);
        if (
          !allRooms.has(
            transitionRoom.id,
          )
        ) {
          allRooms.set(
            transitionRoom.id,
            cloneRoom(
              transitionRoom,
            ),
          );
        }
      }

      connectors.push(
        ...result.connectors,
      );

      endpointRecords.push(
        ...result.endpoints,
      );
    }

    for (const record of endpointRecords) {
      const room =
        allRooms.get(
          record.roomId,
        );

      if (!room) continue;

      addDoor(
        room,
        record.edgeIndex,
        record.edgeT,
        record.width,
      );
    }

    const allRoomList = [
      ...allRooms.values(),
    ];

    // A connector that passes through an unrelated room becomes a real
    // architectural junction: connector walls are rendered below the room,
    // and explicit openings are cut where the path crosses the room boundary.
    for (const connector of connectors) {
      const excluded = new Set();

      for (
        let segmentIndex = 0;
        segmentIndex <
        connector.points.length - 1;
        segmentIndex++
      ) {
        const a =
          connector.points[
            segmentIndex
          ];

        const b =
          connector.points[
            segmentIndex + 1
          ];

        const segmentBounds = {
          minX:
            Math.min(a.x, b.x) -
            connector.width,
          maxX:
            Math.max(a.x, b.x) +
            connector.width,
          minY:
            Math.min(a.y, b.y) -
            connector.width,
          maxY:
            Math.max(a.y, b.y) +
            connector.width,
        };

        for (const room of allRoomList) {
          if (
            excluded.has(room.id) ||
            !aabbIntersects(
              room.aabb,
              segmentBounds,
            )
          ) {
            continue;
          }

          const hits =
            segmentPolygonHits(
              a,
              b,
              room,
            );

          if (hits.length < 2) {
            continue;
          }

          const first = hits[0];
          const last =
            hits[hits.length - 1];

          addDoor(
            room,
            first.edgeIndex,
            first.edgeT,
            connector.width + 5,
          );

          addDoor(
            room,
            last.edgeIndex,
            last.edgeT,
            connector.width + 5,
          );

          excluded.add(room.id);
        }
      }
    }

    const visible =
      expandedBounds(bounds, 120);

    const visibleRooms =
      allRoomList
        .filter((room) =>
          aabbIntersects(
            room.aabb,
            visible,
          ),
        )
        .map((room) => ({
          ...room,
          details: room.details.map(
            (detail) =>
              transformDetail(
                room,
                detail,
              ),
          ),
        }));

    const visibleConnectors =
      connectors.filter(
        (connector) =>
          aabbIntersects(
            connectorAabb(
              connector,
            ),
            visible,
          ),
      );

    const kinds = new Set(
      visibleRooms.map(
        (room) => room.kind,
      ),
    );

    return {
      rooms: visibleRooms,
      connectors: visibleConnectors,
      stats: {
        roomCount:
          visibleRooms.length,
        connectorCount:
          visibleConnectors.length,
        kinds: [...kinds],
      },
    };
  }
}
