export const GENERATOR_VERSION = 7;

export const FABRIC_CELL = 20;
export const FABRIC_CHUNK = 720;
export const MACRO_SIZE = 860;
export const QUERY_HALO = FABRIC_CHUNK;

const TAU = Math.PI * 2;
const WALL = '#625747';
const FLOOR_PALETTES = [
  '#ead29c', '#e6c98b', '#ecd5a8', '#dfc08b', '#e9d0a2',
  '#e5b6a8', '#b8c5d0', '#b9c998', '#dbc3b7', '#d8b47f'
];

const RASTER_N = FABRIC_CHUNK / FABRIC_CELL;
const PRIMITIVE_HALO = MACRO_SIZE * 1.8;

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
  const density = valueNoise(seed, x, y, 2400, 2001);
  const openness = valueNoise(seed, x, y, 1750, 2002);
  const scale = valueNoise(seed, x, y, 3200, 2003);
  const branch = valueNoise(seed, x, y, 2100, 2004);
  const chamber = valueNoise(seed, x, y, 2800, 2005);
  const turn = valueNoise(seed, x, y, 1450, 2006);

  return {
    density,
    openness,
    scale,
    branch,
    chamber,
    turn,
  };
}

function paletteIndexForWorld(seed, x, y) {
  const rare = valueNoise(seed, x, y, 2200, 3101);
  if (rare > 0.86) {
    return 5 + Math.floor(
      valueNoise(seed, x, y, 1600, 3102) * (FLOOR_PALETTES.length - 5),
    );
  }

  return Math.min(
    4,
    Math.floor(valueNoise(seed, x, y, 1300, 3103) * 5),
  );
}

function macroNode(seed, mx, my) {
  const jitter = MACRO_SIZE * 0.34;
  return {
    x: mx * MACRO_SIZE + MACRO_SIZE * 0.5 + hashSigned(seed, mx, my, 11) * jitter,
    y: my * MACRO_SIZE + MACRO_SIZE * 0.5 + hashSigned(seed, mx, my, 12) * jitter,
  };
}

function sign(v) {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

export function parentCell(seedText, mx, my) {
  const seed = hashString('v' + GENERATOR_VERSION + ':' + String(seedText));
  return parentFor(seed, mx, my);
}

function parentFor(seed, mx, my) {
  if (mx === 0 && my === 0) return null;
  if (mx === 0) return [0, my - sign(my)];
  if (my === 0) return [mx - sign(mx), 0];

  const roll = hash01(seed, mx, my, 21);
  if (roll < 0.52) return [mx - sign(mx), my - sign(my)];
  if (roll < 0.76) return [mx - sign(mx), my];
  return [mx, my - sign(my)];
}

function canonicalEdgeKey(ax, ay, bx, by) {
  if (ax < bx || (ax === bx && ay <= by)) {
    return ax + ',' + ay + '|' + bx + ',' + by;
  }
  return bx + ',' + by + '|' + ax + ',' + ay;
}

function edgeSeed(seed, ax, ay, bx, by, salt = 0) {
  return mix32(hashString(canonicalEdgeKey(ax, ay, bx, by)) ^ seed ^ salt);
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
    const nParent = parentFor(seed, nx, ny);
    if (
      (parent && parent[0] === nx && parent[1] === ny) ||
      (nParent && nParent[0] === mx && nParent[1] === my)
    ) {
      continue;
    }

    const keyHash = edgeSeed(seed, mx, my, nx, ny, salt);
    const chance = (keyHash >>> 0) / 4294967296;
    const threshold =
      salt === 103 || salt === 104 ? 0.09 : 0.12;

    if (chance < threshold) out.push([nx, ny]);
  }

  return out;
}

function routePolyline(seed, ax, ay, bx, by, salt) {
  const a = macroNode(seed, ax, ay);
  const b = macroNode(seed, bx, by);
  const rng = seededRng(edgeSeed(seed, ax, ay, bx, by, salt));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const tx = dx / dist;
  const ty = dy / dist;
  const nx = -ty;
  const ny = tx;
  const bends = 4 + Math.floor(rng() * 4);
  const points = [{ ...a }];

  let previousOffset = 0;

  for (let i = 1; i < bends; i++) {
    const t = i / bends;
    const envelope = Math.sin(Math.PI * t);
    const targetOffset =
      (rng() * 2 - 1) *
      MACRO_SIZE *
      (0.10 + rng() * 0.08) *
      envelope;

    previousOffset = previousOffset * 0.40 + targetOffset * 0.60;

    const tangentJitter = (rng() * 2 - 1) * MACRO_SIZE * 0.035;

    points.push({
      x: a.x + dx * t + nx * previousOffset + tx * tangentJitter,
      y: a.y + dy * t + ny * previousOffset + ty * tangentJitter,
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
    const pieces = Math.max(1, Math.ceil(len / localStep));

    for (let j = 0; j < pieces; j++) {
      const t = j / pieces;
      const angle = Math.atan2(dy, dx);
      out.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
        angle,
      });
    }
  }

  const last = points[points.length - 1];
  const before = points[Math.max(0, points.length - 2)];
  out.push({
    x: last.x,
    y: last.y,
    angle: Math.atan2(last.y - before.y, last.x - before.x),
  });

  return out;
}

function primitiveAabb(primitive) {
  if (primitive.shape === 'ellipse') {
    const r = Math.max(primitive.w, primitive.h) * 0.5;
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
  const ex = Math.abs(c) * hx + Math.abs(s) * hy;
  const ey = Math.abs(s) * hx + Math.abs(c) * hy;

  return {
    minX: primitive.x - ex,
    maxX: primitive.x + ex,
    minY: primitive.y - ey,
    maxY: primitive.y + ey,
  };
}

function makePrimitive(seed, idSeed, x, y, angle, w, h, kind, major = false, shape = 'rect') {
  const snapped = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
  const localAngle = snapped + hashSigned(seed, idSeed, 0, 7201) * 0.055;
  const primitive = {
    id: String(idSeed),
    x,
    y,
    angle: localAngle,
    w,
    h,
    kind,
    major,
    shape,
    detailSeed: mix32(idSeed ^ 0x78c13b),
  };
  primitive.aabb = primitiveAabb(primitive);
  return primitive;
}

function branchRooms(seed, start, baseAngle, branchSeed, profile, depth = 0) {
  const rng = seededRng(branchSeed);
  const out = [];
  let x = start.x;
  let y = start.y;
  let angle = baseAngle;
  const steps =
    2 +
    Math.floor(rng() * (1 + profile.branch * 2)) +
    (profile.density > 0.72 && rng() < 0.45 ? 1 : 0);

  for (let i = 0; i < steps; i++) {
    angle += (rng() - 0.5) * (0.50 + profile.turn * 0.65);

    if (rng() < 0.62) {
      angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    }

    const scale = 0.68 + profile.scale * 0.62;
    const major = rng() < (0.07 + profile.chamber * 0.10);
    const along = major
      ? (132 + rng() * 138) * scale
      : (78 + rng() * 92) * scale;
    const cross = major
      ? (98 + rng() * 112) * scale
      : (50 + rng() * 78) * scale;

    const idSeed = mix32(branchSeed ^ Math.imul(i + 1, 0x9e3779b1));
    const shape = major && rng() < 0.08 ? 'ellipse' : 'rect';

    const room = makePrimitive(
      seed,
      idSeed,
      x,
      y,
      angle,
      along,
      cross,
      major ? 'branch-chamber' : 'branch-room',
      major,
      shape,
    );
    out.push(room);

    const advance = along * (0.34 + rng() * 0.20);
    x += Math.cos(angle) * advance;
    y += Math.sin(angle) * advance;

    if (depth < 1 && i > 0 && rng() < 0.22 + profile.branch * 0.20) {
      const forkSide = rng() < 0.5 ? -1 : 1;
      const fork = branchRooms(
        seed,
        { x, y },
        angle + forkSide * (0.72 + rng() * 0.58),
        mix32(branchSeed ^ 0x5f356495 ^ i),
        profile,
        depth + 1,
      );
      out.push(...fork.slice(0, 3));
    }
  }

  return out;
}

function edgeFabric(seed, ax, ay, bx, by, salt, primary) {
  const eSeed = edgeSeed(seed, ax, ay, bx, by, salt);
  const polyline = routePolyline(seed, ax, ay, bx, by, salt);
  const routeSamples = resamplePolyline(
    polyline,
    primary ? 64 : 76,
    eSeed ^ 0x111ace,
  );

  const out = [];
  const rng = seededRng(eSeed ^ 0x7aa8b3);

  for (let i = 0; i < routeSamples.length; i++) {
    const p = routeSamples[i];
    const profile = fieldProfile(seed, p.x, p.y);
    const scale = 0.72 + profile.scale * 0.84;
    const major =
      i % (primary ? 4 : 5) === 0 ||
      rng() < 0.08 + profile.chamber * 0.12;

    let along;
    let cross;
    let kind;

    if (major) {
      along = (150 + rng() * 180) * scale;
      cross = (100 + rng() * 122) * scale;
      kind = 'chamber';
    } else {
      const roll = rng();

      if (roll < 0.22) {
        along = (120 + rng() * 130) * scale;
        cross = (45 + rng() * 42) * scale;
        kind = 'gallery';
      } else if (roll < 0.42) {
        along = (62 + rng() * 74) * scale;
        cross = (105 + rng() * 105) * scale;
        kind = 'transverse-room';
      } else {
        along = (88 + rng() * 110) * scale;
        cross = (58 + rng() * 88) * scale;
        kind = 'room';
      }
    }

    const idSeed = mix32(eSeed ^ Math.imul(i + 1, 0x27d4eb2d));
    const shape = major && rng() < 0.035 ? 'ellipse' : 'rect';

    out.push(
      makePrimitive(
        seed,
        idSeed,
        p.x,
        p.y,
        p.angle,
        along,
        cross,
        kind,
        major,
        shape,
      ),
    );

    const branchChance =
      (primary ? 0.18 : 0.12) +
      profile.branch * 0.18 +
      profile.density * 0.08;

    if (i > 0 && i < routeSamples.length - 1 && rng() < branchChance) {
      const side = rng() < 0.5 ? -1 : 1;
      const offsetAngle =
        p.angle +
        side *
          (0.72 + rng() * (0.72 + profile.turn * 0.55));

      const branch = branchRooms(
        seed,
        {
          x: p.x + Math.cos(offsetAngle) * cross * 0.18,
          y: p.y + Math.sin(offsetAngle) * cross * 0.18,
        },
        offsetAngle,
        mix32(idSeed ^ 0x6217aa2d),
        profile,
      );

      out.push(...branch);
    }

    if (
      major &&
      rng() < 0.26 + profile.density * 0.18
    ) {
      const side = rng() < 0.5 ? -1 : 1;
      const annexAngle = p.angle + side * Math.PI / 2;
      const annexCount = 1 + (rng() < 0.36 ? 1 : 0);

      for (let a = 0; a < annexCount; a++) {
        const aw = (70 + rng() * 105) * scale;
        const ah = (55 + rng() * 95) * scale;
        const distance = cross * 0.36 + ah * (0.30 + rng() * 0.18);

        out.push(
          makePrimitive(
            seed,
            mix32(idSeed ^ 0x44bb3311 ^ a),
            p.x + Math.cos(annexAngle) * distance,
            p.y + Math.sin(annexAngle) * distance,
            p.angle,
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

function localBurst(seed, mx, my) {
  const node = macroNode(seed, mx, my);
  const profile = fieldProfile(seed, node.x, node.y);
  const baseSeed = hashInt(seed, mx, my, 9901);
  const rng = seededRng(baseSeed);
  const out = [];

  const chains =
    1 +
    Math.floor(profile.density * 1.45) +
    (rng() < profile.branch * 0.32 ? 1 : 0);

  for (let c = 0; c < chains; c++) {
    const angle =
      rng() * TAU +
      hashSigned(seed, mx * 41 + c, my * 43 - c, 9902) * 0.35;

    const start = {
      x: node.x + Math.cos(angle) * (20 + rng() * 45),
      y: node.y + Math.sin(angle) * (20 + rng() * 45),
    };

    const branch = branchRooms(
      seed,
      start,
      angle,
      mix32(baseSeed ^ Math.imul(c + 1, 0x85ebca77)),
      profile,
    );

    out.push(...branch.slice(0, 3 + Math.floor(profile.density * 2)));
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
    // Root still receives ordinary architecture instead of a special visible hub.
    out.push(...localBurst(seed, mx, my));
  }

  out.push(...localBurst(seed, mx, my));

  for (const [nx, ny] of optionalLinks(seed, mx, my)) {
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

function pointInsidePrimitive(x, y, primitive) {
  const dx = x - primitive.x;
  const dy = y - primitive.y;
  const c = Math.cos(primitive.angle);
  const s = Math.sin(primitive.angle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;

  if (primitive.shape === 'ellipse') {
    const nx = lx / (primitive.w * 0.5);
    const ny = ly / (primitive.h * 0.5);
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

function wallSegments(occupied, stride, innerN, originX, originY) {
  const horizontal = [];
  const vertical = [];

  function isOn(ix, iy) {
    return occupied[iy * stride + ix] !== 0;
  }

  // inner cells live at [1..innerN] because a one-cell halo surrounds them.
  for (let iy = 1; iy <= innerN; iy++) {
    let runStart = null;

    for (let ix = 1; ix <= innerN; ix++) {
      const on = isOn(ix, iy);
      const topOff = !isOn(ix, iy - 1);

      if (on && topOff) {
        if (runStart === null) runStart = ix;
      } else if (runStart !== null) {
        horizontal.push({
          x1: originX + (runStart - 1) * FABRIC_CELL,
          y1: originY + (iy - 1) * FABRIC_CELL,
          x2: originX + (ix - 1) * FABRIC_CELL,
          y2: originY + (iy - 1) * FABRIC_CELL,
        });
        runStart = null;
      }
    }

    if (runStart !== null) {
      horizontal.push({
        x1: originX + (runStart - 1) * FABRIC_CELL,
        y1: originY + (iy - 1) * FABRIC_CELL,
        x2: originX + innerN * FABRIC_CELL,
        y2: originY + (iy - 1) * FABRIC_CELL,
      });
    }

    runStart = null;

    for (let ix = 1; ix <= innerN; ix++) {
      const on = isOn(ix, iy);
      const bottomOff = !isOn(ix, iy + 1);

      if (on && bottomOff) {
        if (runStart === null) runStart = ix;
      } else if (runStart !== null) {
        horizontal.push({
          x1: originX + (runStart - 1) * FABRIC_CELL,
          y1: originY + iy * FABRIC_CELL,
          x2: originX + (ix - 1) * FABRIC_CELL,
          y2: originY + iy * FABRIC_CELL,
        });
        runStart = null;
      }
    }

    if (runStart !== null) {
      horizontal.push({
        x1: originX + (runStart - 1) * FABRIC_CELL,
        y1: originY + iy * FABRIC_CELL,
        x2: originX + innerN * FABRIC_CELL,
        y2: originY + iy * FABRIC_CELL,
      });
    }
  }

  for (let ix = 1; ix <= innerN; ix++) {
    let runStart = null;

    for (let iy = 1; iy <= innerN; iy++) {
      const on = isOn(ix, iy);
      const leftOff = !isOn(ix - 1, iy);

      if (on && leftOff) {
        if (runStart === null) runStart = iy;
      } else if (runStart !== null) {
        vertical.push({
          x1: originX + (ix - 1) * FABRIC_CELL,
          y1: originY + (runStart - 1) * FABRIC_CELL,
          x2: originX + (ix - 1) * FABRIC_CELL,
          y2: originY + (iy - 1) * FABRIC_CELL,
        });
        runStart = null;
      }
    }

    if (runStart !== null) {
      vertical.push({
        x1: originX + (ix - 1) * FABRIC_CELL,
        y1: originY + (runStart - 1) * FABRIC_CELL,
        x2: originX + (ix - 1) * FABRIC_CELL,
        y2: originY + innerN * FABRIC_CELL,
      });
    }

    runStart = null;

    for (let iy = 1; iy <= innerN; iy++) {
      const on = isOn(ix, iy);
      const rightOff = !isOn(ix + 1, iy);

      if (on && rightOff) {
        if (runStart === null) runStart = iy;
      } else if (runStart !== null) {
        vertical.push({
          x1: originX + ix * FABRIC_CELL,
          y1: originY + (runStart - 1) * FABRIC_CELL,
          x2: originX + ix * FABRIC_CELL,
          y2: originY + (iy - 1) * FABRIC_CELL,
        });
        runStart = null;
      }
    }

    if (runStart !== null) {
      vertical.push({
        x1: originX + ix * FABRIC_CELL,
        y1: originY + (runStart - 1) * FABRIC_CELL,
        x2: originX + ix * FABRIC_CELL,
        y2: originY + innerN * FABRIC_CELL,
      });
    }
  }

  return horizontal.concat(vertical);
}

function compressFloors(occupied, stride, innerN, originX, originY, seed) {
  const floors = [];

  for (let iy = 1; iy <= innerN; iy++) {
    let runStart = null;
    let runColor = -1;

    for (let ix = 1; ix <= innerN + 1; ix++) {
      const on =
        ix <= innerN &&
        occupied[iy * stride + ix] !== 0;

      let color = -1;

      if (on) {
        const wx = originX + (ix - 0.5) * FABRIC_CELL;
        const wy = originY + (iy - 0.5) * FABRIC_CELL;
        color = paletteIndexForWorld(seed, wx, wy);
      }

      if (on && runStart === null) {
        runStart = ix;
        runColor = color;
      } else if (
        runStart !== null &&
        (!on || color !== runColor)
      ) {
        floors.push({
          x: originX + (runStart - 1) * FABRIC_CELL,
          y: originY + (iy - 1) * FABRIC_CELL,
          w: (ix - runStart) * FABRIC_CELL,
          h: FABRIC_CELL,
          color: FLOOR_PALETTES[runColor],
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

function makeDetails(seed, primitives, bounds) {
  const details = [];

  for (const primitive of primitives) {
    if (
      primitive.x < bounds.minX ||
      primitive.x > bounds.maxX ||
      primitive.y < bounds.minY ||
      primitive.y > bounds.maxY
    ) {
      continue;
    }

    const rng = seededRng(primitive.detailSeed);
    const area = primitive.w * primitive.h;

    if (area > 8500 && rng() < 0.42) {
      const axis = rng() < 0.5 ? 'x' : 'y';
      const t = 0.24 + rng() * 0.52;
      const gap = 12 + rng() * 24;
      const c = Math.cos(primitive.angle);
      const s = Math.sin(primitive.angle);

      let a1;
      let a2;
      let b1;
      let b2;

      if (axis === 'x') {
        const lx = -primitive.w * 0.5 + primitive.w * t;
        const hh = primitive.h * 0.5;

        function world(lxValue, lyValue) {
          return {
            x: primitive.x + lxValue * c - lyValue * s,
            y: primitive.y + lxValue * s + lyValue * c,
          };
        }

        a1 = world(lx, -hh);
        a2 = world(lx, -gap * 0.5);
        b1 = world(lx, gap * 0.5);
        b2 = world(lx, hh);
      } else {
        const ly = -primitive.h * 0.5 + primitive.h * t;
        const hw = primitive.w * 0.5;

        function world(lxValue, lyValue) {
          return {
            x: primitive.x + lxValue * c - lyValue * s,
            y: primitive.y + lxValue * s + lyValue * c,
          };
        }

        a1 = world(-hw, ly);
        a2 = world(-gap * 0.5, ly);
        b1 = world(gap * 0.5, ly);
        b2 = world(hw, ly);
      }

      details.push({
        type: 'partition',
        a1,
        a2,
        b1,
        b2,
      });
    }

    if (
      primitive.major &&
      area > 18000 &&
      rng() < 0.34
    ) {
      const cols = Math.max(1, Math.min(4, Math.floor(primitive.w / 70)));
      const rows = Math.max(1, Math.min(4, Math.floor(primitive.h / 70)));
      const c = Math.cos(primitive.angle);
      const s = Math.sin(primitive.angle);

      for (let ry = 1; ry <= rows; ry++) {
        for (let rx = 1; rx <= cols; rx++) {
          if (rng() > 0.72) continue;

          const lx =
            -primitive.w * 0.5 +
            (rx / (cols + 1)) * primitive.w;
          const ly =
            -primitive.h * 0.5 +
            (ry / (rows + 1)) * primitive.h;

          details.push({
            type: 'column',
            x: primitive.x + lx * c - ly * s,
            y: primitive.y + lx * s + ly * c,
            r: 2.2 + rng() * 2.8,
          });
        }
      }
    }
  }

  return details;
}

export class InfiniteMapGenerator {
  constructor(seedText = 'backrooms-71') {
    this.frame = 0;
    this.chunkCache = new Map();
    this.primitiveCache = new Map();
    this.setSeed(seedText);
  }

  setSeed(seedText) {
    this.seedText = String(seedText || 'backrooms-71');
    this.seed = hashString(
      'v' + GENERATOR_VERSION + ':' + this.seedText,
    );
    this.chunkCache.clear();
    this.primitiveCache.clear();
  }

  getMacroPrimitives(mx, my) {
    const key = primitiveKey(mx, my);
    const cached = this.primitiveCache.get(key);

    if (cached) {
      cached.used = this.frame;
      return cached.primitives;
    }

    const primitives = macroPrimitives(
      this.seed,
      mx,
      my,
    );

    this.primitiveCache.set(key, {
      primitives,
      used: this.frame,
    });

    return primitives;
  }

  collectPrimitives(bounds) {
    const minMX = Math.floor((bounds.minX - PRIMITIVE_HALO) / MACRO_SIZE) - 1;
    const maxMX = Math.floor((bounds.maxX + PRIMITIVE_HALO) / MACRO_SIZE) + 1;
    const minMY = Math.floor((bounds.minY - PRIMITIVE_HALO) / MACRO_SIZE) - 1;
    const maxMY = Math.floor((bounds.maxY + PRIMITIVE_HALO) / MACRO_SIZE) + 1;
    const expanded = {
      minX: bounds.minX - FABRIC_CELL,
      maxX: bounds.maxX + FABRIC_CELL,
      minY: bounds.minY - FABRIC_CELL,
      maxY: bounds.maxY + FABRIC_CELL,
    };
    const out = [];

    for (let my = minMY; my <= maxMY; my++) {
      for (let mx = minMX; mx <= maxMX; mx++) {
        const primitives = this.getMacroPrimitives(mx, my);

        for (const primitive of primitives) {
          if (aabbIntersects(primitive.aabb, expanded)) {
            out.push(primitive);
          }
        }
      }
    }

    return out;
  }

  getChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    const cached = this.chunkCache.get(key);

    if (cached) {
      cached.used = this.frame;
      return cached.geometry;
    }

    const originX = cx * FABRIC_CHUNK;
    const originY = cy * FABRIC_CHUNK;
    const bounds = {
      minX: originX,
      maxX: originX + FABRIC_CHUNK,
      minY: originY,
      maxY: originY + FABRIC_CHUNK,
    };

    const primitives = this.collectPrimitives(bounds);

    // One-cell halo makes chunk-edge wall decisions independent of query order.
    const innerN = RASTER_N;
    const stride = innerN + 2;
    const occupied = new Uint8Array(stride * stride);
    const rasterOriginX = originX - FABRIC_CELL;
    const rasterOriginY = originY - FABRIC_CELL;

    for (const primitive of primitives) {
      const minIX = clamp(
        Math.floor((primitive.aabb.minX - rasterOriginX) / FABRIC_CELL),
        0,
        stride - 1,
      );
      const maxIX = clamp(
        Math.ceil((primitive.aabb.maxX - rasterOriginX) / FABRIC_CELL),
        0,
        stride - 1,
      );
      const minIY = clamp(
        Math.floor((primitive.aabb.minY - rasterOriginY) / FABRIC_CELL),
        0,
        stride - 1,
      );
      const maxIY = clamp(
        Math.ceil((primitive.aabb.maxY - rasterOriginY) / FABRIC_CELL),
        0,
        stride - 1,
      );

      for (let iy = minIY; iy <= maxIY; iy++) {
        const wy =
          rasterOriginY +
          (iy + 0.5) * FABRIC_CELL;

        for (let ix = minIX; ix <= maxIX; ix++) {
          const index = iy * stride + ix;
          if (occupied[index]) continue;

          const wx =
            rasterOriginX +
            (ix + 0.5) * FABRIC_CELL;

          if (pointInsidePrimitive(wx, wy, primitive)) {
            occupied[index] = 1;
          }
        }
      }
    }

    let occupiedCount = 0;

    for (let iy = 1; iy <= innerN; iy++) {
      for (let ix = 1; ix <= innerN; ix++) {
        if (occupied[iy * stride + ix]) {
          occupiedCount++;
        }
      }
    }

    const geometry = {
      cx,
      cy,
      x: originX,
      y: originY,
      floors: compressFloors(
        occupied,
        stride,
        innerN,
        originX,
        originY,
        this.seed,
      ),
      walls: wallSegments(
        occupied,
        stride,
        innerN,
        originX,
        originY,
      ),
      details: makeDetails(
        this.seed,
        primitives,
        bounds,
      ),
      occupiedCount,
      cellCount: innerN * innerN,
      wallColor: WALL,
    };

    this.chunkCache.set(key, {
      geometry,
      used: this.frame,
    });

    return geometry;
  }

  query(bounds) {
    this.frame++;

    const minCX =
      Math.floor((bounds.minX - QUERY_HALO) / FABRIC_CHUNK);
    const maxCX =
      Math.floor((bounds.maxX + QUERY_HALO) / FABRIC_CHUNK);
    const minCY =
      Math.floor((bounds.minY - QUERY_HALO) / FABRIC_CHUNK);
    const maxCY =
      Math.floor((bounds.maxY + QUERY_HALO) / FABRIC_CHUNK);
    const chunks = [];

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        chunks.push(this.getChunk(cx, cy));
      }
    }

    if (this.chunkCache.size > 420) {
      this.pruneCache(this.chunkCache, 300);
    }
    if (this.primitiveCache.size > 620) {
      this.pruneCache(this.primitiveCache, 440);
    }

    return chunks;
  }

  pruneCache(cache, targetSize) {
    const entries = [...cache.entries()];
    entries.sort((a, b) => a[1].used - b[1].used);

    const removeCount = Math.max(
      0,
      entries.length - targetSize,
    );

    for (let i = 0; i < removeCount; i++) {
      cache.delete(entries[i][0]);
    }
  }
}
