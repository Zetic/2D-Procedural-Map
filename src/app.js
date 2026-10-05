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

const camera = {
  x: 450,
  y: 450,
  zoom: 0.72,
};

let cssWidth = 1;
let cssHeight = 1;
let dpr = 1;
let renderQueued = false;
let pointer = null;

const background = '#4b4945';
const wall = '#625747';
const interiorWall = 'rgba(101, 84, 61, 0.82)';
const columnFill = 'rgba(86, 70, 52, 0.68)';

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

function tracePolyline(points) {
  if (!points || points.length < 2) return;

  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
}

function drawConnectors(connectors) {
  // Passage shells are drawn before rooms. Any passage that meets or crosses
  // a room is therefore absorbed by the room floor and becomes a doorway or
  // junction instead of visibly drawing a road across the room.
  for (const connector of connectors) {
    ctx.beginPath();
    tracePolyline(connector.points);

    ctx.strokeStyle = wall;
    ctx.lineWidth = connector.width + 7;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }

  for (const connector of connectors) {
    ctx.beginPath();
    tracePolyline(connector.points);

    ctx.strokeStyle = connector.color;
    ctx.lineWidth = connector.width;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }
}

function drawRoomFloor(room) {
  const vertices = room.vertices;

  if (!vertices || vertices.length < 3) return;

  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);

  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }

  ctx.closePath();
  ctx.fillStyle = room.color;
  ctx.fill();
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];

  intervals.sort((a, b) => a[0] - b[0]);

  const merged = [intervals[0].slice()];

  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const last = merged[merged.length - 1];

    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current.slice());
    }
  }

  return merged;
}

function drawRoomWalls(room, detailLevel) {
  const vertices = room.vertices;

  if (!vertices || vertices.length < 3) return;

  const doorsByEdge = new Map();

  for (const door of room.doors || []) {
    if (!doorsByEdge.has(door.edgeIndex)) {
      doorsByEdge.set(door.edgeIndex, []);
    }

    doorsByEdge.get(door.edgeIndex).push(door);
  }

  const wallWidth = Math.max(
    detailLevel >= 2 ? 2.2 : 1.6,
    0.62 / Math.max(camera.zoom, 0.08),
  );

  ctx.strokeStyle = wall;
  ctx.lineWidth = wallWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex++) {
    const a = vertices[edgeIndex];
    const b = vertices[(edgeIndex + 1) % vertices.length];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);

    if (length < 1e-6) continue;

    const edgeDoors = doorsByEdge.get(edgeIndex) || [];
    const intervals = [];

    for (const door of edgeDoors) {
      const halfT =
        Math.min(
          0.42,
          (door.width * 0.5) / length,
        );

      intervals.push([
        clamp(door.t - halfT, 0, 1),
        clamp(door.t + halfT, 0, 1),
      ]);
    }

    const merged = mergeIntervals(intervals);
    let cursor = 0;

    for (const interval of merged) {
      if (interval[0] > cursor + 1e-5) {
        ctx.beginPath();
        ctx.moveTo(
          a.x + dx * cursor,
          a.y + dy * cursor,
        );
        ctx.lineTo(
          a.x + dx * interval[0],
          a.y + dy * interval[0],
        );
        ctx.stroke();
      }

      cursor = Math.max(cursor, interval[1]);
    }

    if (cursor < 1 - 1e-5) {
      ctx.beginPath();
      ctx.moveTo(
        a.x + dx * cursor,
        a.y + dy * cursor,
      );
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

function drawDetails(rooms, detailLevel) {
  if (detailLevel < 2) return;

  ctx.strokeStyle = interiorWall;
  ctx.lineWidth = Math.max(
    1.25,
    0.42 / Math.max(camera.zoom, 0.08),
  );
  ctx.lineCap = 'butt';

  for (const room of rooms) {
    for (const detail of room.details || []) {
      if (detail.type !== 'partition') continue;

      ctx.beginPath();
      ctx.moveTo(detail.a.x, detail.a.y);
      ctx.lineTo(detail.b.x, detail.b.y);
      ctx.stroke();
    }
  }

  if (detailLevel < 3) return;

  ctx.fillStyle = columnFill;

  for (const room of rooms) {
    for (const detail of room.details || []) {
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

  const scene = generator.query(worldBounds());

  const detailLevel =
    camera.zoom < 0.12 ? 0 :
    camera.zoom < 0.34 ? 1 :
    camera.zoom < 0.72 ? 2 : 3;

  drawConnectors(scene.connectors);

  for (const room of scene.rooms) {
    drawRoomFloor(room);
  }

  for (const room of scene.rooms) {
    drawRoomWalls(room, detailLevel);
  }

  drawDetails(scene.rooms, detailLevel);

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

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);

  pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    cameraX: camera.x,
    cameraY: camera.y,
  };

  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (event) => {
  if (!pointer || pointer.id !== event.pointerId) return;

  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;

  camera.x =
    pointer.cameraX -
    dx / camera.zoom;

  camera.y =
    pointer.cameraY -
    dy / camera.zoom;

  requestRender();
});

function finishPointer(event) {
  if (!pointer || pointer.id !== event.pointerId) return;

  pointer = null;
  canvas.classList.remove('dragging');
}

canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();

    const before = screenToWorld(
      event.clientX,
      event.clientY,
    );

    const factor = Math.exp(-event.deltaY * 0.0012);

    camera.zoom = clamp(
      camera.zoom * factor,
      0.10,
      3.2,
    );

    const after = screenToWorld(
      event.clientX,
      event.clientY,
    );

    camera.x += before.x - after.x;
    camera.y += before.y - after.y;

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

applySeedButton.addEventListener('click', applySeed);

seedInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    applySeed();
  }
});

homeButton.addEventListener('click', () => {
  camera.x = 450;
  camera.y = 450;
  camera.zoom = 0.72;

  requestRender();
});

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);

resizeCanvas();
