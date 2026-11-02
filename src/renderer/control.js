'use strict';

const api = window.classcast;
const $ = (id) => document.getElementById(id);

const QUALITY = {
  standard: { videoBitsPerSecond: 2_500_000, frameRate: 24 },
  high: { videoBitsPerSecond: 5_000_000, frameRate: 30 },
  max: { videoBitsPerSecond: 10_000_000, frameRate: 30 },
};

let info = {};
let settings = {};
let driveState = {};
let sources = [];
let tab = 'screen';
let selectedId = null;

// ------------------------------------------------------------- helpers --

function toast(msg, { error = false, ms = 4000 } = {}) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', error);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  check: '<path d="M5 12l5 5 9-10"/>',
  alert: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

function switchOn(id) {
  return $(id).getAttribute('aria-checked') === 'true';
}
function setSwitch(id, on) {
  $(id).setAttribute('aria-checked', on ? 'true' : 'false');
}

function fmtBytes(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function saveSettings(patch) {
  settings = await api.invoke('settings:set', patch);
}

// ------------------------------------------------------------- sources --

let sourcesLoaded = false;

async function loadSources() {
  if (!sources.length) {
    $('previewEmpty').textContent = 'Finding your screens…';
    $('previewEmpty').hidden = false;
  }
  try {
    sources = await api.invoke('sources:list');
  } catch (e) {
    toast(`Could not list screens: ${e.message}`, { error: true });
    sources = [];
  }
  sourcesLoaded = true;
  if (!sources.some((s) => s.id === selectedId)) {
    selectedId = (sources.find((s) => s.type === 'screen') || sources[0] || {}).id || null;
  }
  renderSources();
}

function renderSources() {
  const grid = $('grid');
  grid.textContent = '';
  const list = sources.filter((s) => s.type === tab);
  list.forEach((s, i) => {
    const on = s.id === selectedId;
    const thumb = el('span', { class: 'tile-thumb' });
    if (s.thumbnail) thumb.style.backgroundImage = `url("${s.thumbnail}")`;
    const sub = on ? 'Selected' : s.type === 'screen' ? `Screen ${i + 1}` : 'Window';
    const btn = el(
      'button',
      { type: 'button', class: `tile${on ? ' on' : ''}`, title: s.name, 'aria-pressed': on ? 'true' : 'false' },
      thumb,
      el('span', { class: 'tile-text' }, el('span', { class: 'tile-name' }, s.name), el('span', { class: 'tile-sub' }, sub))
    );
    btn.onclick = () => {
      selectedId = s.id;
      renderSources();
    };
    grid.append(btn);
  });
  if (!list.length && sourcesLoaded) {
    grid.append(el('p', { class: 'empty' }, tab === 'screen' ? 'No screens found — press refresh.' : 'No windows found.'));
  }

  const sel = sources.find((s) => s.id === selectedId && s.type === tab);
  $('previewImg').style.backgroundImage = sel && sel.thumbnail ? `url("${sel.thumbnail}")` : 'none';
  $('previewEmpty').hidden = Boolean(sel);
  if (!sel) $('previewEmpty').textContent = sourcesLoaded ? 'No screen selected' : 'Finding your screens…';
  $('previewName').textContent = sel ? `Preview · ${sel.name}` : 'Nothing selected';

  for (const b of document.querySelectorAll('.seg button')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  $('windowNote').hidden = tab !== 'window';
  $('screenNote').hidden = tab !== 'screen';
}

for (const b of document.querySelectorAll('.seg button')) {
  b.onclick = () => {
    tab = b.dataset.tab;
    const current = sources.find((s) => s.id === selectedId);
    if (!current || current.type !== tab) selectedId = (sources.find((s) => s.type === tab) || {}).id || null;
    renderSources();
  };
}
$('refresh').onclick = loadSources;

// ---------------------------------------------------------- microphone --

let meter = null;
const METER_BARS = 14;
for (let i = 0; i < METER_BARS; i++) $('meter').append(el('i'));

function setMeter(level) {
  const lit = Math.round(level * METER_BARS);
  [...$('meter').children].forEach((bar, i) => {
    bar.classList.toggle('on', i < lit && i < METER_BARS - 3);
    bar.classList.toggle('hot', i < lit && i >= METER_BARS - 3);
  });
}

async function loadMics() {
  let devices = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch {
    /* ignore */
  }
  const sel = $('mic');
  sel.textContent = '';
  if (!devices.length) sel.append(el('option', { value: 'default' }, 'Default microphone'));
  for (const d of devices) {
    sel.append(el('option', { value: d.deviceId }, d.label || (d.deviceId === 'default' ? 'Default microphone' : 'Microphone')));
  }
  if ([...sel.options].some((o) => o.value === settings.micDeviceId)) sel.value = settings.micDeviceId;
}

function micConstraints() {
  const id = $('mic').value;
  return {
    deviceId: id && id !== 'default' ? { exact: id } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

async function startMeter() {
  stopMeter();
  $('micError').hidden = true;
  if (!switchOn('includeMic')) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const m = { stream, ctx, raf: 0 };
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setMeter(Math.min(1, (peak / 128) * 1.6));
      m.raf = requestAnimationFrame(loop);
    };
    loop();
    meter = m;
    $('micError').hidden = true;
    // Labels only appear after permission is granted.
    if ([...$('mic').options].every((o) => !o.textContent || o.textContent === 'Microphone')) loadMics();
  } catch (e) {
    setMeter(0);
    $('micError').textContent = `Microphone unavailable: ${e.message}`;
    $('micError').hidden = false;
  }
}

function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf);
  meter.stream.getTracks().forEach((t) => t.stop());
  meter.ctx.close();
  meter = null;
  setMeter(0);
}

$('includeMic').onclick = async () => {
  const on = !switchOn('includeMic');
  setSwitch('includeMic', on);
  $('mic').disabled = !on;
  await saveSettings({ includeMic: on });
  startMeter();
};
$('mic').onchange = async () => {
  await saveSettings({ micDeviceId: $('mic').value });
  startMeter();
};
$('includeSystemAudio').onclick = () => {
  const on = !switchOn('includeSystemAudio');
  setSwitch('includeSystemAudio', on);
  saveSettings({ includeSystemAudio: on });
};
navigator.mediaDevices.addEventListener?.('devicechange', loadMics);

// -------------------------------------------------------------- drive --

function renderDrive() {
  const chip = $('driveChip');
  const d = driveState;
  let cls = 'warn';
  let text = 'Drive not connected';
  if (d.signedIn && d.folderId) {
    cls = 'ok';
    text = d.email ? `Drive connected · ${d.email}` : 'Drive connected';
  } else if (d.signedIn) text = 'Choose a Drive folder';
  chip.className = 'chip';
  chip.title = text;
  chip.textContent = '';
  chip.append(el('span', { class: `dot ${cls}` }), text);

  const card = $('destCard');
  card.textContent = '';
  if (d.signedIn && d.folderId) {
    card.append(
      icon('folder'),
      d.folderLink
        ? el('button', { type: 'button', class: 'dest-name dest-open', title: `Open “${d.folderName}” in Google Drive`, onclick: () => api.invoke('shell:openExternal', d.folderLink) }, d.folderName || d.folderId)
        : el('span', { class: 'dest-name', title: d.folderName }, d.folderName || d.folderId),
      el('button', { type: 'button', class: 'btn-link', onclick: openSettings }, 'Change')
    );
  } else {
    card.append(
      icon('folder'),
      el('span', { class: 'dest-name muted' }, settings.autoUpload === false ? 'Auto-upload is off' : 'Not set up — saved on this computer'),
      el('button', { type: 'button', class: 'btn-link', onclick: openSettings }, 'Set up')
    );
  }

  const banner = $('banner');
  const needsSetup = settings.autoUpload !== false && !(d.signedIn && d.folderId);
  banner.hidden = !needsSetup;
  if (needsSetup) {
    banner.textContent = '';
    banner.append(
      el('span', {}, 'Connect Google Drive so recordings upload to your class folder automatically.'),
      el('button', { type: 'button', class: 'btn-secondary', onclick: openSettings }, 'Connect')
    );
  }

  // Settings dialog
  $('oauthStep').classList.toggle('done', d.configured);
  $('signIn').disabled = !d.configured;
  $('signIn').hidden = d.signedIn;
  $('signOut').hidden = !d.signedIn;
  $('accountText').textContent = d.signedIn ? `Signed in as ${d.email || 'your Google account'}` : 'Not signed in';
  $('signIn').closest('.step').classList.toggle('done', d.signedIn);
  $('saveFolder').disabled = !d.signedIn;
  $('folderInput').disabled = !d.signedIn;
  $('saveFolder').closest('.step').classList.toggle('done', Boolean(d.folderId));
  if (d.folderId && !$('folderInput').value) $('folderInput').value = d.folderLink || d.folderId;
  $('folderResult').textContent = d.folderId ? `Uploading to “${d.folderName}”` : '';
}

async function refreshDrive() {
  driveState = await api.invoke('drive:status');
  renderDrive();
}

$('driveChip').onclick = openSettings;
$('importOAuth').onclick = async () => {
  try {
    driveState = await api.invoke('settings:importOAuth');
    renderDrive();
    if (driveState.configured) toast('Google client imported. Now sign in.');
  } catch (e) {
    toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true, ms: 7000 });
  }
};
$('signIn').onclick = async () => {
  $('signIn').disabled = true;
  $('accountText').textContent = 'Finish signing in in your browser…';
  try {
    driveState = await api.invoke('drive:signIn');
    toast('Signed in to Google Drive');
  } catch (e) {
    toast(cleanErr(e), { error: true, ms: 7000 });
  }
  await refreshDrive();
};
$('signOut').onclick = async () => {
  driveState = await api.invoke('drive:signOut');
  renderDrive();
};
$('saveFolder').onclick = async () => {
  $('folderResult').textContent = 'Checking folder…';
  try {
    driveState = await api.invoke('drive:setFolder', $('folderInput').value);
    renderDrive();
    toast(`Recordings will upload to “${driveState.folderName}”`);
  } catch (e) {
    $('folderResult').textContent = cleanErr(e);
  }
};

function cleanErr(e) {
  return String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}

api.on('drive:changed', (s) => {
  driveState = s;
  renderDrive();
});

// ----------------------------------------------------------- settings --

function openSettings() {
  $('autoUpload').checked = settings.autoUpload !== false;
  $('keepLocalCopy').checked = settings.keepLocalCopy !== false;
  $('hidePanelsFromRecording').checked = settings.hidePanelsFromRecording !== false;
  $('hidePanelsRow').hidden = !info.contentProtectionSupported;
  $('quality').value = settings.quality || 'high';
  $('saveDir').value = settings.saveDir || '';
  renderDrive();
  $('settings').showModal();
}
$('openSettings').onclick = openSettings;
for (const id of ['autoUpload', 'keepLocalCopy', 'hidePanelsFromRecording']) {
  $(id).onchange = async () => {
    await saveSettings({ [id]: $(id).checked });
    renderDrive();
  };
}
$('quality').onchange = () => saveSettings({ quality: $('quality').value });
$('chooseDir').onclick = async () => {
  const dir = await api.invoke('settings:chooseSaveDir');
  if (dir) {
    $('saveDir').value = dir;
    settings.saveDir = dir;
  }
};

// ------------------------------------------------------------ uploads --

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ` ${time}`;
}

// "Algebra - Lesson 4 - 2026-10-31 14.05 (2).mp4" -> "Algebra - Lesson 4"
function displayName(fileName) {
  return fileName.replace(/\.(mp4|webm)$/i, '').replace(/ - \d{4}-\d{2}-\d{2} \d{2}\.\d{2}( \(\d+\))?$/, '');
}

function statusLine(cls, iconName, text) {
  return el('div', { class: `rec-status ${cls}` }, el('div', { class: 'line' }, icon(iconName), el('span', {}, text)));
}

function renderUploads(list) {
  const ul = $('uploads');
  ul.textContent = '';
  const items = [...list].sort((a, b) => b.createdAt - a.createdAt);
  $('uploadsEmpty').hidden = items.length > 0;
  for (const q of items) {
    let status;
    if (q.status === 'uploading') {
      const p = q.progress;
      const pct = p && p.total ? Math.round((p.sent / p.total) * 100) : 0;
      const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('div'));
      bar.firstChild.style.width = `${pct}%`;
      status = el(
        'div',
        { class: 'rec-status' },
        el('div', { class: 'progress-head' }, el('span', {}, p ? `Uploading · ${fmtBytes(p.sent)} of ${fmtBytes(p.total)}` : 'Uploading to Drive'), el('span', {}, `${pct}%`)),
        bar
      );
    } else if (q.status === 'pending') {
      status = statusLine('wait', 'clock', 'Waiting to upload…');
    } else if (q.status === 'done') {
      status = statusLine('ok', 'check', `Uploaded to ${q.folderName || 'Google Drive'}`);
    } else {
      status = statusLine('err', 'alert', `${q.error || 'Upload failed'}${q.retryable ? ' Retrying automatically.' : ''}`);
    }

    const actions = el('div', { class: 'rec-actions' });
    if (q.link) actions.append(el('button', { type: 'button', class: 'btn-drive', onclick: () => api.invoke('shell:openExternal', q.link) }, 'Open in Drive'));
    if (q.status === 'failed') {
      actions.append(el('button', { type: 'button', class: 'btn-secondary', onclick: async () => renderUploads(await api.invoke('uploads:retry', q.id)) }, 'Retry'));
    }
    actions.append(el('button', { type: 'button', class: 'btn-secondary', title: q.filePath, onclick: () => api.invoke('shell:showFile', q.filePath) }, 'Show file'));
    if (q.status !== 'uploading') {
      const rm = el('button', {
        type: 'button',
        class: 'icon-btn small',
        title: 'Remove from this list (does not delete the video)',
        'aria-label': 'Remove from list',
        onclick: async () => renderUploads(await api.invoke('uploads:remove', q.id)),
      });
      rm.append(icon('x'));
      actions.append(rm);
    }

    const meta = [fmtWhen(q.createdAt), q.size ? fmtBytes(q.size) : null].filter(Boolean).join(' · ');
    ul.append(
      el(
        'li',
        { class: 'rec-item' },
        el('div', { class: 'rec-main' }, el('div', { class: 'rec-name', title: q.name }, displayName(q.name)), el('div', { class: 'rec-meta' }, meta)),
        status,
        actions
      )
    );
  }
}
api.on('uploads:changed', renderUploads);

// ----------------------------------------------------------- recorder --

let session = null; // {recorder, streams[], audioCtx, chain}

function pickMimeType() {
  const candidates = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [type, ext] of candidates) if (MediaRecorder.isTypeSupported(type)) return { mimeType: type, ext };
  return { mimeType: '', ext: 'webm' };
}

async function startRecording() {
  if (session) return;
  if (!selectedId) {
    toast('Pick a screen to record first.', { error: true });
    return;
  }
  $('start').disabled = true;
  stopMeter();

  const q = QUALITY[settings.quality] || QUALITY.high;
  const wantSystemAudio = info.systemAudioSupported && switchOn('includeSystemAudio');
  const streams = [];
  let audioCtx = null;

  try {
    await api.invoke('capture:select', { sourceId: selectedId, systemAudio: wantSystemAudio });
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: q.frameRate, max: q.frameRate } },
      audio: wantSystemAudio,
    });
    streams.push(display);
    const [video] = display.getVideoTracks();
    if (!video) throw new Error('No video from the selected screen.');
    video.contentHint = 'detail'; // keep text sharp

    let mic = null;
    if (switchOn('includeMic')) {
      if (info.platform === 'darwin') await api.invoke('app:askMic');
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
        streams.push(mic);
      } catch (e) {
        toast(`Recording without microphone: ${e.message}`, { error: true, ms: 6000 });
      }
    }

    const audioSources = [display, mic].filter((s) => s && s.getAudioTracks().length);
    let audioTracks = [];
    if (audioSources.length === 1) {
      audioTracks = audioSources[0].getAudioTracks();
    } else if (audioSources.length > 1) {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      for (const s of audioSources) audioCtx.createMediaStreamSource(s).connect(dest);
      audioTracks = dest.stream.getAudioTracks();
    }

    const stream = new MediaStream([video, ...audioTracks]);
    const { mimeType, ext } = pickMimeType();
    await api.invoke('rec:start', { title: $('title').value, mimeType: mimeType || 'video/webm', ext });

    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: q.videoBitsPerSecond,
      audioBitsPerSecond: 128_000,
    });
    session = { recorder, streams, audioCtx, chain: Promise.resolve(), stopping: false };

    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      // Chain writes so chunks reach the disk strictly in order.
      session.chain = session.chain.then(async () => api.invoke('rec:chunk', await e.data.arrayBuffer()));
    };
    recorder.onstop = finish;
    recorder.onerror = (e) => {
      toast(`Recorder error: ${e.error?.message || 'unknown'}`, { error: true });
      stopRecording();
    };
    // If the shared screen disappears (e.g. monitor unplugged), end cleanly.
    video.addEventListener('ended', () => stopRecording());

    // 1 s chunks: at most ~1 s of video is lost if the computer crashes.
    recorder.start(1000);
  } catch (e) {
    for (const s of streams) s.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close();
    session = null;
    await api.invoke('rec:finish', { discard: true }).catch(() => {});
    $('start').disabled = false;
    startMeter();
    const msg = cleanErr(e);
    toast(
      /permission|denied|NotAllowed/i.test(msg) && info.platform === 'darwin'
        ? 'macOS blocked screen recording. Allow ClassCast in System Settings → Privacy & Security → Screen Recording, then restart ClassCast.'
        : `Could not start recording: ${msg}`,
      { error: true, ms: 9000 }
    );
  }
}

function stopRecording() {
  if (!session || session.stopping) return;
  session.stopping = true;
  if (session.recorder.state !== 'inactive') session.recorder.stop();
  else finish();
}

async function finish() {
  if (!session) return;
  const s = session;
  try {
    await s.chain;
  } catch (e) {
    console.error(e);
  }
  for (const st of s.streams) st.getTracks().forEach((t) => t.stop());
  if (s.audioCtx) s.audioCtx.close();
  session = null;

  const result = await api.invoke('rec:finish');
  $('start').disabled = false;
  startMeter();
  if (!result) return;
  if (!result.size) toast('The recording was empty and was not saved.', { error: true });
  else if (result.queued) toast(`Saved (${fmtBytes(result.size)}). Uploading to Google Drive…`);
  else toast(`Saved to ${result.filePath}`, { ms: 7000 });
  renderUploads(await api.invoke('uploads:list'));
}

api.on('recorder:command', async (cmd) => {
  if (!session) return;
  const r = session.recorder;
  if (cmd === 'pause' && r.state === 'recording') {
    r.pause();
    await api.invoke('rec:paused', true);
  } else if (cmd === 'resume' && r.state === 'paused') {
    r.resume();
    await api.invoke('rec:paused', false);
  } else if (cmd === 'stop') {
    stopRecording();
  }
});

$('start').onclick = startRecording;
$('title').oninput = () => localStorage.setItem('lastTitle', $('title').value);

// --------------------------------------------------------------- init --

(async function init() {
  info = await api.invoke('app:info');
  settings = await api.invoke('settings:get');
  $('title').value = localStorage.getItem('lastTitle') || '';
  setSwitch('includeMic', settings.includeMic !== false);
  $('mic').disabled = settings.includeMic === false;
  $('sysAudioRow').hidden = !info.systemAudioSupported;
  setSwitch('includeSystemAudio', Boolean(settings.includeSystemAudio));

  if (info.platform === 'darwin' && info.screenPermission !== 'granted') {
    const banner = $('permBanner');
    banner.hidden = false;
    banner.textContent = '';
    banner.append(
      el('span', {}, 'macOS needs permission for ClassCast to record your screen.'),
      el('button', { type: 'button', class: 'btn-secondary', onclick: () => api.invoke('app:openScreenPermissionSettings') }, 'Open settings')
    );
  }

  await Promise.all([loadSources(), loadMics(), refreshDrive()]);
  renderUploads(await api.invoke('uploads:list'));
  startMeter();
  window.addEventListener('focus', () => {
    if (!session) loadSources();
  });
})();
