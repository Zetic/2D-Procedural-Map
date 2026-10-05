export const GENERATOR_VERSION = 8;

export const FABRIC_CELL = 12;
export const FABRIC_CHUNK = 720;
export const MACRO_SIZE = 860;
export const QUERY_HALO = FABRIC_CHUNK;

const TAU = Math.PI * 2;
const WALL = '#625747';
const INTERIOR_WALL = '#75664f';
const FLOOR_PALETTES = [
  '#ead29c', '#e6c98b', '#ecd5a8', '#dfc08b', '#e9d0a2',
  '#e5b6a8', '#b8c5d0', '#b9c998', '#dbc3b7', '#d8b47f'
];

const RASTER_N = FABRIC_CHUNK / FABRIC_CELL;
const PRIMITIVE_HALO = MACRO_SIZE * 1.9;

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

function fieldProfile(seed, x, y) {
  return {
    density: valueNoise(seed, x, y, 2450, 2001),
    openness: valueNoise(seed, x, y, 1800, 2002),
    scale: valueNoise(seed, x, y, 3250, 2003),
    branch: valueNoise(seed, x, y, 2150, 2004),
    chamber: valueNoise(seed, x, y, 2850, 2005),
    turn: valueNoise(seed, x, y, 1500, 2006),
  };
}

function familyPalette(seed, familySeed, x, y) {
  const rare =
    ((mix32(familySeed ^ seed ^ 0x4d23b11) >>> 0) / 4294967296);

  if (rare < 0.085) {
    return 5 + (
      mix32(familySeed ^ 0x91ac771) %
      (FLOOR_PALETTES.length - 5)
    );
  }

  const regional =
    valueNoise(seed, x, y, 1900, 3103) * 0.56 +
    ((mix32(familySeed ^ 0x65b43e1) >>> 0) / 4294967296) * 0.44;

  return Math.min(4, Math.floor(regional * 5));
}

function nonZeroId(value) {
  const id = mix32(value >>> 0);
  return id === 0 ? 1 : id;
}

function macroNode(seed, mx, my) {
  const jitter = MACRO_SIZE * 0.34;
  return {
    x: mx * MACRO_SIZE +
      MACRO_SIZE * 0.5 +
      hashSigned(seed, mx, my, 11) * jitter,
    y: my * MACRO_SIZE +
      MACRO_SIZE * 0.5 +
      hashSigned(seed, mx, my, 12) * jitter,
  };
}

function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

export function parentCell(seedText, mx, my) {
  const seed = hashString(
    'v' + GENERATOR_VERSION + ':' + String(seedText),
  );
  return parentFor(seed, mx, my);
}

function parentFor(seed, mx, my) {
  if (mx === 0 && my === 0) return null;
  if (mx === 0) return [0, my - sign(my)];
  if (my === 0) return [mx - sign(mx), 0];

  const roll = hash01(seed, mx, my, 21);

  if (roll < 0.52) {
    return [mx - sign(mx), my - sign(my)];
  }
  if (roll < 0.76) {
    return [mx - sign(mx), my];
  }

  return [mx, my - sign(my)];
}

function canonicalEdgeKey(ax, ay, bx, by) {
  if (ax < bx || (ax === bx && ay <= by)) {
    return ax + ',' + ay + '|' + bx + ',' + by;
  }
  return bx + ',' + by + '|' + ax + ',' + ay;
}

function edgeSeed(seed, ax, ay, bx, by, salt = 0) {
  return mix32(
    hashString(canonicalEdgeKey(ax, ay, bx, by)) ^
    seed ^
    salt,
  );
}

function optionalLinks(seed, mx, my) {
  const candidates = [
    [mx + 1, my, 101],
    [mx, my + 1, 102],
    [mx + 1, my + 1, 103],
    [mx + 1, my - 1, 104],
  ];

  const out = [];

  for (const [nx, ny, salt] of candidates) {
    const parent = parentFor(seed, mx, my);
    const neighborParent = parentFor(seed, nx, ny);

    if (
      (parent && parent[0] === nx && parent[1] === ny) ||
      (
        neighborParent &&
        neighborParent[0] === mx &&
        neighborParent[1] === my
      )
    ) {
      continue;
    }

    const roll =
      (edgeSeed(seed, mx, my, nx, ny, salt) >>> 0) /
      4294967296;

    const threshold =
      salt === 103 || salt === 104 ? 0.10 : 0.13;

    if (roll < threshold) out.push([nx, ny]);
  }

  return out;
}

function routePolyline(seed, ax, ay, bx, by, salt) {
  const a = macroNode(seed, ax, ay);
  const b = macroNode(seed, bx, by);
  const rng = seededRng(
    edgeSeed(seed, ax, ay, bx, by, salt),
  );

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const tx = dx / dist;
  const ty = dy / dist;
  const nx = -ty;
  const ny = tx;

  const bends = 5 + Math.floor(rng() * 4);
  const points = [{ ...a }];
  let previousOffset = 0;

  for (let i = 1; i < bends; i++) {
    const t = i / bends;
    const envelope = Math.sin(Math.PI * t);
    const targetOffset =
      (rng() * 2 - 1) *
      MACRO_SIZE *
      (0.11 + rng() * 0.085) *
      envelope;

    previousOffset =
      previousOffset * 0.36 +
      targetOffset * 0.64;

    const tangentJitter =
      (rng() * 2 - 1) * MACRO_SIZE * 0.045;

    points.push({
      x:
        a.x +
        dx * t +
        nx * previousOffset +
        tx * tangentJitter,
      y:
        a.y +
        dy * t +
        ny * previousOffset +
        ty * tangentJitter,
    });
  }

  points.push({ ...b });
  return points;
}

function resamplePolyline(points, step, seedValue) {
  const rng = seededRng(seedValue);
  const out = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);

    if (len <= 1e-6) continue;

    const localStep = step * (0.82 + rng() * 0.30);
    const pieces = Math.max(
      1,
      Math.ceil(len / localStep),
    );

    for (let j = 0; j < pieces; j++) {
      const t = j / pieces;
      out.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
        angle: Math.atan2(dy, dx),
      });
    }
  }

  const last = points[points.length - 1];
  const before = points[Math.max(0, points.length - 2)];

  out.push({
    x: last.x,
    y: last.y,
    angle: Math.atan2(
      last.y - before.y,
      last.x - before.x,
    ),
  });

  return out;
}

function primitiveAabb(primitive) {
  if (primitive.shape === 'ellipse') {
    const r = Math.max(
      primitive.w,
      primitive.h,
    ) * 0.5;

    return {
      minX: primitive.x - r,
      maxX: primitive.x + r,
      minY: primitive.y - r,
      maxY: primitive.y + r,
    };
  }

  const c = Math.cos(primitive.angle);
  const s = Math.sin(primitive.angle);
  const hx = primitive.w * 0.5;
  const hy = primitive.h * 0.5;

  const ex =
    Math.abs(c) * hx +
    Math.abs(s) * hy;
  const ey =
    Math.abs(s) * hx +
    Math.abs(c) * hy;

  return {
    minX: primitive.x - ex,
    maxX: primitive.x + ex,
    minY: primitive.y - ey,
    maxY: primitive.y + ey,
  };
}

function makePrimitive(
  seed,
  idSeed,
  spaceId,
  familySeed,
  colorIndex,
  x,
  y,
  angle,
  w,
  h,
  kind,
  major = false,
  shape = 'rect',
) {
  const snapped =
    Math.round(angle / (Math.PI / 12)) *
    (Math.PI / 12);

  const primitive = {
    id: nonZeroId(idSeed),
    spaceId: nonZeroId(spaceId),
    familySeed: nonZeroId(familySeed),
    colorIndex,
    x,
    y,
    angle:
      snapped +
      hashSigned(seed, idSeed, spaceId, 7201) * 0.045,
    w,
    h,
    kind,
    major,
    shape,
    priority: mix32(
      idSeed ^
      spaceId ^
      familySeed ^
      0x38a4df71,
    ),
  };

  primitive.aabb = primitiveAabb(primitive);
  return primitive;
}

function spaceIdFor(baseSeed, group, salt) {
  return nonZeroId(
    baseSeed ^
    Math.imul(group + 1, 0x9e3779b1) ^
    salt,
  );
}

function branchRooms(
  seed,
  start,
  baseAngle,
  branchSeed,
  profile,
  familySeed,
  colorIndex,
  initialSpaceId,
  depth = 0,
) {
  const rng = seededRng(branchSeed);
  const out = [];

  let x = start.x;
  let y = start.y;
  let angle = baseAngle;

  const steps =
    2 +
    Math.floor(rng() * (1 + profile.branch * 2)) +
    (
      profile.density > 0.72 &&
      rng() < 0.45
        ? 1
        : 0
    );

  for (let i = 0; i < steps; i++) {
    angle +=
      (rng() - 0.5) *
      (0.50 + profile.turn * 0.65);

    if (rng() < 0.64) {
      angle =
        Math.round(angle / (Math.PI / 12)) *
        (Math.PI / 12);
    }

    const scale =
      0.68 + profile.scale * 0.62;

    const major =
      rng() <
      (0.07 + profile.chamber * 0.10);

    const along = major
      ? (132 + rng() * 138) * scale
      : (78 + rng() * 92) * scale;

    const cross = major
      ? (98 + rng() * 112) * scale
      : (50 + rng() * 78) * scale;

    const idSeed = mix32(
      branchSeed ^
      Math.imul(i + 1, 0x9e3779b1),
    );

    const group =
      i === 0
        ? -1
        : Math.floor((i - 1) / 2);

    const spaceId =
      i === 0
        ? initialSpaceId
        : spaceIdFor(
            branchSeed,
            group,
            0x41bf27d,
          );

    const shape =
      major && rng() < 0.06
        ? 'ellipse'
        : 'rect';

    const room = makePrimitive(
      seed,
      idSeed,
      spaceId,
      familySeed,
      colorIndex,
      x,
      y,
      angle,
      along,
      cross,
      major
        ? 'branch-chamber'
        : 'branch-room',
      major,
      shape,
    );

    out.push(room);

    const advance =
      along * (0.34 + rng() * 0.20);

    x += Math.cos(angle) * advance;
    y += Math.sin(angle) * advance;

    if (
      depth < 1 &&
      i > 0 &&
      rng() <
        0.18 + profile.branch * 0.18
    ) {
      const side = rng() < 0.5 ? -1 : 1;
      const forkAngle =
        angle +
        side *
          (0.72 + rng() * 0.58);

      const fork = branchRooms(
        seed,
        { x, y },
        forkAngle,
        mix32(branchSeed ^ 0x5f356495 ^ i),
        profile,
        familySeed,
        colorIndex,
        room.spaceId,
        depth + 1,
      );

      out.push(...fork.slice(0, 3));
    }
  }

  return out;
}

function edgeFabric(
  seed,
  ax,
  ay,
  bx,
  by,
  salt,
  primary,
) {
  const familySeed = edgeSeed(
    seed,
    ax,
    ay,
    bx,
    by,
    salt,
  );

  const polyline = routePolyline(
    seed,
    ax,
    ay,
    bx,
    by,
    salt,
  );

  const routeSamples = resamplePolyline(
    polyline,
    primary ? 64 : 76,
    familySeed ^ 0x111ace,
  );

  const midpoint = routeSamples[
    Math.floor(routeSamples.length * 0.5)
  ];

  const colorIndex = familyPalette(
    seed,
    familySeed,
    midpoint.x,
    midpoint.y,
  );

  const out = [];
  const rng = seededRng(
    familySeed ^ 0x7aa8b3,
  );

  const groupSpan =
    1 +
    (
      mix32(familySeed ^ 0x35aa07) % 3
    );

  for (
    let i = 0;
    i < routeSamples.length;
    i++
  ) {
    const point = routeSamples[i];
    const profile = fieldProfile(
      seed,
      point.x,
      point.y,
    );

    const scale =
      0.72 + profile.scale * 0.84;

    const major =
      i % (primary ? 4 : 5) === 0 ||
      rng() <
        0.08 + profile.chamber * 0.12;

    let along;
    let cross;
    let kind;

    if (major) {
      along =
        (150 + rng() * 180) * scale;
      cross =
        (100 + rng() * 122) * scale;
      kind = 'chamber';
    } else {
      const roll = rng();

      if (roll < 0.22) {
        along =
          (120 + rng() * 130) * scale;
        cross =
          (45 + rng() * 42) * scale;
        kind = 'gallery';
      } else if (roll < 0.42) {
        along =
          (62 + rng() * 74) * scale;
        cross =
          (105 + rng() * 105) * scale;
        kind = 'transverse-room';
      } else {
        along =
          (88 + rng() * 110) * scale;
        cross =
          (58 + rng() * 88) * scale;
        kind = 'room';
      }
    }

    // Primary events must overlap physically. Global connectivity is carried
    // by ordinary rooms and chambers, never a separate corridor layer.
    along = Math.max(
      along,
      primary ? 94 : 84,
    );

    const idSeed = mix32(
      familySeed ^
      Math.imul(i + 1, 0x27d4eb2d),
    );

    const spaceId = spaceIdFor(
      familySeed,
      Math.floor(i / groupSpan),
      0x55c13bd,
    );

    const shape =
      major && rng() < 0.035
        ? 'ellipse'
        : 'rect';

    const room = makePrimitive(
      seed,
      idSeed,
      spaceId,
      familySeed,
      colorIndex,
      point.x,
      point.y,
      point.angle,
      along,
      cross,
      kind,
      major,
      shape,
    );

    out.push(room);

    const branchChance =
      (primary ? 0.18 : 0.12) +
      profile.branch * 0.18 +
      profile.density * 0.08;

    if (
      i > 0 &&
      i < routeSamples.length - 1 &&
      rng() < branchChance
    ) {
      const side =
        rng() < 0.5 ? -1 : 1;

      const branchAngle =
        point.angle +
        side *
          (
            0.72 +
            rng() *
              (0.72 + profile.turn * 0.55)
          );

      const branch = branchRooms(
        seed,
        {
          x:
            point.x +
            Math.cos(branchAngle) *
              cross *
              0.18,
          y:
            point.y +
            Math.sin(branchAngle) *
              cross *
              0.18,
        },
        branchAngle,
        mix32(idSeed ^ 0x6217aa2d),
        profile,
        familySeed,
        colorIndex,
        room.spaceId,
      );

      out.push(...branch);
    }

    if (
      major &&
      rng() <
        0.23 + profile.density * 0.16
    ) {
      const side =
        rng() < 0.5 ? -1 : 1;

      const annexAngle =
        point.angle + side * Math.PI / 2;

      const annexCount =
        1 + (rng() < 0.34 ? 1 : 0);

      for (
        let annexIndex = 0;
        annexIndex < annexCount;
        annexIndex++
      ) {
        const aw =
          (70 + rng() * 105) * scale;
        const ah =
          (55 + rng() * 95) * scale;

        const distance =
          cross * 0.36 +
          ah * (0.30 + rng() * 0.18);

        const annexId = mix32(
          idSeed ^
          0x44bb3311 ^
          annexIndex,
        );

        const annexSpace = spaceIdFor(
          idSeed,
          annexIndex,
          0x7da4f9,
        );

        out.push(
          makePrimitive(
            seed,
            annexId,
            annexSpace,
            familySeed,
            colorIndex,
            point.x +
              Math.cos(annexAngle) *
                distance,
            point.y +
              Math.sin(annexAngle) *
                distance,
            point.angle,
            aw,
            ah,
            'annex',
            false,
          ),
        );
      }
    }
  }

  return out;
}

function rootBurst(seed) {
  const node = macroNode(seed, 0, 0);
  const profile = fieldProfile(
    seed,
    node.x,
    node.y,
  );

  const familySeed = hashInt(
    seed,
    0,
    0,
    9901,
  );

  const colorIndex = familyPalette(
    seed,
    familySeed,
    node.x,
    node.y,
  );

  const rng = seededRng(familySeed);
  const out = [];

  const chains =
    2 +
    Math.floor(profile.density * 2);

  for (let chain = 0; chain < chains; chain++) {
    const angle =
      rng() * TAU +
      hashSigned(
        seed,
        chain * 41,
        -chain * 43,
        9902,
      ) *
        0.35;

    const start = {
      x:
        node.x +
        Math.cos(angle) *
          (20 + rng() * 45),
      y:
        node.y +
        Math.sin(angle) *
          (20 + rng() * 45),
    };

    const initialSpace = spaceIdFor(
      familySeed,
      chain,
      0x33a7bf,
    );

    const branch = branchRooms(
      seed,
      start,
      angle,
      mix32(
        familySeed ^
        Math.imul(chain + 1, 0x85ebca77),
      ),
      profile,
      familySeed,
      colorIndex,
      initialSpace,
    );

    out.push(...branch);
  }

  return out;
}

function macroPrimitives(seed, mx, my) {
  const out = [];
  const parent = parentFor(seed, mx, my);

  if (parent) {
    out.push(
      ...edgeFabric(
        seed,
        mx,
        my,
        parent[0],
        parent[1],
        4001,
        true,
      ),
    );
  } else {
    out.push(...rootBurst(seed));
  }

  for (
    const [nx, ny] of
    optionalLinks(seed, mx, my)
  ) {
    out.push(
      ...edgeFabric(
        seed,
        mx,
        my,
        nx,
        ny,
        5001,
        false,
      ),
    );
  }

  return out;
}

function aabbIntersects(a, b) {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

function pointInsidePrimitive(
  x,
  y,
  primitive,
) {
  const dx = x - primitive.x;
  const dy = y - primitive.y;
  const c = Math.cos(primitive.angle);
  const s = Math.sin(primitive.angle);

  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;

  if (primitive.shape === 'ellipse') {
    const nx =
      lx / (primitive.w * 0.5);
    const ny =
      ly / (primitive.h * 0.5);

    return nx * nx + ny * ny <= 1;
  }

  return (
    Math.abs(lx) <= primitive.w * 0.5 &&
    Math.abs(ly) <= primitive.h * 0.5
  );
}

function chunkKey(cx, cy) {
  return cx + ',' + cy;
}

function primitiveKey(mx, my) {
  return mx + ',' + my;
}

function vertexKey(x, y) {
  return x + ',' + y;
}

function addDirectedSegment(
  segments,
  x1,
  y1,
  x2,
  y2,
) {
  segments.push({ x1, y1, x2, y2 });
}

function distancePointToSegment(
  point,
  a,
  b,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (
    Math.abs(dx) < 1e-9 &&
    Math.abs(dy) < 1e-9
  ) {
    return Math.hypot(
      point.x - a.x,
      point.y - a.y,
    );
  }

  const t = clamp(
    (
      (point.x - a.x) * dx +
      (point.y - a.y) * dy
    ) /
      (dx * dx + dy * dy),
    0,
    1,
  );

  const px = a.x + dx * t;
  const py = a.y + dy * t;

  return Math.hypot(
    point.x - px,
    point.y - py,
  );
}

function simplifyOpenPath(
  points,
  tolerance,
) {
  if (points.length <= 2) {
    return points.slice();
  }

  let maxDistance = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (
    let i = 1;
    i < points.length - 1;
    i++
  ) {
    const distance =
      distancePointToSegment(
        points[i],
        first,
        last,
      );

    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [first, last];
  }

  const left = simplifyOpenPath(
    points.slice(0, maxIndex + 1),
    tolerance,
  );

  const right = simplifyOpenPath(
    points.slice(maxIndex),
    tolerance,
  );

  return left
    .slice(0, left.length - 1)
    .concat(right);
}

function simplifyPath(
  points,
  tolerance,
) {
  if (points.length <= 3) {
    return points.slice();
  }

  const first = points[0];
  const last = points[points.length - 1];

  const closed =
    Math.abs(first.x - last.x) < 1e-6 &&
    Math.abs(first.y - last.y) < 1e-6;

  if (!closed) {
    return simplifyOpenPath(
      points,
      tolerance,
    );
  }

  const ring = points.slice(
    0,
    points.length - 1,
  );

  if (ring.length <= 3) {
    return points.slice();
  }

  const split =
    Math.floor(ring.length * 0.5);

  const firstHalf = simplifyOpenPath(
    ring.slice(0, split + 1),
    tolerance,
  );

  const secondHalf = simplifyOpenPath(
    ring
      .slice(split)
      .concat([ring[0]]),
    tolerance,
  );

  const simplified = firstHalf
    .slice(0, firstHalf.length - 1)
    .concat(secondHalf);

  const start = simplified[0];
  const end =
    simplified[simplified.length - 1];

  if (
    Math.abs(start.x - end.x) > 1e-6 ||
    Math.abs(start.y - end.y) > 1e-6
  ) {
    simplified.push({ ...start });
  }

  return simplified;
}

function stitchDirectedSegments(
  segments,
) {
  const outgoing = new Map();
  const incomingCount = new Map();

  for (
    let index = 0;
    index < segments.length;
    index++
  ) {
    const segment = segments[index];

    const startKey = vertexKey(
      segment.x1,
      segment.y1,
    );

    const endKey = vertexKey(
      segment.x2,
      segment.y2,
    );

    if (!outgoing.has(startKey)) {
      outgoing.set(startKey, []);
    }

    outgoing.get(startKey).push(index);

    incomingCount.set(
      endKey,
      (incomingCount.get(endKey) || 0) + 1,
    );
  }

  const used = new Uint8Array(
    segments.length,
  );

  const paths = [];

  function walk(startIndex) {
    const firstSegment =
      segments[startIndex];

    const path = [
      {
        x: firstSegment.x1,
        y: firstSegment.y1,
      },
    ];

    let currentIndex = startIndex;
    let guard = 0;

    while (
      currentIndex !== undefined &&
      !used[currentIndex] &&
      guard++ < segments.length + 4
    ) {
      used[currentIndex] = 1;

      const segment =
        segments[currentIndex];

      const end = {
        x: segment.x2,
        y: segment.y2,
      };

      path.push(end);

      const endKey = vertexKey(
        end.x,
        end.y,
      );

      const candidates =
        outgoing.get(endKey) || [];

      let nextIndex;

      for (const candidate of candidates) {
        if (!used[candidate]) {
          nextIndex = candidate;
          break;
        }
      }

      currentIndex = nextIndex;
    }

    return path;
  }

  for (
    let index = 0;
    index < segments.length;
    index++
  ) {
    if (used[index]) continue;

    const segment = segments[index];
    const startKey = vertexKey(
      segment.x1,
      segment.y1,
    );

    if (
      (incomingCount.get(startKey) || 0) === 0
    ) {
      paths.push(walk(index));
    }
  }

  for (
    let index = 0;
    index < segments.length;
    index++
  ) {
    if (!used[index]) {
      paths.push(walk(index));
    }
  }

  return paths;
}

function collectExteriorPaths(
  occupied,
  stride,
  innerN,
  originX,
  originY,
) {
  const segments = [];

  function on(ix, iy) {
    return occupied[iy * stride + ix] !== 0;
  }

  for (
    let iy = 1;
    iy <= innerN;
    iy++
  ) {
    for (
      let ix = 1;
      ix <= innerN;
      ix++
    ) {
      if (!on(ix, iy)) continue;

      const x0 =
        originX +
        (ix - 1) * FABRIC_CELL;

      const y0 =
        originY +
        (iy - 1) * FABRIC_CELL;

      const x1 = x0 + FABRIC_CELL;
      const y1 = y0 + FABRIC_CELL;

      if (!on(ix, iy - 1)) {
        addDirectedSegment(
          segments,
          x0,
          y0,
          x1,
          y0,
        );
      }

      if (!on(ix + 1, iy)) {
        addDirectedSegment(
          segments,
          x1,
          y0,
          x1,
          y1,
        );
      }

      if (!on(ix, iy + 1)) {
        addDirectedSegment(
          segments,
          x1,
          y1,
          x0,
          y1,
        );
      }

      if (!on(ix - 1, iy)) {
        addDirectedSegment(
          segments,
          x0,
          y1,
          x0,
          y0,
        );
      }
    }
  }

  return stitchDirectedSegments(
    segments,
  )
    .filter((path) => path.length >= 2)
    .map((path) =>
      simplifyPath(
        path,
        FABRIC_CELL * 0.52,
      ),
    );
}

function pairKey(a, b) {
  return a < b
    ? a + ':' + b
    : b + ':' + a;
}

function stitchUndirectedSegments(
  segments,
) {
  const adjacency = new Map();

  for (
    let index = 0;
    index < segments.length;
    index++
  ) {
    const segment = segments[index];

    const aKey = vertexKey(
      segment.x1,
      segment.y1,
    );

    const bKey = vertexKey(
      segment.x2,
      segment.y2,
    );

    if (!adjacency.has(aKey)) {
      adjacency.set(aKey, []);
    }

    if (!adjacency.has(bKey)) {
      adjacency.set(bKey, []);
    }

    adjacency.get(aKey).push(index);
    adjacency.get(bKey).push(index);
  }

  const used = new Uint8Array(
    segments.length,
  );

  const paths = [];

  function walk(
    startIndex,
    startX,
    startY,
  ) {
    const path = [
      { x: startX, y: startY },
    ];

    let currentIndex = startIndex;
    let currentX = startX;
    let currentY = startY;
    let guard = 0;

    while (
      currentIndex !== undefined &&
      !used[currentIndex] &&
      guard++ < segments.length + 4
    ) {
      used[currentIndex] = 1;

      const segment =
        segments[currentIndex];

      const forward =
        Math.abs(segment.x1 - currentX) < 1e-6 &&
        Math.abs(segment.y1 - currentY) < 1e-6;

      const nextX =
        forward
          ? segment.x2
          : segment.x1;

      const nextY =
        forward
          ? segment.y2
          : segment.y1;

      path.push({
        x: nextX,
        y: nextY,
      });

      const nextKey = vertexKey(
        nextX,
        nextY,
      );

      const candidates =
        adjacency.get(nextKey) || [];

      let nextIndex;

      for (const candidate of candidates) {
        if (!used[candidate]) {
          nextIndex = candidate;
          break;
        }
      }

      currentX = nextX;
      currentY = nextY;
      currentIndex = nextIndex;
    }

    return path;
  }

  for (
    let index = 0;
    index < segments.length;
    index++
  ) {
    if (used[index]) continue;

    const segment = segments[index];

    const aKey = vertexKey(
      segment.x1,
      segment.y1,
    );

    const bKey = vertexKey(
      segment.x2,
      segment.y2,
    );

    const aDegree =
      (adjacency.get(aKey) || []).length;

    const bDegree =
      (adjacency.get(bKey) || []).length;

    if (aDegree === 1 || bDegree === 1) {
      const startFromA =
        aDegree === 1;

      paths.push(
        walk(
          index,
          startFromA
            ? segment.x1
            : segment.x2,
          startFromA
            ? segment.y1
            : segment.y2,
        ),
      );
    }
  }

  for (
    let index = 0;
    index < segments.length;
    index++
  ) {
    if (used[index]) continue;

    const segment = segments[index];

    paths.push(
      walk(
        index,
        segment.x1,
        segment.y1,
      ),
    );
  }

  return paths;
}

function polylineLength(points) {
  let total = 0;

  for (
    let i = 0;
    i < points.length - 1;
    i++
  ) {
    total += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    );
  }

  return total;
}

function subtractGapIntervals(
  points,
  gaps,
) {
  const out = [];

  let cursor = 0;

  for (
    let i = 0;
    i < points.length - 1;
    i++
  ) {
    const a = points[i];
    const b = points[i + 1];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    if (length <= 1e-6) continue;

    const segmentStart = cursor;
    const segmentEnd =
      cursor + length;

    let visible = [
      [segmentStart, segmentEnd],
    ];

    for (const gap of gaps) {
      const nextVisible = [];

      for (
        const interval of visible
      ) {
        const left = interval[0];
        const right = interval[1];

        if (
          gap.end <= left ||
          gap.start >= right
        ) {
          nextVisible.push(interval);
          continue;
        }

        if (gap.start > left) {
          nextVisible.push([
            left,
            Math.min(gap.start, right),
          ]);
        }

        if (gap.end < right) {
          nextVisible.push([
            Math.max(gap.end, left),
            right,
          ]);
        }
      }

      visible = nextVisible;
    }

    for (
      const [left, right] of visible
    ) {
      if (right - left < 1.5) continue;

      const t0 =
        (left - segmentStart) / length;

      const t1 =
        (right - segmentStart) / length;

      out.push({
        x1: a.x + dx * t0,
        y1: a.y + dy * t0,
        x2: a.x + dx * t1,
        y2: a.y + dy * t1,
      });
    }

    cursor = segmentEnd;
  }

  return out;
}

function collectInteriorWalls(
  seed,
  occupied,
  owner,
  stride,
  innerN,
  originX,
  originY,
) {
  const pairSegments = new Map();

  function addPairSegment(
    ownerA,
    ownerB,
    x1,
    y1,
    x2,
    y2,
  ) {
    if (
      ownerA === 0 ||
      ownerB === 0 ||
      ownerA === ownerB
    ) {
      return;
    }

    const key = pairKey(
      ownerA,
      ownerB,
    );

    if (!pairSegments.has(key)) {
      pairSegments.set(key, []);
    }

    pairSegments.get(key).push({
      x1,
      y1,
      x2,
      y2,
      ownerA: Math.min(ownerA, ownerB),
      ownerB: Math.max(ownerA, ownerB),
    });
  }

  for (
    let iy = 1;
    iy <= innerN;
    iy++
  ) {
    for (
      let ix = 1;
      ix <= innerN;
      ix++
    ) {
      const index = iy * stride + ix;

      if (!occupied[index]) continue;

      const currentOwner =
        owner[index];

      const x0 =
        originX +
        (ix - 1) * FABRIC_CELL;

      const y0 =
        originY +
        (iy - 1) * FABRIC_CELL;

      const x1 = x0 + FABRIC_CELL;
      const y1 = y0 + FABRIC_CELL;

      const rightIndex =
        iy * stride + (ix + 1);

      if (
        occupied[rightIndex] &&
        owner[rightIndex] !== currentOwner
      ) {
        addPairSegment(
          currentOwner,
          owner[rightIndex],
          x1,
          y0,
          x1,
          y1,
        );
      }

      const bottomIndex =
        (iy + 1) * stride + ix;

      if (
        occupied[bottomIndex] &&
        owner[bottomIndex] !== currentOwner
      ) {
        addPairSegment(
          currentOwner,
          owner[bottomIndex],
          x0,
          y1,
          x1,
          y1,
        );
      }
    }
  }

  const walls = [];

  for (
    const [key, segments]
    of pairSegments
  ) {
    if (!segments.length) continue;

    const [
      ownerA,
      ownerB,
    ] = key
      .split(':')
      .map((value) => Number(value));

    const pairSeed = mix32(
      seed ^
      ownerA ^
      Math.imul(ownerB, 0x9e3779b1),
    );

    const paths =
      stitchUndirectedSegments(
        segments,
      );

    for (
      let pathIndex = 0;
      pathIndex < paths.length;
      pathIndex++
    ) {
      const simplified =
        simplifyPath(
          paths[pathIndex],
          FABRIC_CELL * 0.32,
        );

      const totalLength =
        polylineLength(simplified);

      if (totalLength < 16) {
        continue;
      }

      const localSeed = mix32(
        pairSeed ^
        Math.imul(
          pathIndex + 1,
          0x85ebca77,
        ),
      );

      const local01 =
        (localSeed >>> 0) /
        4294967296;

      // Very short boundaries usually represent spaces that should read as
      // one compound room, so the wall is omitted entirely.
      if (
        totalLength < 34 &&
        local01 < 0.58
      ) {
        continue;
      }

      const gaps = [];

      const gapCount =
        totalLength > 150 &&
        ((mix32(localSeed ^ 0x771ac) >>> 0) /
          4294967296) <
          0.32
          ? 2
          : 1;

      for (
        let gapIndex = 0;
        gapIndex < gapCount;
        gapIndex++
      ) {
        const gapSeed = mix32(
          localSeed ^
          Math.imul(
            gapIndex + 1,
            0xc2b2ae3d,
          ),
        );

        const wide =
          ((gapSeed >>> 0) /
            4294967296) >
          0.78;

        const gapWidth = clamp(
          (wide ? 32 : 15) +
            (
              mix32(gapSeed ^ 0x215ab) %
              (wide ? 34 : 18)
            ),
          12,
          Math.min(
            wide ? 70 : 38,
            totalLength * 0.42,
          ),
        );

        const baseFraction =
          gapCount === 1
            ? 0.5
            : (
                gapIndex === 0
                  ? 0.34
                  : 0.66
              );

        const jitter =
          hashSigned(
            seed,
            ownerA + gapIndex,
            ownerB - gapIndex,
            8101,
          ) *
          0.10;

        const center =
          totalLength *
          clamp(
            baseFraction + jitter,
            0.18,
            0.82,
          );

        gaps.push({
          start:
            center -
            gapWidth * 0.5,
          end:
            center +
            gapWidth * 0.5,
        });
      }

      walls.push(
        ...subtractGapIntervals(
          simplified,
          gaps,
        ),
      );
    }
  }

  return walls;
}

function compressFloors(
  occupied,
  colorGrid,
  stride,
  innerN,
  originX,
  originY,
) {
  const floors = [];

  for (
    let iy = 1;
    iy <= innerN;
    iy++
  ) {
    let runStart = null;
    let runColor = -1;

    for (
      let ix = 1;
      ix <= innerN + 1;
      ix++
    ) {
      const index =
        iy * stride + ix;

      const on =
        ix <= innerN &&
        occupied[index] !== 0;

      const color =
        on
          ? colorGrid[index] - 1
          : -1;

      if (
        on &&
        runStart === null
      ) {
        runStart = ix;
        runColor = color;
      } else if (
        runStart !== null &&
        (
          !on ||
          color !== runColor
        )
      ) {
        floors.push({
          x:
            originX +
            (runStart - 1) *
              FABRIC_CELL,
          y:
            originY +
            (iy - 1) *
              FABRIC_CELL,
          w:
            (ix - runStart) *
            FABRIC_CELL,
          h: FABRIC_CELL,
          color:
            FLOOR_PALETTES[
              clamp(
                runColor,
                0,
                FLOOR_PALETTES.length - 1,
              )
            ],
        });

        if (on) {
          runStart = ix;
          runColor = color;
        } else {
          runStart = null;
          runColor = -1;
        }
      }
    }
  }

  return floors;
}

function collectSpaceStats(
  owner,
  stride,
  innerN,
) {
  const stats = new Map();

  for (
    let iy = 1;
    iy <= innerN;
    iy++
  ) {
    for (
      let ix = 1;
      ix <= innerN;
      ix++
    ) {
      const id =
        owner[iy * stride + ix];

      if (!id) continue;

      let stat = stats.get(id);

      if (!stat) {
        stat = {
          id,
          count: 0,
          minX: ix,
          maxX: ix,
          minY: iy,
          maxY: iy,
        };

        stats.set(id, stat);
      }

      stat.count += 1;
      stat.minX =
        Math.min(stat.minX, ix);
      stat.maxX =
        Math.max(stat.maxX, ix);
      stat.minY =
        Math.min(stat.minY, iy);
      stat.maxY =
        Math.max(stat.maxY, iy);
    }
  }

  return stats;
}

function longestOwnerRunVertical(
  owner,
  stride,
  id,
  ix,
  minY,
  maxY,
) {
  let bestStart = null;
  let bestEnd = null;
  let currentStart = null;

  for (
    let iy = minY;
    iy <= maxY + 1;
    iy++
  ) {
    const on =
      iy <= maxY &&
      owner[iy * stride + ix] === id;

    if (on && currentStart === null) {
      currentStart = iy;
    } else if (
      !on &&
      currentStart !== null
    ) {
      const end = iy - 1;

      if (
        bestStart === null ||
        end - currentStart >
          bestEnd - bestStart
      ) {
        bestStart = currentStart;
        bestEnd = end;
      }

      currentStart = null;
    }
  }

  return bestStart === null
    ? null
    : [bestStart, bestEnd];
}

function longestOwnerRunHorizontal(
  owner,
  stride,
  id,
  iy,
  minX,
  maxX,
) {
  let bestStart = null;
  let bestEnd = null;
  let currentStart = null;

  for (
    let ix = minX;
    ix <= maxX + 1;
    ix++
  ) {
    const on =
      ix <= maxX &&
      owner[iy * stride + ix] === id;

    if (on && currentStart === null) {
      currentStart = ix;
    } else if (
      !on &&
      currentStart !== null
    ) {
      const end = ix - 1;

      if (
        bestStart === null ||
        end - currentStart >
          bestEnd - bestStart
      ) {
        bestStart = currentStart;
        bestEnd = end;
      }

      currentStart = null;
    }
  }

  return bestStart === null
    ? null
    : [bestStart, bestEnd];
}

function buildSpaceDetails(
  seed,
  owner,
  stride,
  innerN,
  originX,
  originY,
) {
  const details = [];

  const stats =
    collectSpaceStats(
      owner,
      stride,
      innerN,
    );

  for (
    const stat of stats.values()
  ) {
    const worldArea =
      stat.count *
      FABRIC_CELL *
      FABRIC_CELL;

    if (worldArea < 3200) {
      continue;
    }

    const rng = seededRng(
      hashInt(
        seed,
        stat.id,
        stat.count,
        9101,
      ),
    );

    if (
      worldArea > 6500 &&
      rng() < 0.30
    ) {
      const vertical =
        rng() < 0.5;

      if (vertical) {
        const ix = clamp(
          Math.round(
            stat.minX +
            (stat.maxX - stat.minX) *
              (0.32 + rng() * 0.36),
          ),
          stat.minX,
          stat.maxX,
        );

        const run =
          longestOwnerRunVertical(
            owner,
            stride,
            stat.id,
            ix,
            stat.minY,
            stat.maxY,
          );

        if (
          run &&
          run[1] - run[0] >= 4
        ) {
          const x =
            originX +
            (ix - 0.5) *
              FABRIC_CELL;

          const y1 =
            originY +
            (run[0] - 1) *
              FABRIC_CELL;

          const y2 =
            originY +
            run[1] *
              FABRIC_CELL;

          const gap =
            14 + rng() * 20;

          const center =
            y1 +
            (y2 - y1) *
              (0.42 + rng() * 0.16);

          details.push({
            type: 'partition',
            a1: { x, y: y1 },
            a2: {
              x,
              y: center - gap * 0.5,
            },
            b1: {
              x,
              y: center + gap * 0.5,
            },
            b2: { x, y: y2 },
          });
        }
      } else {
        const iy = clamp(
          Math.round(
            stat.minY +
            (stat.maxY - stat.minY) *
              (0.32 + rng() * 0.36),
          ),
          stat.minY,
          stat.maxY,
        );

        const run =
          longestOwnerRunHorizontal(
            owner,
            stride,
            stat.id,
            iy,
            stat.minX,
            stat.maxX,
          );

        if (
          run &&
          run[1] - run[0] >= 4
        ) {
          const y =
            originY +
            (iy - 0.5) *
              FABRIC_CELL;

          const x1 =
            originX +
            (run[0] - 1) *
              FABRIC_CELL;

          const x2 =
            originX +
            run[1] *
              FABRIC_CELL;

          const gap =
            14 + rng() * 20;

          const center =
            x1 +
            (x2 - x1) *
              (0.42 + rng() * 0.16);

          details.push({
            type: 'partition',
            a1: { x: x1, y },
            a2: {
              x: center - gap * 0.5,
              y,
            },
            b1: {
              x: center + gap * 0.5,
              y,
            },
            b2: { x: x2, y },
          });
        }
      }
    }

    if (
      worldArea > 14000 &&
      rng() < 0.30
    ) {
      const cols = clamp(
        Math.floor(
          (stat.maxX - stat.minX + 1) /
          6,
        ),
        1,
        4,
      );

      const rows = clamp(
        Math.floor(
          (stat.maxY - stat.minY + 1) /
          6,
        ),
        1,
        4,
      );

      for (
        let row = 1;
        row <= rows;
        row++
      ) {
        for (
          let col = 1;
          col <= cols;
          col++
        ) {
          if (rng() > 0.72) {
            continue;
          }

          const ix = Math.round(
            stat.minX +
            (
              col /
              (cols + 1)
            ) *
              (
                stat.maxX -
                stat.minX
              ),
          );

          const iy = Math.round(
            stat.minY +
            (
              row /
              (rows + 1)
            ) *
              (
                stat.maxY -
                stat.minY
              ),
          );

          if (
            owner[iy * stride + ix] !==
            stat.id
          ) {
            continue;
          }

          details.push({
            type: 'column',
            x:
              originX +
              (ix - 0.5) *
                FABRIC_CELL,
            y:
              originY +
              (iy - 0.5) *
                FABRIC_CELL,
            r: 2.2 + rng() * 2.8,
          });
        }
      }
    }
  }

  return {
    details,
    spaceCount: stats.size,
  };
}

export class InfiniteMapGenerator {
  constructor(
    seedText = 'backrooms-71',
  ) {
    this.frame = 0;
    this.chunkCache = new Map();
    this.primitiveCache = new Map();
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

    this.chunkCache.clear();
    this.primitiveCache.clear();
  }

  getMacroPrimitives(mx, my) {
    const key = primitiveKey(mx, my);

    const cached =
      this.primitiveCache.get(key);

    if (cached) {
      cached.used = this.frame;
      return cached.primitives;
    }

    const primitives =
      macroPrimitives(
        this.seed,
        mx,
        my,
      );

    this.primitiveCache.set(
      key,
      {
        primitives,
        used: this.frame,
      },
    );

    return primitives;
  }

  collectPrimitives(bounds) {
    const minMX =
      Math.floor(
        (
          bounds.minX -
          PRIMITIVE_HALO
        ) /
          MACRO_SIZE,
      ) - 1;

    const maxMX =
      Math.floor(
        (
          bounds.maxX +
          PRIMITIVE_HALO
        ) /
          MACRO_SIZE,
      ) + 1;

    const minMY =
      Math.floor(
        (
          bounds.minY -
          PRIMITIVE_HALO
        ) /
          MACRO_SIZE,
      ) - 1;

    const maxMY =
      Math.floor(
        (
          bounds.maxY +
          PRIMITIVE_HALO
        ) /
          MACRO_SIZE,
      ) + 1;

    const expanded = {
      minX:
        bounds.minX - FABRIC_CELL,
      maxX:
        bounds.maxX + FABRIC_CELL,
      minY:
        bounds.minY - FABRIC_CELL,
      maxY:
        bounds.maxY + FABRIC_CELL,
    };

    const out = [];

    for (
      let my = minMY;
      my <= maxMY;
      my++
    ) {
      for (
        let mx = minMX;
        mx <= maxMX;
        mx++
      ) {
        const primitives =
          this.getMacroPrimitives(
            mx,
            my,
          );

        for (
          const primitive of primitives
        ) {
          if (
            aabbIntersects(
              primitive.aabb,
              expanded,
            )
          ) {
            out.push(primitive);
          }
        }
      }
    }

    return out;
  }

  getChunk(cx, cy) {
    const key = chunkKey(cx, cy);

    const cached =
      this.chunkCache.get(key);

    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }

    const originX =
      cx * FABRIC_CHUNK;

    const originY =
      cy * FABRIC_CHUNK;

    const bounds = {
      minX: originX,
      maxX:
        originX + FABRIC_CHUNK,
      minY: originY,
      maxY:
        originY + FABRIC_CHUNK,
    };

    const primitives =
      this.collectPrimitives(bounds);

    const innerN = RASTER_N;
    const stride = innerN + 2;

    const occupied =
      new Uint8Array(
        stride * stride,
      );

    const owner =
      new Uint32Array(
        stride * stride,
      );

    const colorGrid =
      new Uint8Array(
        stride * stride,
      );

    const priorityGrid =
      new Uint32Array(
        stride * stride,
      );

    priorityGrid.fill(0xffffffff);

    const rasterOriginX =
      originX - FABRIC_CELL;

    const rasterOriginY =
      originY - FABRIC_CELL;

    for (
      const primitive of primitives
    ) {
      const minIX = clamp(
        Math.floor(
          (
            primitive.aabb.minX -
            rasterOriginX
          ) /
            FABRIC_CELL,
        ),
        0,
        stride - 1,
      );

      const maxIX = clamp(
        Math.ceil(
          (
            primitive.aabb.maxX -
            rasterOriginX
          ) /
            FABRIC_CELL,
        ),
        0,
        stride - 1,
      );

      const minIY = clamp(
        Math.floor(
          (
            primitive.aabb.minY -
            rasterOriginY
          ) /
            FABRIC_CELL,
        ),
        0,
        stride - 1,
      );

      const maxIY = clamp(
        Math.ceil(
          (
            primitive.aabb.maxY -
            rasterOriginY
          ) /
            FABRIC_CELL,
        ),
        0,
        stride - 1,
      );

      for (
        let iy = minIY;
        iy <= maxIY;
        iy++
      ) {
        const wy =
          rasterOriginY +
          (iy + 0.5) *
            FABRIC_CELL;

        for (
          let ix = minIX;
          ix <= maxIX;
          ix++
        ) {
          const wx =
            rasterOriginX +
            (ix + 0.5) *
              FABRIC_CELL;

          if (
            !pointInsidePrimitive(
              wx,
              wy,
              primitive,
            )
          ) {
            continue;
          }

          const index =
            iy * stride + ix;

          occupied[index] = 1;

          if (
            primitive.priority <
            priorityGrid[index]
          ) {
            priorityGrid[index] =
              primitive.priority;

            owner[index] =
              primitive.spaceId;

            colorGrid[index] =
              primitive.colorIndex + 1;
          }
        }
      }
    }

    let occupiedCount = 0;

    for (
      let iy = 1;
      iy <= innerN;
      iy++
    ) {
      for (
        let ix = 1;
        ix <= innerN;
        ix++
      ) {
        if (
          occupied[
            iy * stride + ix
          ]
        ) {
          occupiedCount++;
        }
      }
    }

    const detailData =
      buildSpaceDetails(
        this.seed,
        owner,
        stride,
        innerN,
        originX,
        originY,
      );

    const geometry = {
      cx,
      cy,
      x: originX,
      y: originY,
      floors: compressFloors(
        occupied,
        colorGrid,
        stride,
        innerN,
        originX,
        originY,
      ),
      exteriorPaths:
        collectExteriorPaths(
          occupied,
          stride,
          innerN,
          originX,
          originY,
        ),
      interiorWalls:
        collectInteriorWalls(
          this.seed,
          occupied,
          owner,
          stride,
          innerN,
          originX,
          originY,
        ),
      details: detailData.details,
      occupiedCount,
      cellCount:
        innerN * innerN,
      spaceCount:
        detailData.spaceCount,
      wallColor: WALL,
      interiorWallColor:
        INTERIOR_WALL,
    };

    this.chunkCache.set(
      key,
      {
        geometry,
        used: this.frame,
      },
    );

    return geometry;
  }

  query(bounds) {
    this.frame++;

    const minCX = Math.floor(
      (
        bounds.minX -
        QUERY_HALO
      ) /
        FABRIC_CHUNK,
    );

    const maxCX = Math.floor(
      (
        bounds.maxX +
        QUERY_HALO
      ) /
        FABRIC_CHUNK,
    );

    const minCY = Math.floor(
      (
        bounds.minY -
        QUERY_HALO
      ) /
        FABRIC_CHUNK,
    );

    const maxCY = Math.floor(
      (
        bounds.maxY +
        QUERY_HALO
      ) /
        FABRIC_CHUNK,
    );

    const chunks = [];

    for (
      let cy = minCY;
      cy <= maxCY;
      cy++
    ) {
      for (
        let cx = minCX;
        cx <= maxCX;
        cx++
      ) {
        chunks.push(
          this.getChunk(cx, cy),
        );
      }
    }

    if (
      this.chunkCache.size > 360
    ) {
      this.pruneCache(
        this.chunkCache,
        250,
      );
    }

    if (
      this.primitiveCache.size > 620
    ) {
      this.pruneCache(
        this.primitiveCache,
        440,
      );
    }

    return chunks;
  }

  pruneCache(
    cache,
    targetSize,
  ) {
    const entries = [
      ...cache.entries(),
    ];

    entries.sort(
      (a, b) =>
        a[1].used -
        b[1].used,
    );

    const removeCount =
      Math.max(
        0,
        entries.length -
          targetSize,
      );

    for (
      let i = 0;
      i < removeCount;
      i++
    ) {
      cache.delete(
        entries[i][0],
      );
    }
  }
}
