import { InfiniteMapGenerator } from './generator.js';

const canvas = document.querySelector('#map');
const ctx = canvas.getContext('2d', { alpha: false });
const seedInput = document.querySelector('#seed');
const applySeedButton = document.querySelector('#apply-seed');
const homeButton = document.querySelector('#home');
const coordsLabel = document.querySelector('#coords');
const zoomLabel = document.querySelector('#zoom');

const params = new URLSearchParams(location.search);
const initialSeed = params.get('seed') || 'backrooms-71';
seedInput.value = initialSeed;

const generator = new InfiniteMapGenerator(initialSeed);
const camera = { x: 450, y: 450, zoom: 0.72 };

let cssWidth = 1;
let cssHeight = 1;
let dpr = 1;
let renderQueued = false;
let pointer = null;

const background = '#4b4945';
const wall = '#625747';
const interiorWall = '#75664f';
const interiorLine = 'rgba(88, 72, 53, 0.64)';
const columnFill = 'rgba(86, 70, 52, 0.60)';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();

  cssWidth = Math.max(1, rect.width);
  cssHeight = Math.max(1, rect.height);
  dpr = clamp(window.devicePixelRatio || 1, 1, 2);

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  requestRender();
}

function worldBounds() {
  const halfW = cssWidth / camera.zoom / 2;
  const halfH = cssHeight / camera.zoom / 2;

  return {
    minX: camera.x - halfW,
    maxX: camera.x + halfW,
    minY: camera.y - halfH,
    maxY: camera.y + halfH,
  };
}

function drawFloors(chunks) {
  // A tiny screen-space bleed removes subpixel seams between raster rows.
  const bleed = 0.65 / Math.max(camera.zoom, 0.08);

  for (const chunk of chunks) {
    for (const rect of chunk.floors) {
      ctx.fillStyle = rect.color;
      ctx.fillRect(
        rect.x - bleed * 0.5,
        rect.y - bleed * 0.5,
        rect.w + bleed,
        rect.h + bleed,
      );
    }
  }
}

function drawExteriorWalls(chunks) {
  ctx.beginPath();

  for (const chunk of chunks) {
    for (const path of chunk.exteriorPaths) {
      if (!path || path.length < 2) continue;

      ctx.moveTo(path[0].x, path[0].y);

      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
    }
  }

  ctx.strokeStyle = wall;
  ctx.lineWidth = Math.max(
    3.5,
    0.78 / Math.max(camera.zoom, 0.08),
  );
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

function drawInteriorWalls(chunks, detailLevel) {
  if (detailLevel < 1) return;

  ctx.beginPath();

  for (const chunk of chunks) {
    for (const segment of chunk.interiorWalls) {
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
    }
  }

  ctx.strokeStyle = interiorWall;
  ctx.lineWidth = Math.max(
    detailLevel >= 2 ? 1.85 : 1.30,
    0.48 / Math.max(camera.zoom, 0.08),
  );
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

function drawDetails(chunks, detailLevel) {
  if (detailLevel < 2) return;

  ctx.strokeStyle = interiorLine;
  ctx.lineWidth = 1.55;
  ctx.lineCap = 'butt';

  for (const chunk of chunks) {
    for (const detail of chunk.details) {
      if (detail.type !== 'partition') continue;

      ctx.beginPath();
      ctx.moveTo(detail.a1.x, detail.a1.y);
      ctx.lineTo(detail.a2.x, detail.a2.y);
      ctx.moveTo(detail.b1.x, detail.b1.y);
      ctx.lineTo(detail.b2.x, detail.b2.y);
      ctx.stroke();
    }
  }

  if (detailLevel < 3) return;

  ctx.fillStyle = columnFill;

  for (const chunk of chunks) {
    for (const detail of chunk.details) {
      if (detail.type !== 'column') continue;

      ctx.beginPath();
      ctx.arc(
        detail.x,
        detail.y,
        detail.r,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}

function render() {
  renderQueued = false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cssWidth / 2, cssHeight / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  const chunks = generator.query(worldBounds());

  const detailLevel =
    camera.zoom < 0.095 ? 0 :
    camera.zoom < 0.30 ? 1 :
    camera.zoom < 0.68 ? 2 : 3;

  // One architectural fabric: compound floor union, exterior contour,
  // meaningful interior space boundaries, then sparse room details.
  drawFloors(chunks);
  drawExteriorWalls(chunks);
  drawInteriorWalls(chunks, detailLevel);
  drawDetails(chunks, detailLevel);

  coordsLabel.textContent =
    Math.round(camera.x) + ', ' + Math.round(camera.y);

  zoomLabel.textContent =
    Math.round(camera.zoom * 100) + '%';
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();

  const sx = clientX - rect.left;
  const sy = clientY - rect.top;

  return {
    x:
      camera.x +
      (sx - cssWidth / 2) / camera.zoom,
    y:
      camera.y +
      (sy - cssHeight / 2) / camera.zoom,
  };
}

canvas.addEventListener(
  'pointerdown',
  (event) => {
    canvas.setPointerCapture(event.pointerId);

    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    };

    canvas.classList.add('dragging');
  },
);

canvas.addEventListener(
  'pointermove',
  (event) => {
    if (
      !pointer ||
      pointer.id !== event.pointerId
    ) {
      return;
    }

    const dx =
      event.clientX - pointer.x;

    const dy =
      event.clientY - pointer.y;

    camera.x =
      pointer.cameraX -
      dx / camera.zoom;

    camera.y =
      pointer.cameraY -
      dy / camera.zoom;

    requestRender();
  },
);

function finishPointer(event) {
  if (
    !pointer ||
    pointer.id !== event.pointerId
  ) {
    return;
  }

  pointer = null;
  canvas.classList.remove('dragging');
}

canvas.addEventListener(
  'pointerup',
  finishPointer,
);

canvas.addEventListener(
  'pointercancel',
  finishPointer,
);

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();

    const before = screenToWorld(
      event.clientX,
      event.clientY,
    );

    const factor =
      Math.exp(-event.deltaY * 0.0012);

    camera.zoom = clamp(
      camera.zoom * factor,
      0.10,
      3.2,
    );

    const after = screenToWorld(
      event.clientX,
      event.clientY,
    );

    camera.x +=
      before.x - after.x;

    camera.y +=
      before.y - after.y;

    requestRender();
  },
  { passive: false },
);

function applySeed() {
  const value =
    seedInput.value.trim() ||
    'backrooms-71';

  seedInput.value = value;
  generator.setSeed(value);

  const url = new URL(location.href);
  url.searchParams.set('seed', value);

  history.replaceState(
    null,
    '',
    url,
  );

  requestRender();
}

applySeedButton.addEventListener(
  'click',
  applySeed,
);

seedInput.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Enter') {
      applySeed();
    }
  },
);

homeButton.addEventListener(
  'click',
  () => {
    camera.x = 450;
    camera.y = 450;
    camera.zoom = 0.72;
    requestRender();
  },
);

const resizeObserver =
  new ResizeObserver(resizeCanvas);

resizeObserver.observe(canvas);

resizeCanvas();
