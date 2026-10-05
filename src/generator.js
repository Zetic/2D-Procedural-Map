export const GENERATOR_VERSION = 9;

export const FABRIC_CELL = 15;
export const FABRIC_CHUNK = 900;
export const MACRO_SIZE = 560;
export const QUERY_HALO = FABRIC_CELL * 2;

const TAU = Math.PI * 2;
const WALL = '#625747';
const INTERIOR_WALL = '#75664f';
const FLOOR_PALETTES = [
  '#ead29c', '#e6c98b', '#ecd5a8', '#dfc08b', '#e9d0a2',
  '#e5b6a8', '#b8c5d0', '#b9c998', '#dbc3b7', '#d8b47f'
];

const RASTER_N = FABRIC_CHUNK / FABRIC_CELL;
const PRIMITIVE_HALO = 2100;
const SITE_GRID = MACRO_SIZE;
const SITE_MIN_DISTANCE = 495;
const SITE_NEIGHBOR_RADIUS = 2;
const SITE_PARENT_RADIUS = 5;
const MERGE_RADIUS = 265;
const INFILL_GRID = 150;

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
  const regional =
    valueNoise(seed, x, y, 1900, 3103) * 0.62 +
    ((mix32(familySeed ^ 0x65b43e1) >>> 0) / 4294967296) * 0.38;

  return Math.min(4, Math.floor(regional * 5));
}

function spacePalette(seed, familySeed, spaceId, x, y, commonColor) {
  // Rare colors belong to compact spatial regions, not whole hidden edges.
  // This prevents a pink/blue/green section from revealing connectivity.
  const rareField = valueNoise(seed, x, y, 1250, 3114);

  if (rareField > 0.82) {
    const rareBand = valueNoise(seed, x, y, 2100, 3115);
    const rareIndex =
      5 +
      Math.min(
        FLOOR_PALETTES.length - 6,
        Math.floor(
          rareBand *
            (FLOOR_PALETTES.length - 5),
        ),
      );

    return rareIndex;
  }

  // Occasional cream-family variation follows spaces rather than raster rows.
  const variation =
    ((mix32(spaceId ^ familySeed ^ 0x4ca91d) >>> 0) / 4294967296);

  if (variation < 0.14) {
    return Math.min(
      4,
      Math.max(
        0,
        commonColor + (variation < 0.07 ? -1 : 1),
      ),
    );
  }

  return commonColor;
}

function nonZeroId(value) {
  const id = mix32(value >>> 0);
  return id === 0 ? 1 : id;
}

function siteCandidate(seed, sx, sy) {
  const root = sx === 0 && sy === 0;
  const jitter = SITE_GRID * 0.44;

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

function isAcceptedSite(seed, sx, sy) {
  const candidate =
    siteCandidate(seed, sx, sy);

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

      const other =
        siteCandidate(
          seed,
          sx + ox,
          sy + oy,
        );

      const dx =
        other.x - candidate.x;
      const dy =
        other.y - candidate.y;

      if (
        dx * dx + dy * dy >=
        SITE_MIN_DISTANCE *
          SITE_MIN_DISTANCE
      ) {
        continue;
      }

      if (siteWins(other, candidate)) {
        return false;
      }
    }
  }

  return true;
}

export function isSiteCell(
  seedText,
  sx,
  sy,
) {
  const seed = hashString(
    'v' +
    GENERATOR_VERSION +
    ':' +
    String(seedText),
  );

  return isAcceptedSite(
    seed,
    sx,
    sy,
  );
}

export function sitePosition(
  seedText,
  sx,
  sy,
) {
  const seed = hashString(
    'v' +
    GENERATOR_VERSION +
    ':' +
    String(seedText),
  );

  const site =
    siteCandidate(seed, sx, sy);

  return {
    x: site.x,
    y: site.y,
  };
}

function rootDistanceSq(
  seed,
  sx,
  sy,
) {
  const root =
    siteCandidate(seed, 0, 0);

  const site =
    siteCandidate(seed, sx, sy);

  const dx =
    site.x - root.x;
  const dy =
    site.y - root.y;

  return dx * dx + dy * dy;
}

function parentFor(
  seed,
  sx,
  sy,
) {
  if (sx === 0 && sy === 0) {
    return null;
  }

  if (!isAcceptedSite(seed, sx, sy)) {
    return null;
  }

  const source =
    siteCandidate(seed, sx, sy);

  const sourceRank =
    rootDistanceSq(
      seed,
      sx,
      sy,
    );

  let best = null;

  for (
    let radius = 1;
    radius <= SITE_PARENT_RADIUS;
    radius++
  ) {
    for (
      let oy = -radius;
      oy <= radius;
      oy++
    ) {
      for (
        let ox = -radius;
        ox <= radius;
        ox++
      ) {
        if (
          Math.max(
            Math.abs(ox),
            Math.abs(oy),
          ) !== radius
        ) {
          continue;
        }

        const nx = sx + ox;
        const ny = sy + oy;

        if (
          !isAcceptedSite(
            seed,
            nx,
            ny,
          )
        ) {
          continue;
        }

        const rank =
          rootDistanceSq(
            seed,
            nx,
            ny,
          );

        if (rank >= sourceRank) {
          continue;
        }

        const target =
          siteCandidate(
            seed,
            nx,
            ny,
          );

        const distance =
          Math.hypot(
            target.x - source.x,
            target.y - source.y,
          );

        const score =
          distance *
          (
            0.90 +
            hash01(
              seed,
              sx * 173 + nx,
              sy * 179 + ny,
              25,
            ) *
              0.20
          );

        if (
          !best ||
          score < best.score ||
          (
            score === best.score &&
            (
              nx < best.x ||
              (
                nx === best.x &&
                ny < best.y
              )
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
        (radius + 0.45) *
          SITE_GRID
    ) {
      break;
    }
  }

  if (best) {
    return [best.x, best.y];
  }

  return [0, 0];
}

export function parentCell(
  seedText,
  sx,
  sy,
) {
  const seed = hashString(
    'v' +
    GENERATOR_VERSION +
    ':' +
    String(seedText),
  );

  return parentFor(
    seed,
    sx,
    sy,
  );
}

function acceptedNeighbors(
  seed,
  sx,
  sy,
  radius,
) {
  const source =
    siteCandidate(seed, sx, sy);

  const out = [];

  for (
    let oy = -radius;
    oy <= radius;
    oy++
  ) {
    for (
      let ox = -radius;
      ox <= radius;
      ox++
    ) {
      if (ox === 0 && oy === 0) {
        continue;
      }

      const nx = sx + ox;
      const ny = sy + oy;

      if (
        !isAcceptedSite(
          seed,
          nx,
          ny,
        )
      ) {
        continue;
      }

      const target =
        siteCandidate(
          seed,
          nx,
          ny,
        );

      out.push({
        x: nx,
        y: ny,
        distance:
          Math.hypot(
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

    if (a.x !== b.x) {
      return a.x - b.x;
    }

    return a.y - b.y;
  });

  return out;
}

function siteKey(sx, sy) {
  return sx + ',' + sy;
}

function pairSiteKey(
  ax,
  ay,
  bx,
  by,
) {
  const a = siteKey(ax, ay);
  const b = siteKey(bx, by);

  return a < b
    ? a + '|' + b
    : b + '|' + a;
}

function optionalLinks(
  seed,
  sx,
  sy,
) {
  const parent =
    parentFor(seed, sx, sy);

  const out = [];

  for (
    const neighbor of
    acceptedNeighbors(
      seed,
      sx,
      sy,
      3,
    )
  ) {
    const nx = neighbor.x;
    const ny = neighbor.y;

    if (
      nx < sx ||
      (nx === sx && ny <= sy)
    ) {
      continue;
    }

    if (
      parent &&
      parent[0] === nx &&
      parent[1] === ny
    ) {
      continue;
    }

    const neighborParent =
      parentFor(seed, nx, ny);

    if (
      neighborParent &&
      neighborParent[0] === sx &&
      neighborParent[1] === sy
    ) {
      continue;
    }

    if (
      neighbor.distance >
      SITE_GRID * 2.75
    ) {
      continue;
    }

    const edgeHash =
      hashString(
        pairSiteKey(
          sx,
          sy,
          nx,
          ny,
        ),
      ) ^
      seed ^
      0x5a61d7;

    const roll =
      (mix32(edgeHash) >>> 0) /
      4294967296;

    const threshold =
      neighbor.distance <
      SITE_GRID * 1.55
        ? 0.16
        : 0.075;

    if (roll < threshold) {
      out.push([nx, ny]);
    }

    if (out.length >= 2) {
      break;
    }
  }

  return out;
}

function primitiveAabb(primitive) {
  if (primitive.shape === 'ellipse') {
    const radius =
      Math.max(
        primitive.w,
        primitive.h,
      ) * 0.5;

    return {
      minX: primitive.x - radius,
      maxX: primitive.x + radius,
      minY: primitive.y - radius,
      maxY: primitive.y + radius,
    };
  }

  const c =
    Math.cos(primitive.angle);

  const s =
    Math.sin(primitive.angle);

  const hx =
    primitive.w * 0.5;

  const hy =
    primitive.h * 0.5;

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
    Math.round(
      angle /
        (Math.PI / 12),
    ) *
    (Math.PI / 12);

  const primitive = {
    id: nonZeroId(idSeed),
    spaceId:
      nonZeroId(spaceId),
    familySeed:
      nonZeroId(familySeed),
    colorIndex,
    x,
    y,
    angle:
      snapped +
      hashSigned(
        seed,
        idSeed,
        spaceId,
        7201,
      ) *
        0.055,
    w,
    h,
    kind,
    major,
    shape,
    priority:
      mix32(
        idSeed ^
        spaceId ^
        familySeed ^
        0x38a4df71,
      ),
  };

  primitive.aabb =
    primitiveAabb(primitive);

  return primitive;
}

function spaceIdFor(
  baseSeed,
  group,
  salt,
) {
  return nonZeroId(
    baseSeed ^
    Math.imul(
      group + 1,
      0x9e3779b1,
    ) ^
    salt,
  );
}

function angleDelta(
  from,
  to,
) {
  let delta =
    (to - from) %
    TAU;

  if (delta > Math.PI) {
    delta -= TAU;
  }

  if (delta < -Math.PI) {
    delta += TAU;
  }

  return delta;
}

function blendAngle(
  from,
  to,
  amount,
) {
  return (
    from +
    angleDelta(from, to) *
      clamp(amount, 0, 1)
  );
}

function roomDimensions(
  rng,
  profile,
  kind,
) {
  const scale =
    0.74 +
    profile.scale * 0.72;

  if (kind === 'chamber') {
    return {
      w:
        (150 + rng() * 175) *
        scale,
      h:
        (110 + rng() * 145) *
        scale,
    };
  }

  if (kind === 'gallery') {
    return {
      w:
        (155 + rng() * 145) *
        scale,
      h:
        (42 + rng() * 50) *
        scale,
    };
  }

  if (kind === 'transverse') {
    return {
      w:
        (58 + rng() * 70) *
        scale,
      h:
        (125 + rng() * 120) *
        scale,
    };
  }

  if (kind === 'suite') {
    return {
      w:
        (115 + rng() * 120) *
        scale,
      h:
        (82 + rng() * 105) *
        scale,
    };
  }

  if (kind === 'cell') {
    return {
      w:
        (48 + rng() * 52) *
        scale,
      h:
        (42 + rng() * 48) *
        scale,
    };
  }

  return {
    w:
      (78 + rng() * 105) *
      scale,
    h:
      (62 + rng() * 92) *
      scale,
  };
}

function chooseRoomKind(
  rng,
  profile,
  sinceMajor,
) {
  if (sinceMajor >= 3) {
    return 'chamber';
  }

  const roll = rng();

  if (
    roll <
    0.11 +
      profile.chamber * 0.10
  ) {
    return 'chamber';
  }

  if (roll < 0.25) {
    return 'gallery';
  }

  if (roll < 0.38) {
    return 'transverse';
  }

  if (roll < 0.55) {
    return 'suite';
  }

  if (
    roll <
    0.66 -
      profile.openness * 0.10
  ) {
    return 'cell';
  }

  return 'room';
}

function addCompoundParts(
  out,
  seed,
  base,
  idSeed,
  rng,
  profile,
) {
  if (
    base.kind === 'gallery' ||
    base.kind === 'cell'
  ) {
    return;
  }

  const roll = rng();

  if (roll > 0.28) {
    return;
  }

  const c =
    Math.cos(base.angle);

  const s =
    Math.sin(base.angle);

  const side =
    rng() < 0.5 ? -1 : 1;

  const wingW =
    base.w *
    (0.38 + rng() * 0.36);

  const wingH =
    base.h *
    (0.42 + rng() * 0.44);

  const offsetAlong =
    base.w *
    (
      0.18 +
      rng() * 0.17
    ) *
    (rng() < 0.5 ? -1 : 1);

  const offsetCross =
    base.h *
    (
      0.34 +
      rng() * 0.18
    ) *
    side;

  out.push(
    makePrimitive(
      seed,
      mix32(
        idSeed ^
        0x53b7121,
      ),
      base.spaceId,
      base.familySeed,
      base.colorIndex,
      base.x +
        c * offsetAlong -
        s * offsetCross,
      base.y +
        s * offsetAlong +
        c * offsetCross,
      base.angle,
      wingW,
      wingH,
      'compound-wing',
      false,
    ),
  );

  if (
    base.major &&
    roll < 0.12 &&
    profile.openness < 0.72
  ) {
    const secondCross =
      -offsetCross;

    out.push(
      makePrimitive(
        seed,
        mix32(
          idSeed ^
          0x2e816b9,
        ),
        base.spaceId,
        base.familySeed,
        base.colorIndex,
        base.x -
          c * offsetAlong -
          s * secondCross,
        base.y -
          s * offsetAlong +
          c * secondCross,
        base.angle,
        wingW *
          (0.82 + rng() * 0.26),
        wingH *
          (0.82 + rng() * 0.24),
        'compound-wing',
        false,
      ),
    );
  }
}

function addAnnexCluster(
  out,
  seed,
  base,
  idSeed,
  rng,
  profile,
) {
  const count =
    1 +
    (
      rng() <
      0.32 +
        profile.density * 0.20
        ? 1
        : 0
    );

  for (
    let index = 0;
    index < count;
    index++
  ) {
    const side =
      index === 0
        ? (
            rng() < 0.5
              ? -1
              : 1
          )
        : (
            rng() < 0.5
              ? -1
              : 1
          );

    const angle =
      base.angle +
      side *
        (
          Math.PI / 2 +
          hashSigned(
            seed,
            idSeed,
            index,
            7301,
          ) *
            0.22
        );

    const w =
      60 + rng() * 100;

    const h =
      52 + rng() * 86;

    const distance =
      base.h * 0.34 +
      h * 0.30;

    const spaceId =
      spaceIdFor(
        idSeed,
        index,
        0x291bd1,
      );

    const x =
      base.x +
      Math.cos(angle) *
        distance;

    const y =
      base.y +
      Math.sin(angle) *
        distance;

    const colorIndex =
      spacePalette(
        seed,
        base.familySeed,
        spaceId,
        x,
        y,
        base.colorIndex,
      );

    out.push(
      makePrimitive(
        seed,
        mix32(
          idSeed ^
          0x6a55d9 ^
          index,
        ),
        spaceId,
        base.familySeed,
        colorIndex,
        x,
        y,
        base.angle,
        w,
        h,
        'annex',
        false,
      ),
    );
  }
}

function growFreeBranch(
  seed,
  start,
  startAngle,
  familySeed,
  branchSeed,
  initialSpaceId,
  colorIndex,
  depth,
) {
  const rng =
    seededRng(branchSeed);

  const out = [];

  let x = start.x;
  let y = start.y;
  let heading = startAngle;
  let previousAlong = 92;
  let previousMin = 72;
  let sinceMajor = 0;

  const profileAtStart =
    fieldProfile(
      seed,
      x,
      y,
    );

  const steps =
    2 +
    Math.floor(
      rng() *
        (
          2 +
          profileAtStart.branch * 2
        ),
    );

  const groupSpan =
    1 +
    (
      mix32(
        branchSeed ^
        0x11a6c1,
      ) %
      3
    );

  for (
    let step = 0;
    step < steps;
    step++
  ) {
    const profile =
      fieldProfile(
        seed,
        x,
        y,
      );

    heading +=
      (rng() - 0.5) *
      (
        0.58 +
        profile.turn * 0.72
      );

    if (rng() < 0.66) {
      heading =
        Math.round(
          heading /
            (Math.PI / 12),
        ) *
        (Math.PI / 12);
    }

    const kind =
      chooseRoomKind(
        rng,
        profile,
        sinceMajor,
      );

    const dims =
      roomDimensions(
        rng,
        profile,
        kind,
      );

    const along =
      kind === 'transverse'
        ? dims.h
        : dims.w;

    const currentMin =
      Math.min(
        dims.w,
        dims.h,
      );

    const overlapLimit =
      (previousMin + currentMin) *
      0.44;

    const nominalAdvance =
      Math.max(
        34,
        Math.min(
          previousAlong * 0.36 +
            along * 0.28,
          104,
        ),
      );

    const advance =
      step === 0
        ? Math.min(
            30,
            currentMin * 0.24,
          )
        : Math.max(
            24,
            Math.min(
              nominalAdvance,
              overlapLimit,
            ),
          );

    x +=
      Math.cos(heading) *
      advance;

    y +=
      Math.sin(heading) *
      advance;

    const group =
      Math.floor(
        step / groupSpan,
      );

    const spaceId =
      step === 0
        ? initialSpaceId
        : spaceIdFor(
            branchSeed,
            group,
            0x5c3117,
          );

    const roomColor =
      spacePalette(
        seed,
        familySeed,
        spaceId,
        x,
        y,
        colorIndex,
      );

    const idSeed =
      mix32(
        branchSeed ^
        Math.imul(
          step + 1,
          0x27d4eb2d,
        ),
      );

    const major =
      kind === 'chamber';

    const room =
      makePrimitive(
        seed,
        idSeed,
        spaceId,
        familySeed,
        roomColor,
        x,
        y,
        heading,
        dims.w,
        dims.h,
        kind,
        major,
        major &&
        rng() < 0.045
          ? 'ellipse'
          : 'rect',
      );

    out.push(room);

    addCompoundParts(
      out,
      seed,
      room,
      idSeed,
      rng,
      profile,
    );

    if (
      major &&
      rng() <
        0.20 +
        profile.density * 0.16
    ) {
      addAnnexCluster(
        out,
        seed,
        room,
        idSeed,
        rng,
        profile,
      );
    }

    sinceMajor =
      major
        ? 0
        : sinceMajor + 1;

    previousAlong = along;
    previousMin = currentMin;

    if (
      depth < 1 &&
      step > 0 &&
      rng() <
        0.14 +
        profile.branch * 0.13
    ) {
      const side =
        rng() < 0.5
          ? -1
          : 1;

      const fork =
        growFreeBranch(
          seed,
          { x, y },
          heading +
            side *
              (
                0.78 +
                rng() * 0.52
              ),
          familySeed,
          mix32(
            branchSeed ^
            0x5f356495 ^
            step,
          ),
          room.spaceId,
          colorIndex,
          depth + 1,
        );

      out.push(
        ...fork.slice(0, 4),
      );
    }
  }

  return out;
}

function growFrontToTarget(
  seed,
  source,
  target,
  familySeed,
  primary,
) {
  const rng =
    seededRng(
      familySeed ^
      0x7aa8b3,
    );

  const out = [];

  const initialProfile =
    fieldProfile(
      seed,
      source.x,
      source.y,
    );

  const initialBearing =
    Math.atan2(
      target.y - source.y,
      target.x - source.x,
    );

  let heading =
    initialBearing +
    hashSigned(
      seed,
      familySeed,
      0,
      7401,
    ) *
      0.78;

  const initialSpaceId =
    spaceIdFor(
      familySeed,
      0,
      0x551bf1,
    );

  const commonColor =
    familyPalette(
      seed,
      familySeed,
      source.x,
      source.y,
    );

  const initialDims =
    roomDimensions(
      rng,
      initialProfile,
      (
        rng() <
        0.16 +
          initialProfile.chamber * 0.08
      )
        ? 'chamber'
        : 'room',
    );

  const initialId =
    mix32(
      familySeed ^
      0x34ad9f,
    );

  const initialRoom =
    makePrimitive(
      seed,
      initialId,
      initialSpaceId,
      familySeed,
      spacePalette(
        seed,
        familySeed,
        initialSpaceId,
        source.x,
        source.y,
        commonColor,
      ),
      source.x,
      source.y,
      heading,
      initialDims.w,
      initialDims.h,
      'seed-room',
      false,
    );

  out.push(initialRoom);

  addCompoundParts(
    out,
    seed,
    initialRoom,
    initialId,
    rng,
    initialProfile,
  );

  let x = source.x;
  let y = source.y;
  let previousAlong =
    initialDims.w;
  let previousMin =
    Math.min(
      initialDims.w,
      initialDims.h,
    );
  let sinceMajor = 0;

  const startDistance =
    Math.hypot(
      target.x - source.x,
      target.y - source.y,
    );

  const maxSteps =
    clamp(
      Math.ceil(
        startDistance / 48,
      ) + 9,
      10,
      38,
    );

  const groupSpan =
    1 +
    (
      mix32(
        familySeed ^
        0x4135a7,
      ) %
      3
    );

  for (
    let step = 1;
    step <= maxSteps;
    step++
  ) {
    const dx =
      target.x - x;

    const dy =
      target.y - y;

    const distance =
      Math.hypot(dx, dy);

    if (distance < 72) {
      break;
    }

    const profile =
      fieldProfile(
        seed,
        x,
        y,
      );

    const targetBearing =
      Math.atan2(dy, dx);

    const progress =
      step / maxSteps;

    const attraction =
      primary
        ? clamp(
            0.19 +
              progress * 0.31 +
              (
                distance < 240
                  ? 0.16
                  : 0
              ),
            0.19,
            0.68,
          )
        : clamp(
            0.14 +
              progress * 0.25,
            0.14,
            0.52,
          );

    heading =
      blendAngle(
        heading,
        targetBearing,
        attraction,
      );

    heading +=
      (rng() - 0.5) *
      (
        0.40 +
        profile.turn * 0.52
      ) *
      (
        1 -
        progress * 0.42
      );

    if (
      rng() <
      0.58 +
        profile.openness * 0.12
    ) {
      heading =
        Math.round(
          heading /
            (Math.PI / 12),
        ) *
        (Math.PI / 12);
    }

    const kind =
      chooseRoomKind(
        rng,
        profile,
        sinceMajor,
      );

    const dims =
      roomDimensions(
        rng,
        profile,
        kind,
      );

    const along =
      kind === 'transverse'
        ? dims.h
        : dims.w;

    const currentMin =
      Math.min(
        dims.w,
        dims.h,
      );

    const overlapLimit =
      (previousMin + currentMin) *
      0.44;

    const nominalAdvance =
      Math.max(
        36,
        Math.min(
          previousAlong * 0.34 +
            along * 0.29,
          104,
        ),
      );

    const advance =
      Math.min(
        nominalAdvance,
        overlapLimit,
        Math.max(
          30,
          distance * 0.62,
        ),
      );

    x +=
      Math.cos(heading) *
      advance;

    y +=
      Math.sin(heading) *
      advance;

    const group =
      Math.floor(
        step / groupSpan,
      );

    const spaceId =
      spaceIdFor(
        familySeed,
        group,
        0x41bf27d,
      );

    const roomColor =
      spacePalette(
        seed,
        familySeed,
        spaceId,
        x,
        y,
        commonColor,
      );

    const idSeed =
      mix32(
        familySeed ^
        Math.imul(
          step + 1,
          0x9e3779b1,
        ),
      );

    const major =
      kind === 'chamber';

    const room =
      makePrimitive(
        seed,
        idSeed,
        spaceId,
        familySeed,
        roomColor,
        x,
        y,
        heading,
        dims.w,
        dims.h,
        kind,
        major,
        major &&
        rng() < 0.04
          ? 'ellipse'
          : 'rect',
      );

    out.push(room);

    addCompoundParts(
      out,
      seed,
      room,
      idSeed,
      rng,
      profile,
    );

    if (
      major &&
      rng() <
        0.24 +
        profile.density * 0.17
    ) {
      addAnnexCluster(
        out,
        seed,
        room,
        idSeed,
        rng,
        profile,
      );
    }

    const branchChance =
      (
        primary
          ? 0.25
          : 0.18
      ) +
      profile.branch * 0.17 +
      profile.density * 0.07;

    if (
      step > 1 &&
      step < maxSteps - 1 &&
      rng() < branchChance
    ) {
      const side =
        rng() < 0.5
          ? -1
          : 1;

      const branchAngle =
        heading +
        side *
          (
            0.76 +
            rng() *
              (
                0.62 +
                profile.turn * 0.40
              )
          );

      const branch =
        growFreeBranch(
          seed,
          { x, y },
          branchAngle,
          familySeed,
          mix32(
            idSeed ^
            0x6217aa2d,
          ),
          room.spaceId,
          commonColor,
          0,
        );

      out.push(...branch);
    }

    sinceMajor =
      major
        ? 0
        : sinceMajor + 1;

    previousAlong = along;
    previousMin = currentMin;
  }

  let remaining =
    Math.hypot(
      target.x - x,
      target.y - y,
    );

  let forcedStep = 0;

  while (
    remaining > 78 &&
    forcedStep < 8
  ) {
    const bearing =
      Math.atan2(
        target.y - y,
        target.x - x,
      );

    heading =
      blendAngle(
        heading,
        bearing,
        0.72,
      );

    const profile =
      fieldProfile(
        seed,
        x,
        y,
      );

    const dims =
      roomDimensions(
        rng,
        profile,
        forcedStep % 3 === 2
          ? 'chamber'
          : 'room',
      );

    const currentMin =
      Math.min(
        dims.w,
        dims.h,
      );

    const advance =
      Math.min(
        88,
        (previousMin + currentMin) *
          0.44,
        Math.max(
          30,
          remaining * 0.58,
        ),
      );

    x +=
      Math.cos(heading) *
      advance;

    y +=
      Math.sin(heading) *
      advance;

    const spaceId =
      spaceIdFor(
        familySeed,
        maxSteps +
          forcedStep,
        0x39acbf,
      );

    const idSeed =
      mix32(
        familySeed ^
        0x71b83d ^
        forcedStep,
      );

    const room =
      makePrimitive(
        seed,
        idSeed,
        spaceId,
        familySeed,
        spacePalette(
          seed,
          familySeed,
          spaceId,
          x,
          y,
          commonColor,
        ),
        x,
        y,
        heading,
        dims.w,
        dims.h,
        forcedStep % 3 === 2
          ? 'merge-chamber'
          : 'merge-room',
        forcedStep % 3 === 2,
      );

    out.push(room);

    addCompoundParts(
      out,
      seed,
      room,
      idSeed,
      rng,
      profile,
    );

    previousMin = currentMin;
    previousAlong =
      Math.max(
        dims.w,
        dims.h,
      );

    remaining =
      Math.hypot(
        target.x - x,
        target.y - y,
      );

    forcedStep++;
  }

  const finalDistance =
    Math.hypot(
      target.x - x,
      target.y - y,
    );

  if (finalDistance > 20) {
    const angle =
      Math.atan2(
        target.y - y,
        target.x - x,
      );

    const midpoint = {
      x:
        (x + target.x) * 0.5,
      y:
        (y + target.y) * 0.5,
    };

    const profile =
      fieldProfile(
        seed,
        midpoint.x,
        midpoint.y,
      );

    const spaceId =
      spaceIdFor(
        familySeed,
        999,
        0x718db1,
      );

    const width =
      Math.max(
        105,
        finalDistance + 90,
      );

    const height =
      82 +
      profile.scale * 78;

    const idSeed =
      mix32(
        familySeed ^
        0x7f31a4d,
      );

    const mergeRoom =
      makePrimitive(
        seed,
        idSeed,
        spaceId,
        familySeed,
        spacePalette(
          seed,
          familySeed,
          spaceId,
          midpoint.x,
          midpoint.y,
          commonColor,
        ),
        midpoint.x,
        midpoint.y,
        angle,
        width,
        height,
        'merge-chamber',
        true,
      );

    out.push(mergeRoom);

    addCompoundParts(
      out,
      seed,
      mergeRoom,
      idSeed,
      rng,
      profile,
    );
  }

  return out;
}

function siteGrowth(
  seed,
  sx,
  sy,
) {
  if (
    !isAcceptedSite(
      seed,
      sx,
      sy,
    )
  ) {
    return [];
  }

  const source =
    siteCandidate(
      seed,
      sx,
      sy,
    );

  const out = [];

  const parent =
    parentFor(
      seed,
      sx,
      sy,
    );

  if (parent) {
    const target =
      siteCandidate(
        seed,
        parent[0],
        parent[1],
      );

    const familySeed =
      mix32(
        hashString(
          pairSiteKey(
            sx,
            sy,
            parent[0],
            parent[1],
          ),
        ) ^
        seed ^
        0x4fd71a,
      );

    out.push(
      ...growFrontToTarget(
        seed,
        source,
        target,
        familySeed,
        true,
      ),
    );
  } else {
    const rootSeed =
      hashInt(
        seed,
        sx,
        sy,
        9901,
      );

    const profile =
      fieldProfile(
        seed,
        source.x,
        source.y,
      );

    const commonColor =
      familyPalette(
        seed,
        rootSeed,
        source.x,
        source.y,
      );

    const rootSpace =
      spaceIdFor(
        rootSeed,
        0,
        0x1ba4f7,
      );

    const rootRoom =
      makePrimitive(
        seed,
        mix32(
          rootSeed ^
          0x71bd31,
        ),
        rootSpace,
        rootSeed,
        commonColor,
        source.x,
        source.y,
        hashSigned(
          seed,
          sx,
          sy,
          9911,
        ) *
          Math.PI,
        150 +
          profile.scale * 120,
        120 +
          profile.scale * 105,
        'root-chamber',
        true,
      );

    out.push(rootRoom);

    const rng =
      seededRng(rootSeed);

    for (
      let branch = 0;
      branch < 3;
      branch++
    ) {
      out.push(
        ...growFreeBranch(
          seed,
          {
            x: source.x,
            y: source.y,
          },
          rng() * TAU,
          rootSeed,
          mix32(
            rootSeed ^
            Math.imul(
              branch + 1,
              0x85ebca77,
            ),
          ),
          rootSpace,
          commonColor,
          0,
        ),
      );
    }
  }

  for (
    const [nx, ny] of
    optionalLinks(
      seed,
      sx,
      sy,
    )
  ) {
    const target =
      siteCandidate(
        seed,
        nx,
        ny,
      );

    const loopSeed =
      mix32(
        hashString(
          pairSiteKey(
            sx,
            sy,
            nx,
            ny,
          ),
        ) ^
        seed ^
        0x5e3ba1,
      );

    out.push(
      ...growFrontToTarget(
        seed,
        source,
        target,
        loopSeed,
        false,
      ),
    );
  }

  return out;
}

function primitiveRadius(
  primitive,
) {
  return (
    Math.hypot(
      primitive.w,
      primitive.h,
    ) *
    0.5
  );
}

function spatialBucketKey(
  bx,
  by,
) {
  return bx + ',' + by;
}

function buildSpatialBuckets(
  primitives,
  bucketSize,
) {
  const buckets =
    new Map();

  for (
    let index = 0;
    index < primitives.length;
    index++
  ) {
    const primitive =
      primitives[index];

    const bx =
      Math.floor(
        primitive.x / bucketSize,
      );

    const by =
      Math.floor(
        primitive.y / bucketSize,
      );

    const key =
      spatialBucketKey(bx, by);

    if (!buckets.has(key)) {
      buckets.set(key, []);
    }

    buckets.get(key).push(index);
  }

  return buckets;
}

function nearbyPrimitiveIndices(
  buckets,
  x,
  y,
  bucketSize,
  radius,
) {
  const minBX =
    Math.floor(
      (x - radius) /
        bucketSize,
    );

  const maxBX =
    Math.floor(
      (x + radius) /
        bucketSize,
    );

  const minBY =
    Math.floor(
      (y - radius) /
        bucketSize,
    );

  const maxBY =
    Math.floor(
      (y + radius) /
        bucketSize,
    );

  const out = [];

  for (
    let by = minBY;
    by <= maxBY;
    by++
  ) {
    for (
      let bx = minBX;
      bx <= maxBX;
      bx++
    ) {
      const values =
        buckets.get(
          spatialBucketKey(
            bx,
            by,
          ),
        );

      if (!values) continue;

      out.push(...values);
    }
  }

  return out;
}

function mergePrimitives(
  seed,
  primitives,
  bounds,
) {
  const bucketSize = 210;

  const buckets =
    buildSpatialBuckets(
      primitives,
      bucketSize,
    );

  const out = [];

  const seen =
    new Set();

  const expanded = {
    minX:
      bounds.minX - MERGE_RADIUS,
    maxX:
      bounds.maxX + MERGE_RADIUS,
    minY:
      bounds.minY - MERGE_RADIUS,
    maxY:
      bounds.maxY + MERGE_RADIUS,
  };

  for (
    let index = 0;
    index < primitives.length;
    index++
  ) {
    const a =
      primitives[index];

    if (
      a.x < expanded.minX ||
      a.x > expanded.maxX ||
      a.y < expanded.minY ||
      a.y > expanded.maxY
    ) {
      continue;
    }

    const nearby =
      nearbyPrimitiveIndices(
        buckets,
        a.x,
        a.y,
        bucketSize,
        MERGE_RADIUS,
      );

    for (const otherIndex of nearby) {
      if (otherIndex <= index) {
        continue;
      }

      const b =
        primitives[otherIndex];

      if (
        a.familySeed ===
        b.familySeed
      ) {
        continue;
      }

      const dx =
        b.x - a.x;
      const dy =
        b.y - a.y;

      const distance =
        Math.hypot(dx, dy);

      if (
        distance >
        MERGE_RADIUS ||
        distance < 70
      ) {
        continue;
      }

      const key =
        a.id < b.id
          ? a.id + ':' + b.id
          : b.id + ':' + a.id;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const radiusA =
        Math.min(
          primitiveRadius(a),
          Math.max(a.w, a.h) * 0.72,
        );

      const radiusB =
        Math.min(
          primitiveRadius(b),
          Math.max(b.w, b.h) * 0.72,
        );

      const gap =
        distance -
        radiusA * 0.52 -
        radiusB * 0.52;

      if (
        gap < -45 ||
        gap > 115
      ) {
        continue;
      }

      const midpoint = {
        x:
          (a.x + b.x) * 0.5,
        y:
          (a.y + b.y) * 0.5,
      };

      const profile =
        fieldProfile(
          seed,
          midpoint.x,
          midpoint.y,
        );

      const pairSeed =
        mix32(
          hashString(key) ^
          seed ^
          0x681ac9,
        );

      const roll =
        (pairSeed >>> 0) /
        4294967296;

      const threshold =
        0.18 +
        profile.density * 0.24 +
        profile.branch * 0.12;

      if (roll > threshold) {
        continue;
      }

      const angle =
        Math.atan2(dy, dx);

      // Local merge chambers physically contain the centerline between
      // both growth events, guaranteeing that a merge can only add connected
      // architecture rather than a detached decoration.
      const width =
        Math.min(
          330,
          distance + 54,
        );

      const height =
        72 +
        profile.scale * 70 +
        (
          mix32(
            pairSeed ^
            0x2da119,
          ) %
          42
        );

      const spaceId =
        spaceIdFor(
          pairSeed,
          0,
          0x5a32d1,
        );

      const colorIndex =
        spacePalette(
          seed,
          pairSeed,
          spaceId,
          midpoint.x,
          midpoint.y,
          a.colorIndex,
        );

      out.push(
        makePrimitive(
          seed,
          pairSeed,
          spaceId,
          pairSeed,
          colorIndex,
          midpoint.x,
          midpoint.y,
          angle,
          width,
          height,
          'merge-junction',
          true,
        ),
      );
    }
  }

  return out;
}

function infillPrimitives(
  seed,
  primitives,
  bounds,
) {
  const bucketSize = 210;

  const buckets =
    buildSpatialBuckets(
      primitives,
      bucketSize,
    );

  const out = [];

  const minGX =
    Math.floor(
      (bounds.minX - 160) /
      INFILL_GRID,
    );

  const maxGX =
    Math.floor(
      (bounds.maxX + 160) /
      INFILL_GRID,
    );

  const minGY =
    Math.floor(
      (bounds.minY - 160) /
      INFILL_GRID,
    );

  const maxGY =
    Math.floor(
      (bounds.maxY + 160) /
      INFILL_GRID,
    );

  for (
    let gy = minGY;
    gy <= maxGY;
    gy++
  ) {
    for (
      let gx = minGX;
      gx <= maxGX;
      gx++
    ) {
      const x =
        gx * INFILL_GRID +
        INFILL_GRID * 0.5 +
        hashSigned(
          seed,
          gx,
          gy,
          8201,
        ) *
          INFILL_GRID *
          0.34;

      const y =
        gy * INFILL_GRID +
        INFILL_GRID * 0.5 +
        hashSigned(
          seed,
          gx,
          gy,
          8202,
        ) *
          INFILL_GRID *
          0.34;

      const nearbyIndices =
        nearbyPrimitiveIndices(
          buckets,
          x,
          y,
          bucketSize,
          245,
        );

      if (nearbyIndices.length < 3) {
        continue;
      }

      let inside = false;
      let nearest = null;
      let nearestDistance =
        Infinity;

      const sectors =
        [false, false, false, false];

      const families =
        new Set();

      for (
        const index of nearbyIndices
      ) {
        const primitive =
          primitives[index];

        const dx =
          primitive.x - x;
        const dy =
          primitive.y - y;

        const distance =
          Math.hypot(dx, dy);

        if (
          distance <
          nearestDistance
        ) {
          nearestDistance =
            distance;
          nearest = primitive;
        }

        if (
          distance <
          primitiveRadius(primitive) *
            0.62
        ) {
          inside = true;
          break;
        }

        if (distance <= 225) {
          const angle =
            Math.atan2(dy, dx);

          let sector =
            Math.floor(
              (
                angle +
                Math.PI
              ) /
              (Math.PI / 2),
            );

          sector =
            ((sector % 4) + 4) %
            4;

          sectors[sector] = true;
          families.add(
            primitive.familySeed,
          );
        }
      }

      if (
        inside ||
        !nearest
      ) {
        continue;
      }

      const sectorCount =
        sectors.filter(Boolean)
          .length;

      if (
        sectorCount < 3 &&
        families.size < 3
      ) {
        continue;
      }

      const profile =
        fieldProfile(
          seed,
          x,
          y,
        );

      const candidateSeed =
        hashInt(
          seed,
          gx,
          gy,
          8211,
        );

      const roll =
        (candidateSeed >>> 0) /
        4294967296;

      const threshold =
        0.18 +
        profile.density * 0.26 +
        (
          sectorCount === 4
            ? 0.10
            : 0
        );

      if (roll > threshold) {
        continue;
      }

      const bearing =
        Math.atan2(
          y - nearest.y,
          x - nearest.x,
        );

      const rng =
        seededRng(
          candidateSeed,
        );

      const kind =
        chooseRoomKind(
          rng,
          profile,
          2,
        );

      const dims =
        roomDimensions(
          rng,
          profile,
          kind,
        );

      const overlapAdvance =
        Math.min(
          nearestDistance * 0.62,
          Math.max(
            36,
            Math.min(
              nearest.w,
              nearest.h,
            ) *
              0.30 +
              Math.min(
                dims.w,
                dims.h,
              ) *
                0.28,
          ),
        );

      const center = {
        x:
          nearest.x +
          Math.cos(bearing) *
            overlapAdvance,
        y:
          nearest.y +
          Math.sin(bearing) *
            overlapAdvance,
      };

      const spaceId =
        spaceIdFor(
          candidateSeed,
          0,
          0x2b781d,
        );

      const colorIndex =
        spacePalette(
          seed,
          candidateSeed,
          spaceId,
          center.x,
          center.y,
          nearest.colorIndex,
        );

      const room =
        makePrimitive(
          seed,
          candidateSeed,
          spaceId,
          candidateSeed,
          colorIndex,
          center.x,
          center.y,
          bearing,
          dims.w,
          dims.h,
          'infill-room',
          kind === 'chamber',
          (
            kind === 'chamber' &&
            rng() < 0.04
          )
            ? 'ellipse'
            : 'rect',
        );

      out.push(room);

      addCompoundParts(
        out,
        seed,
        room,
        candidateSeed,
        rng,
        profile,
      );
    }
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

  getSitePrimitives(sx, sy) {
    if (
      !isAcceptedSite(
        this.seed,
        sx,
        sy,
      )
    ) {
      return [];
    }

    const key =
      primitiveKey(sx, sy);

    const cached =
      this.primitiveCache.get(key);

    if (cached) {
      cached.used = this.frame;
      return cached.primitives;
    }

    const primitives =
      siteGrowth(
        this.seed,
        sx,
        sy,
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
    const supportHalo = 560;

    const minSX =
      Math.floor(
        (
          bounds.minX -
          PRIMITIVE_HALO
        ) /
          SITE_GRID,
      ) - 1;

    const maxSX =
      Math.floor(
        (
          bounds.maxX +
          PRIMITIVE_HALO
        ) /
          SITE_GRID,
      ) + 1;

    const minSY =
      Math.floor(
        (
          bounds.minY -
          PRIMITIVE_HALO
        ) /
          SITE_GRID,
      ) - 1;

    const maxSY =
      Math.floor(
        (
          bounds.maxY +
          PRIMITIVE_HALO
        ) /
          SITE_GRID,
      ) + 1;

    const supportBounds = {
      minX:
        bounds.minX - supportHalo,
      maxX:
        bounds.maxX + supportHalo,
      minY:
        bounds.minY - supportHalo,
      maxY:
        bounds.maxY + supportHalo,
    };

    const base = [];

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
        if (
          !isAcceptedSite(
            this.seed,
            sx,
            sy,
          )
        ) {
          continue;
        }

        const primitives =
          this.getSitePrimitives(
            sx,
            sy,
          );

        for (
          const primitive of primitives
        ) {
          if (
            aabbIntersects(
              primitive.aabb,
              supportBounds,
            )
          ) {
            base.push(primitive);
          }
        }
      }
    }

    const merged =
      mergePrimitives(
        this.seed,
        base,
        {
          minX:
            bounds.minX - 300,
          maxX:
            bounds.maxX + 300,
          minY:
            bounds.minY - 300,
          maxY:
            bounds.maxY + 300,
        },
      );

    const withMerges =
      base.concat(merged);

    const infill =
      infillPrimitives(
        this.seed,
        withMerges,
        {
          minX:
            bounds.minX - 300,
          maxX:
            bounds.maxX + 300,
          minY:
            bounds.minY - 300,
          maxY:
            bounds.maxY + 300,
        },
      );

    const all =
      withMerges.concat(infill);

    const visibleBounds = {
      minX:
        bounds.minX - FABRIC_CELL,
      maxX:
        bounds.maxX + FABRIC_CELL,
      minY:
        bounds.minY - FABRIC_CELL,
      maxY:
        bounds.maxY + FABRIC_CELL,
    };

    return all.filter(
      (primitive) =>
        aabbIntersects(
          primitive.aabb,
          visibleBounds,
        ),
    );
  }

  getChunk(cx, cy, providedPrimitives = null) {
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

    const primitiveBounds = {
      minX: bounds.minX - FABRIC_CELL,
      maxX: bounds.maxX + FABRIC_CELL,
      minY: bounds.minY - FABRIC_CELL,
      maxY: bounds.maxY + FABRIC_CELL,
    };

    const primitives =
      providedPrimitives
        ? providedPrimitives.filter(
            (primitive) =>
              aabbIntersects(
                primitive.aabb,
                primitiveBounds,
              ),
          )
        : this.collectPrimitives(bounds);

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

    const coordinates = [];
    const missing = [];

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
        coordinates.push([cx, cy]);

        const key =
          chunkKey(cx, cy);

        if (
          !this.chunkCache.has(key)
        ) {
          missing.push([cx, cy]);
        }
      }
    }

    // Generate one shared frontier/infill primitive set for all newly visible
    // chunks. This avoids re-running merge/infill discovery once per chunk and
    // makes low-zoom exploration substantially faster.
    if (missing.length) {
      let minMissingX = Infinity;
      let maxMissingX = -Infinity;
      let minMissingY = Infinity;
      let maxMissingY = -Infinity;

      for (
        const [cx, cy] of missing
      ) {
        minMissingX =
          Math.min(
            minMissingX,
            cx * FABRIC_CHUNK,
          );

        maxMissingX =
          Math.max(
            maxMissingX,
            (cx + 1) *
              FABRIC_CHUNK,
          );

        minMissingY =
          Math.min(
            minMissingY,
            cy * FABRIC_CHUNK,
          );

        maxMissingY =
          Math.max(
            maxMissingY,
            (cy + 1) *
              FABRIC_CHUNK,
          );
      }

      const sharedPrimitives =
        this.collectPrimitives({
          minX: minMissingX,
          maxX: maxMissingX,
          minY: minMissingY,
          maxY: maxMissingY,
        });

      for (
        const [cx, cy] of missing
      ) {
        this.getChunk(
          cx,
          cy,
          sharedPrimitives,
        );
      }
    }

    const chunks =
      coordinates.map(
        ([cx, cy]) => {
          const entry =
            this.chunkCache.get(
              chunkKey(cx, cy),
            );

          entry.used = this.frame;
          return entry.geometry;
        },
      );

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
