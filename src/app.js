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
const wall = '#5f5445';
const interiorLine = 'rgba(88, 72, 53, 0.66)';
const columnFill = 'rgba(86, 70, 52, 0.58)';

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

function tracePath(path) {
  if (!path || path.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  return true;
}

function drawPath(path, width, color) {
  if (!tracePath(path)) return;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function withRectTransform(rect, callback) {
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.rotate(rect.angle);
  callback();
  ctx.restore();
}

function drawRectFloor(rect) {
  withRectTransform(rect, () => {
    ctx.fillStyle = rect.color;
    ctx.fillRect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
  });
}

function drawRectWall(rect, width = 5) {
  withRectTransform(rect, () => {
    ctx.strokeStyle = wall;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.rect(-rect.w / 2, -rect.h / 2, rect.w, rect.h);
    ctx.stroke();
  });
}

function drawRoomCutouts(room) {
  const cutouts = room.cutouts || [];
  if (!cutouts.length) return;

  withRectTransform(room, () => {
    for (const cutout of cutouts) {
      const touches =
        cutout.touches ||
        (cutout.side >= 0 ? [cutout.side] : []);

      const left = cutout.x - cutout.w / 2;
      const right = cutout.x + cutout.w / 2;
      const top = cutout.y - cutout.h / 2;
      const bottom = cutout.y + cutout.h / 2;
      const erase = 8;

      const eraseLeft = touches.includes(2) ? erase : 0;
      const eraseRight = touches.includes(0) ? erase : 0;
      const eraseTop = touches.includes(3) ? erase : 0;
      const eraseBottom = touches.includes(1) ? erase : 0;

      ctx.fillStyle = background;
      ctx.fillRect(
        left - eraseLeft,
        top - eraseTop,
        cutout.w + eraseLeft + eraseRight,
        cutout.h + eraseTop + eraseBottom,
      );

      ctx.strokeStyle = wall;
      ctx.lineWidth = 5;
      ctx.lineCap = 'butt';

      if (!touches.length) {
        ctx.strokeRect(left, top, cutout.w, cutout.h);
        continue;
      }

      ctx.beginPath();

      if (!touches.includes(2)) {
        ctx.moveTo(left, top);
        ctx.lineTo(left, bottom);
      }
      if (!touches.includes(0)) {
        ctx.moveTo(right, top);
        ctx.lineTo(right, bottom);
      }
      if (!touches.includes(3)) {
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
      }
      if (!touches.includes(1)) {
        ctx.moveTo(left, bottom);
        ctx.lineTo(right, bottom);
      }

      ctx.stroke();
    }
  });
}

function drawRoomDetails(room, detailLevel) {
  if (detailLevel < 2) return;

  withRectTransform(room, () => {
    ctx.strokeStyle = interiorLine;
    ctx.lineWidth = 2;

    for (const partition of room.partitions || []) {
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

    if (room.kind === 'office' || room.kind === 'office-suite') {
      const axisX = room.w >= room.h;
      const length = axisX ? room.w : room.h;
      const cross = axisX ? room.h : room.w;
      const bays = Math.max(2, Math.min(6, Math.floor(length / 34)));

      for (let i = 1; i < bays; i++) {
        const t = i / bays;
        const along = -length / 2 + length * t;
        const halfCross = cross * 0.22;

        ctx.beginPath();
        if (axisX) {
          ctx.moveTo(along, -halfCross);
          ctx.lineTo(along, halfCross);
        } else {
          ctx.moveTo(-halfCross, along);
          ctx.lineTo(halfCross, along);
        }
        ctx.stroke();
      }
    } else if (
      room.kind === 'gallery' ||
      room.kind === 'transverse-gallery' ||
      room.kind === 'loading-hall'
    ) {
      const axisX = room.w >= room.h;
      const length = axisX ? room.w : room.h;
      const ticks = Math.max(1, Math.min(7, Math.floor(length / 48)));

      for (let i = 1; i <= ticks; i++) {
        const along = -length / 2 + (i / (ticks + 1)) * length;
        ctx.beginPath();
        if (axisX) {
          ctx.moveTo(along, -4);
          ctx.lineTo(along, 4);
        } else {
          ctx.moveTo(-4, along);
          ctx.lineTo(4, along);
        }
        ctx.stroke();
      }
    }

    if (detailLevel >= 3) {
      ctx.fillStyle = columnFill;
      for (const column of room.columns || []) {
        const x = -room.w / 2 + column.u * room.w;
        const y = -room.h / 2 + column.v * room.h;
        ctx.beginPath();
        ctx.arc(x, y, column.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

function drawDoor(door) {
  const half = door.width * 0.5;
  const dx = Math.cos(door.angle) * half;
  const dy = Math.sin(door.angle) * half;
  ctx.beginPath();
  ctx.moveTo(door.x - dx, door.y - dy);
  ctx.lineTo(door.x + dx, door.y + dy);
  ctx.strokeStyle = door.color;
  ctx.lineWidth = door.kind === 'opening' ? 15 : (door.kind === 'external' ? 13 : 10);
  ctx.lineCap = 'butt';
  ctx.stroke();
}

function collectCorridors(cells) {
  const seen = new Set();
  const corridors = [];

  for (const cell of cells) {
    for (const corridor of cell.corridors) {
      if (seen.has(corridor.edgeKey)) continue;
      seen.add(corridor.edgeKey);
      corridors.push(corridor);
    }
  }

  corridors.sort((a, b) => a.edgeKey.localeCompare(b.edgeKey));
  return corridors;
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
  const corridors = collectCorridors(cells);
  const detailLevel = camera.zoom < 0.24 ? 0 : camera.zoom < 0.42 ? 1 : camera.zoom < 0.72 ? 2 : 3;

  // All architectural families share the same wall/floor pipeline. Local
  // growth sites and inter-site fabric therefore read as one accumulated
  // complex instead of "areas" connected by a visually different road layer.
  for (const corridor of corridors) {
    drawPath(corridor.points, corridor.width + 9, wall);
    for (const chamber of corridor.chambers) drawRectWall(chamber, 5);
  }

  if (detailLevel > 0) {
    for (const cell of cells) {
      for (const room of cell.rooms) drawRectWall(room, 5);
    }

    for (const cell of cells) {
      for (const room of cell.rooms) drawRectFloor(room);
    }
  }

  for (const corridor of corridors) {
    for (const chamber of corridor.chambers) drawRectFloor(chamber);
    drawPath(corridor.points, corridor.width, corridor.color);
  }

  if (detailLevel > 0) {
    // Re-outline both local and connection-fabric rooms identically, then
    // repaint the short growth spine so it naturally cuts openings through
    // waystations rather than appearing to pass over them.
    for (const cell of cells) {
      for (const room of cell.rooms) drawRectWall(room, 5);
    }
    for (const corridor of corridors) {
      for (const chamber of corridor.chambers) drawRectWall(chamber, 5);
      drawPath(corridor.points, corridor.width, corridor.color);
    }

    for (const cell of cells) {
      for (const room of cell.rooms) drawRoomDetails(room, detailLevel);
    }

    // Required connectivity is expressed with the same architectural fabric:
    // short passages repeatedly expand into rooms, waystations, and annexes.
    for (const corridor of corridors) {
      for (const chamber of corridor.chambers) {
        drawRoomDetails(chamber, detailLevel);
      }
    }

    // Notches and interior voids are subtracted last so they erase both the
    // outer wall and any interior detail that would otherwise cross the void.
    for (const cell of cells) {
      for (const room of cell.rooms) drawRoomCutouts(room);
    }
    for (const corridor of corridors) {
      for (const chamber of corridor.chambers) drawRoomCutouts(chamber);
    }

    // Internal room doors are generated from the growth adjacency graph.
    for (const cell of cells) {
      for (const door of cell.doors) drawDoor(door);
    }

    // Openings inside the connection fabric join side annexes and waystations.
    for (const corridor of corridors) {
      for (const door of corridor.fabricDoors || []) drawDoor(door);
    }

    // External doors are the only places where the routed connection enters a
    // local room complex.
    for (const corridor of corridors) {
      for (const door of corridor.doors) drawDoor(door);
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
