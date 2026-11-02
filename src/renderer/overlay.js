'use strict';

// Transparent, always-on-top drawing layer that covers the recorded screen.
// Because it is a real window on the screen, everything drawn here is seen by
// the teacher AND captured in the screen recording.

const api = window.classcast;
const canvas = document.getElementById('ink');
const ctx = canvas.getContext('2d');

const FADE_AFTER_MS = 2500;
const FADE_DURATION_MS = 800;
const LASER_TRAIL_MS = 450;

let state = { enabled: false, tool: 'pen', color: '#ff3b30', size: 6, fade: false };
/** @type {Array<{tool:string,color:string,size:number,points:Array<[number,number]>,done:boolean,doneAt:number}>} */
let shapes = [];
let current = null;
let laser = { points: [], visible: false }; // points: [x, y, t]
let dirty = true;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  dirty = true;
}
window.addEventListener('resize', resize);
resize();

// --------------------------------------------------------------- state --

api.on('draw:state', (s) => {
  const wasEnabled = state.enabled;
  if (s.fade && !state.fade) {
    // Turning on disappearing ink: give existing marks a full lifetime.
    const now = performance.now();
    for (const sh of shapes) sh.doneAt = now;
  }
  state = s;
  document.body.classList.toggle('drawing', s.enabled);
  document.body.classList.toggle('laser', s.tool === 'laser');
  if (wasEnabled && !s.enabled) {
    finishCurrent();
    laser.visible = false;
  }
  dirty = true;
});
api.invoke('draw:get').then((s) => {
  state = s;
  document.body.classList.toggle('drawing', s.enabled);
});

api.on('draw:action', (action) => {
  if (action === 'clear') {
    shapes = [];
    current = null;
  } else if (action === 'undo') {
    if (current) current = null;
    else shapes.pop();
  }
  dirty = true;
});

// --------------------------------------------------------------- input --

function pointFrom(e) {
  return [e.clientX, e.clientY];
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.enabled || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  if (state.tool === 'laser') {
    laser.visible = true;
    laser.points.push([e.clientX, e.clientY, performance.now()]);
    dirty = true;
    return;
  }
  current = {
    tool: state.tool,
    color: state.color,
    size: state.size,
    points: [pointFrom(e)],
    done: false,
    doneAt: 0,
  };
  dirty = true;
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.enabled) return;
  if (state.tool === 'laser') {
    laser.visible = true;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) laser.points.push([ev.clientX, ev.clientY, performance.now()]);
    dirty = true;
    return;
  }
  if (!current) return;
  if (current.tool === 'pen' || current.tool === 'highlighter') {
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) current.points.push(pointFrom(ev));
  } else {
    current.points[1] = pointFrom(e); // shapes: start + end
  }
  dirty = true;
});

function finishCurrent() {
  if (!current) return;
  const keep =
    current.tool === 'pen' || current.tool === 'highlighter'
      ? current.points.length > 0
      : current.points.length > 1 && dist(current.points[0], current.points[1]) > 4;
  if (keep) {
    current.done = true;
    current.doneAt = performance.now();
    shapes.push(current);
  }
  current = null;
  dirty = true;
}

canvas.addEventListener('pointerup', finishCurrent);
canvas.addEventListener('pointercancel', finishCurrent);
canvas.addEventListener('pointerleave', () => {
  laser.visible = false;
  dirty = true;
});

window.addEventListener('keydown', (e) => {
  if (!state.enabled) return;
  const tools = { 1: 'pen', 2: 'highlighter', 3: 'arrow', 4: 'rect', 5: 'ellipse', 6: 'laser' };
  if (e.key === 'Escape') api.send('draw:update', { enabled: false });
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') api.send('draw:action', 'undo');
  else if (e.key === 'Delete' || e.key === 'Backspace') api.send('draw:action', 'clear');
  else if (tools[e.key]) api.send('draw:update', { tool: tools[e.key] });
});

// -------------------------------------------------------------- render --

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function strokePath(points) {
  ctx.beginPath();
  if (points.length === 1) {
    ctx.moveTo(points[0][0], points[0][1]);
    ctx.lineTo(points[0][0] + 0.01, points[0][1]);
    return;
  }
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function drawShape(s, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.size;

  switch (s.tool) {
    case 'pen':
      strokePath(s.points);
      ctx.stroke();
      break;
    case 'highlighter':
      ctx.globalAlpha = alpha * 0.35;
      ctx.lineWidth = s.size * 5;
      ctx.lineCap = 'square';
      strokePath(s.points);
      ctx.stroke();
      break;
    case 'arrow': {
      if (s.points.length < 2) break;
      const [a, b] = s.points;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = Math.max(14, s.size * 4);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0] - Math.cos(angle) * head * 0.6, b[1] - Math.sin(angle) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.lineTo(b[0] - head * Math.cos(angle - Math.PI / 7), b[1] - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(b[0] - head * Math.cos(angle + Math.PI / 7), b[1] - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rect': {
      if (s.points.length < 2) break;
      const [a, b] = s.points;
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      break;
    }
    case 'ellipse': {
      if (s.points.length < 2) break;
      const [a, b] = s.points;
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawLaser(now) {
  laser.points = laser.points.filter((p) => now - p[2] < LASER_TRAIL_MS);
  if (!laser.points.length) return false;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Fading trail
  for (let i = 1; i < laser.points.length; i++) {
    const p0 = laser.points[i - 1];
    const p1 = laser.points[i];
    const life = 1 - (now - p1[2]) / LASER_TRAIL_MS;
    ctx.strokeStyle = `rgba(255, 40, 40, ${0.6 * life})`;
    ctx.lineWidth = 3 + 5 * life;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }
  // Glowing dot at the pointer
  if (laser.visible) {
    const [x, y] = laser.points[laser.points.length - 1];
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,50,50,1)');
    g.addColorStop(0.6, 'rgba(255,0,0,0.35)');
    g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return true;
}

function frame() {
  const now = performance.now();
  let animating = false;

  if (state.fade) {
    const before = shapes.length;
    shapes = shapes.filter((s) => now - s.doneAt < FADE_AFTER_MS + FADE_DURATION_MS);
    if (shapes.length) animating = true;
    if (before !== shapes.length) dirty = true;
  }
  if (laser.points.length) animating = true;

  if (dirty || animating) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of shapes) {
      let alpha = 1;
      if (state.fade) {
        const age = now - s.doneAt;
        if (age > FADE_AFTER_MS) alpha = Math.max(0, 1 - (age - FADE_AFTER_MS) / FADE_DURATION_MS);
      }
      drawShape(s, alpha);
    }
    if (current) drawShape(current, 1);
    drawLaser(now);
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
