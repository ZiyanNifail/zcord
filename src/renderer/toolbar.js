'use strict';

// Floating recording toolbar. On Windows and macOS it is excluded from the
// recording (content protection), so students only see the screen + ink.

const api = window.zcord;
const $ = (id) => document.getElementById(id);

const SIZES = [3, 6, 10];
let draw = { enabled: false, tool: 'pen', color: '#ff3b30', size: 6, fade: false };
let rec = { active: false };

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

function tick() {
  if (rec.active) {
    const now = rec.state === 'paused' ? rec.pausedAt : Date.now();
    $('time').textContent = fmt(now - rec.startedAt - rec.pausedTotal);
  }
}
setInterval(tick, 250);

function renderRec() {
  const paused = rec.state === 'paused';
  $('rec').classList.toggle('paused', paused);
  $('icoPause').hidden = paused;
  $('icoResume').hidden = !paused;
  $('pause').title = paused ? 'Resume (Ctrl+Shift+P)' : 'Pause (Ctrl+Shift+P)';
  $('pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  tick();
}

function renderDraw() {
  // "cursor" is lit while drawing is off (mouse goes to your apps).
  const active = draw.enabled ? draw.tool : 'cursor';
  for (const b of document.querySelectorAll('.tool')) {
    const on = b.dataset.tool === active;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('on', b.dataset.color === draw.color);
  $('fade').setAttribute('aria-pressed', draw.fade ? 'true' : 'false');
  const d = 4 + SIZES.indexOf(nearestSize(draw.size)) * 4;
  $('sizeDot').style.width = `${d}px`;
  $('sizeDot').style.height = `${d}px`;
}

function nearestSize(v) {
  return SIZES.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

api.on('rec:state', (s) => {
  rec = s;
  renderRec();
});
api.on('draw:state', (s) => {
  draw = s;
  renderDraw();
});
api.invoke('rec:state').then((s) => {
  rec = s;
  renderRec();
});
api.invoke('draw:get').then((s) => {
  draw = s;
  renderDraw();
});

$('pause').onclick = () => api.send('toolbar:command', rec.state === 'paused' ? 'resume' : 'pause');
$('stop').onclick = () => api.send('toolbar:command', 'stop');
for (const b of document.querySelectorAll('.tool')) {
  // Picking a drawing tool turns drawing on; the cursor turns it off.
  b.onclick = () =>
    b.dataset.tool === 'cursor'
      ? api.send('draw:update', { enabled: false })
      : api.send('draw:update', { tool: b.dataset.tool, enabled: true });
}
for (const b of document.querySelectorAll('.swatch')) {
  b.onclick = () =>
    api.send('draw:update', { color: b.dataset.color, enabled: true, tool: draw.tool === 'laser' ? 'pen' : draw.tool });
}
$('size').onclick = () => {
  const i = SIZES.indexOf(nearestSize(draw.size));
  api.send('draw:update', { size: SIZES[(i + 1) % SIZES.length] });
};
$('fade').onclick = () => api.send('draw:update', { fade: !draw.fade });
$('undo').onclick = () => api.send('draw:action', 'undo');
$('clear').onclick = () => api.send('draw:action', 'clear');
