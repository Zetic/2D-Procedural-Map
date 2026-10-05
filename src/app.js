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
const interiorLine = 'rgba(102, 84, 61, 0.62)';
const detailDot = 'rgba(87, 71, 52, 0.55)';

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

function drawPath(path, width, color) {
  if (!path || path.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function withRoomTransform(room, callback) {
  ctx.save();
  ctx.translate(room.x, room.y);
  ctx.rotate(room.angle);
  callback();
  ctx.restore();
}

function drawRoom(room, detailLevel) {
  withRoomTransform(room, () => {
    ctx.fillStyle = room.color;
    ctx.strokeStyle = wall;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.rect(-room.w / 2, -room.h / 2, room.w, room.h);
    ctx.fill();
    ctx.stroke();

    if (detailLevel < 2) return;
    ctx.strokeStyle = interiorLine;
    ctx.lineWidth = 2;

    for (const partition of room.partitions) {
      ctx.beginPath();
      if (partition.axis === 'x') {
        const x = -room.w / 2 + room.w * partition.t;
        const gapHalf = room.h * partition.gap * 0.5;
        ctx.moveTo(x, -room.h / 2);
        ctx.lineTo(x, -gapHalf);
        ctx.moveTo(x, gapHalf);
        ctx.lineTo(x, room.h / 2);
      } else {
        const y = -room.h / 2 + room.h * partition.t;
        const gapHalf = room.w * partition.gap * 0.5;
        ctx.moveTo(-room.w / 2, y);
        ctx.lineTo(-gapHalf, y);
        ctx.moveTo(gapHalf, y);
        ctx.lineTo(room.w / 2, y);
      }
      ctx.stroke();
    }

    if (detailLevel >= 3 && room.major) {
      const cols = Math.max(1, Math.floor(room.w / 70));
      const rows = Math.max(1, Math.floor(room.h / 70));
      ctx.fillStyle = detailDot;
      for (let iy = 1; iy < rows + 1; iy++) {
        for (let ix = 1; ix < cols + 1; ix++) {
          const x = -room.w / 2 + (ix / (cols + 1)) * room.w;
          const y = -room.h / 2 + (iy / (rows + 1)) * room.h;
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
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

  const cells = generator.query(worldBounds());
  const detailLevel = camera.zoom < 0.24 ? 0 : camera.zoom < 0.42 ? 1 : camera.zoom < 0.72 ? 2 : 3;

  for (const cell of cells) {
    for (const corridor of cell.corridors) {
      if (detailLevel === 0 && corridor.detail) continue;
      drawPath(corridor.points, corridor.width + 8, wall);
    }
  }

  if (detailLevel > 0) {
    for (const cell of cells) {
      for (const room of cell.rooms) drawRoom(room, detailLevel);
    }
  }

  for (const cell of cells) {
    for (const corridor of cell.corridors) {
      if (detailLevel === 0 && corridor.detail) continue;
      drawPath(corridor.points, corridor.width, corridor.color);
    }
  }

  coordsLabel.textContent = Math.round(camera.x) + ', ' + Math.round(camera.y);
  zoomLabel.textContent = Math.round(camera.zoom * 100) + '%';
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
    x: camera.x + (sx - cssWidth / 2) / camera.zoom,
    y: camera.y + (sy - cssHeight / 2) / camera.zoom,
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
  camera.x = pointer.cameraX - dx / camera.zoom;
  camera.y = pointer.cameraY - dy / camera.zoom;
  requestRender();
});

function finishPointer(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  pointer = null;
  canvas.classList.remove('dragging');
}

canvas.addEventListener('pointerup', finishPointer);
canvas.addEventListener('pointercancel', finishPointer);

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const before = screenToWorld(event.clientX, event.clientY);
  const factor = Math.exp(-event.deltaY * 0.0012);
  camera.zoom = clamp(camera.zoom * factor, 0.16, 2.8);
  const after = screenToWorld(event.clientX, event.clientY);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  requestRender();
}, { passive: false });

function applySeed() {
  const value = seedInput.value.trim() || 'backrooms-71';
  seedInput.value = value;
  generator.setSeed(value);
  const url = new URL(location.href);
  url.searchParams.set('seed', value);
  history.replaceState(null, '', url);
  requestRender();
}

applySeedButton.addEventListener('click', applySeed);
seedInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applySeed();
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
