'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  session,
  screen,
  dialog,
  shell,
  globalShortcut,
  Notification,
  safeStorage,
  systemPreferences,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

const { Store, readProjectConfig, writeProjectConfig } = require('./store');
const { DriveClient, AuthError, parseFolderId } = require('./drive');

// --------------------------------------------------------------------------
// Never let Chromium throttle or pause us while the teacher is in another
// app. These switches are what keep the recording from freezing or going
// black when the zcord window is hidden, minimised or covered.
// --------------------------------------------------------------------------
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const RENDERER = path.join(__dirname, 'renderer');

function defaultSaveDir() {
  for (const key of ['videos', 'documents', 'home']) {
    try {
      return path.join(app.getPath(key), 'zcord Recordings');
    } catch {
      /* try next */
    }
  }
  return path.join(app.getPath('userData'), 'recordings');
}

let store;
let drive;

/** @type {BrowserWindow | null} */ let mainWin = null;
/** @type {BrowserWindow | null} */ let overlayWin = null;
/** @type {BrowserWindow | null} */ let toolbarWin = null;

let selectedSourceId = null;
let wantSystemAudio = false;

/**
 * Active recording.
 * @type {null | {id:string, filePath:string, name:string, mimeType:string, stream:fs.WriteStream,
 *   bytes:number, state:'recording'|'paused', startedAt:number, pausedAt:number|null, pausedTotal:number, writeError:Error|null}}
 */
let rec = null;

const draw = { enabled: false, tool: 'pen', color: '#ff3b30', size: 6, fade: false };

const uploadProgress = new Map(); // queue id -> {sent,total}
let uploading = false;

// --------------------------------------------------------------- windows --

const commonPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
};

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    title: 'zcord',
    backgroundColor: '#0e0f12',
    show: false,
    webPreferences: commonPrefs,
  });
  if (!IS_MAC) mainWin.removeMenu(); // no File/Edit/View bar on Windows & Linux
  applyContentProtection();
  mainWin.loadFile(path.join(RENDERER, 'control.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('close', (e) => {
    if (rec) {
      const choice = dialog.showMessageBoxSync(mainWin, {
        type: 'warning',
        buttons: ['Keep recording', 'Stop and quit'],
        defaultId: 0,
        cancelId: 0,
        message: 'A recording is in progress.',
        detail: 'If you quit now, the recording will be saved locally but may be incomplete.',
      });
      if (choice === 0) e.preventDefault();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
    if (rec) {
      rec.stream.end();
      rec = null;
    }
    teardownRecordingWindows();
    app.quit();
  });
}

function applyContentProtection() {
  // Hides zcord's own panels from the recording (Windows & macOS).
  const on = store.getSettings().hidePanelsFromRecording;
  for (const w of [mainWin, toolbarWin]) if (w && !w.isDestroyed()) w.setContentProtection(Boolean(on));
}

function targetDisplay(sourceId) {
  const displays = screen.getAllDisplays();
  if (sourceId && sourceId.startsWith('screen:')) {
    const src = lastSources.find((s) => s.id === sourceId);
    const match = src && displays.find((d) => String(d.id) === String(src.display_id));
    if (match) return match;
    // Fallback: screen:<index>:0 ordering usually follows getAllDisplays().
    const idx = Number(sourceId.split(':')[1]);
    if (displays[idx]) return displays[idx];
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) || screen.getPrimaryDisplay();
}

function createRecordingWindows(display) {
  const { x, y, width, height } = display.bounds;

  overlayWin = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    show: false,
    webPreferences: commonPrefs,
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(RENDERER, 'overlay.html'));
  overlayWin.once('ready-to-show', () => {
    overlayWin.setBounds({ x, y, width, height });
    overlayWin.showInactive();
    sendDrawState();
  });

  const tbWidth = 1000;
  const tbHeight = 68;
  toolbarWin = new BrowserWindow({
    x: Math.round(x + (width - tbWidth) / 2),
    y: y + 16,
    width: tbWidth,
    height: tbHeight,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: commonPrefs,
  });
  toolbarWin.setAlwaysOnTop(true, 'screen-saver', 2);
  if (IS_MAC) toolbarWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyContentProtection();
  toolbarWin.loadFile(path.join(RENDERER, 'toolbar.html'));
  toolbarWin.once('ready-to-show', () => {
    toolbarWin.showInactive();
    sendRecState();
    sendDrawState();
  });
}

function teardownRecordingWindows() {
  for (const w of [overlayWin, toolbarWin]) if (w && !w.isDestroyed()) w.destroy();
  overlayWin = null;
  toolbarWin = null;
  draw.enabled = false;
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function broadcast(channel, payload) {
  for (const w of [mainWin, overlayWin, toolbarWin]) send(w, channel, payload);
}

// ----------------------------------------------------------------- draw --

function sendDrawState() {
  broadcast('draw:state', { ...draw });
}

function setDraw(patch) {
  Object.assign(draw, patch);
  if (overlayWin && !overlayWin.isDestroyed()) {
    if (draw.enabled) {
      overlayWin.setIgnoreMouseEvents(false);
      overlayWin.setFocusable(true);
      overlayWin.focus();
    } else {
      overlayWin.setIgnoreMouseEvents(true, { forward: true });
      overlayWin.setFocusable(false);
      overlayWin.blur();
    }
    // Keep the toolbar above the drawing layer.
    if (toolbarWin && !toolbarWin.isDestroyed()) toolbarWin.moveTop();
  }
  sendDrawState();
}

// -------------------------------------------------------------- capture --

let lastSources = [];

let sourcesInFlight = null;

// Overlapping getSources() calls can come back empty, so callers share one.
function listSources() {
  if (!sourcesInFlight) {
    sourcesInFlight = fetchSources().finally(() => {
      sourcesInFlight = null;
    });
  }
  return sourcesInFlight;
}

async function fetchSources() {
  // The OS occasionally reports no screens at all for a moment (seen on
  // Linux/X11); a short retry avoids showing an empty picker.
  for (let attempt = 0; attempt < 4; attempt++) {
    lastSources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 640, height: 360 },
      fetchWindowIcons: true,
    });
    if (lastSources.some((s) => s.id.startsWith('screen:'))) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const ownTitles = new Set(['zcord', 'zcord toolbar', 'zcord overlay']);
  return lastSources
    .filter((s) => !ownTitles.has(s.name))
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      displayId: s.display_id,
      thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
}

function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      let answered = false;
      const answer = (grant) => {
        if (answered) return;
        answered = true;
        callback(grant);
      };
      try {
        // Prefer the exact source object the teacher picked from the grid.
        let source = lastSources.find((s) => s.id === selectedSourceId);
        if (!source) {
          const fresh = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          source = fresh.find((s) => s.id === selectedSourceId) || fresh.find((s) => s.id.startsWith('screen:'));
        }
        if (!source) {
          console.error('display media: no capturable source for', selectedSourceId);
          return answer({});
        }
        const grant = { video: source };
        // System sound ("what the students hear") is supported on Windows.
        if (IS_WIN && wantSystemAudio && request.audioRequested) grant.audio = 'loopback';
        answer(grant);
      } catch (e) {
        console.error('display media handler failed', e);
        answer({});
      }
    },
    { useSystemPicker: false }
  );
}

// ------------------------------------------------------------ recording --

function sanitizeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

function recStatePayload() {
  if (!rec) return { active: false };
  return {
    active: true,
    state: rec.state,
    startedAt: rec.startedAt,
    pausedAt: rec.pausedAt,
    pausedTotal: rec.pausedTotal,
    name: rec.name,
    bytes: rec.bytes,
  };
}

function sendRecState() {
  broadcast('rec:state', recStatePayload());
}

function registerShortcuts() {
  const map = {
    'CommandOrControl+Shift+D': () => setDraw({ enabled: !draw.enabled }),
    'CommandOrControl+Shift+C': () => send(overlayWin, 'draw:action', 'clear'),
    'CommandOrControl+Shift+Z': () => send(overlayWin, 'draw:action', 'undo'),
    'CommandOrControl+Shift+P': () => send(mainWin, 'recorder:command', rec && rec.state === 'paused' ? 'resume' : 'pause'),
    'CommandOrControl+Shift+E': () => send(mainWin, 'recorder:command', 'stop'),
  };
  for (const [accel, fn] of Object.entries(map)) {
    try {
      globalShortcut.register(accel, fn);
    } catch {
      /* already taken by another app */
    }
  }
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

async function startRecording({ title, mimeType, ext }) {
  if (rec) throw new Error('Already recording.');
  const settings = store.getSettings();
  const saveDir = settings.saveDir || defaultSaveDir();
  await fs.promises.mkdir(saveDir, { recursive: true });

  const base = sanitizeFileName(`${title && title.trim() ? title.trim() : 'Class recording'} - ${timestamp()}`);
  let filePath = path.join(saveDir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(filePath); i++) filePath = path.join(saveDir, `${base} (${i}).${ext}`);

  const stream = fs.createWriteStream(filePath);
  await once(stream, 'open');
  rec = {
    id: crypto.randomUUID(),
    filePath,
    name: path.basename(filePath),
    mimeType: mimeType.split(';')[0],
    stream,
    bytes: 0,
    state: 'recording',
    startedAt: Date.now(),
    pausedAt: null,
    pausedTotal: 0,
    writeError: null,
  };
  stream.on('error', (err) => {
    if (!rec) return;
    rec.writeError = err;
    send(mainWin, 'recorder:command', 'stop');
    dialog.showErrorBox('zcord could not save the recording', `${err.message}\n\nIs the disk full?`);
  });

  createRecordingWindows(targetDisplay(selectedSourceId));
  registerShortcuts();
  if (mainWin && !mainWin.isDestroyed()) mainWin.minimize();
  sendRecState();
  return { filePath, name: rec.name };
}

async function writeChunk(data) {
  if (!rec || rec.writeError) return false;
  const buf = Buffer.from(data);
  rec.bytes += buf.length;
  if (!rec.stream.write(buf)) await once(rec.stream, 'drain');
  return true;
}

function setPaused(paused) {
  if (!rec) return;
  if (paused && rec.state !== 'paused') {
    rec.state = 'paused';
    rec.pausedAt = Date.now();
  } else if (!paused && rec.state === 'paused') {
    rec.pausedTotal += Date.now() - rec.pausedAt;
    rec.pausedAt = null;
    rec.state = 'recording';
  }
  sendRecState();
}

async function finishRecording({ discard = false } = {}) {
  if (!rec) return null;
  const r = rec;
  rec = null;
  unregisterShortcuts();
  teardownRecordingWindows();
  await new Promise((resolve) => r.stream.end(resolve));
  sendRecState();

  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }

  if (discard) {
    await fs.promises.rm(r.filePath, { force: true });
    return { discarded: true };
  }

  const size = (await fs.promises.stat(r.filePath).catch(() => ({ size: 0 }))).size;
  if (!size) return { filePath: r.filePath, size: 0, queued: false };

  const settings = store.getSettings();
  const shouldUpload = settings.autoUpload !== false;
  if (shouldUpload) {
    store.upsertQueueItem({
      id: r.id,
      filePath: r.filePath,
      name: r.name,
      mimeType: r.mimeType,
      folderId: settings.folderId,
      folderName: settings.folderName,
      size,
      status: 'pending',
      createdAt: Date.now(),
    });
    broadcastQueue();
    processQueue();
  }
  return { filePath: r.filePath, size, queued: shouldUpload };
}

// --------------------------------------------------------------- upload --

function queuePayload() {
  return store.getQueue().map((q) => ({ ...q, progress: uploadProgress.get(q.id) || null }));
}

function broadcastQueue() {
  send(mainWin, 'uploads:changed', queuePayload());
}

async function processQueue({ retryFailed = false } = {}) {
  if (uploading) return;
  uploading = true;
  const tried = new Set(); // each item at most once per pass, so offline retries don't spin
  try {
    for (;;) {
      const queue = store.getQueue();
      const item = queue.find(
        (q) => !tried.has(q.id) && (q.status === 'pending' || (retryFailed && q.status === 'failed' && q.retryable))
      );
      if (!item) break;
      tried.add(item.id);

      if (!drive.isSignedIn() || !(item.folderId || store.getSettings().folderId)) {
        store.upsertQueueItem({
          id: item.id,
          status: 'failed',
          retryable: false,
          error: !drive.isSignedIn()
            ? 'Not signed in to Google Drive. Sign in, then press Retry.'
            : 'No class recordings folder is set. Choose one in Settings, then press Retry.',
        });
        broadcastQueue();
        continue;
      }
      if (!fs.existsSync(item.filePath)) {
        store.upsertQueueItem({ id: item.id, status: 'failed', retryable: false, error: 'The local file no longer exists.' });
        broadcastQueue();
        continue;
      }

      const folderId = item.folderId || store.getSettings().folderId;
      store.upsertQueueItem({ id: item.id, status: 'uploading', error: null, folderId });
      broadcastQueue();

      try {
        let lastSent = 0;
        const file = await drive.uploadFile({
          filePath: item.filePath,
          name: item.name,
          mimeType: item.mimeType,
          folderId,
          sessionUri: item.sessionUri,
          onSession: (uri) => store.upsertQueueItem({ id: item.id, sessionUri: uri }),
          onProgress: (sent, total) => {
            uploadProgress.set(item.id, { sent, total });
            if (sent - lastSent > 512 * 1024 || sent === total) {
              lastSent = sent;
              broadcastQueue();
            }
          },
        });
        uploadProgress.delete(item.id);
        const link = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
        store.upsertQueueItem({
          id: item.id,
          status: 'done',
          driveId: file.id,
          link,
          sessionUri: null,
          finishedAt: Date.now(),
        });
        trimHistory();
        broadcastQueue();
        notify('Recording uploaded to Google Drive', item.name, link);
        if (store.getSettings().keepLocalCopy === false) fs.promises.rm(item.filePath, { force: true }).catch(() => {});
      } catch (err) {
        uploadProgress.delete(item.id);
        const isAuth = err instanceof AuthError;
        store.upsertQueueItem({
          id: item.id,
          status: 'failed',
          error: err.message,
          retryable: !isAuth && (err.retryable !== false || !err.status),
        });
        broadcastQueue();
        notify('Upload failed', `${item.name}\n${err.message}`);
        if (isAuth) send(mainWin, 'drive:changed', driveStatus());
      }
    }
  } finally {
    uploading = false;
  }
}

function trimHistory() {
  const queue = store.getQueue();
  const done = queue.filter((q) => q.status === 'done').sort((a, b) => b.finishedAt - a.finishedAt);
  const drop = new Set(done.slice(25).map((q) => q.id));
  if (drop.size) store.saveQueue(queue.filter((q) => !drop.has(q.id)));
}

function notify(title, body, link) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (link) n.on('click', () => shell.openExternal(link));
  n.show();
}

function driveStatus() {
  const s = store.getSettings();
  const creds = getCredentials();
  return {
    configured: Boolean(creds),
    // e.g. "1234…7lq.apps.googleusercontent.com" so the teacher can tell which client is saved
    projectConfigFile: projectConfig()?.file || null,
    canWriteProjectConfig: !app.isPackaged,
    clientHint: creds ? creds.clientId.replace(/^(.{6}).*(.{3}\.apps\.googleusercontent\.com)$/, '$1…$2') : '',
    signedIn: drive.isSignedIn(),
    email: drive.account()?.email || null,
    folderId: s.folderId || '',
    folderName: s.folderName || '',
    folderLink: s.folderLink || '',
  };
}

// The setup file that can travel with the code (see README: "Use on another computer").
function projectConfigPath() {
  return path.join(app.getAppPath(), 'zcord.config.json');
}

function projectConfig() {
  for (const file of [projectConfigPath(), path.join(process.resourcesPath || '', 'zcord.config.json')]) {
    const cfg = readProjectConfig(file);
    if (cfg) return { ...cfg, file };
  }
  return null;
}

function getCredentials() {
  const fromEnv = process.env.ZCORD_GOOGLE_CLIENT_ID
    ? { clientId: process.env.ZCORD_GOOGLE_CLIENT_ID, clientSecret: process.env.ZCORD_GOOGLE_CLIENT_SECRET || '' }
    : null;
  return (
    fromEnv ||
    store.getOAuthClient() ||
    projectConfig()?.google ||
    store.getOAuthClient([path.join(app.getAppPath(), 'google-oauth.json'), path.join(process.resourcesPath || '', 'google-oauth.json')])
  );
}

/** First run on a new computer: take the class folder from zcord.config.json. */
function adoptProjectFolder() {
  const cfg = projectConfig();
  if (cfg?.drive && !store.getSettings().folderId) store.setSettings(cfg.drive);
}

// ------------------------------------------------------------------ IPC --

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    systemAudioSupported: IS_WIN,
    contentProtectionSupported: IS_WIN || IS_MAC,
    screenPermission: IS_MAC ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
  }));

  ipcMain.handle('app:openScreenPermissionSettings', () =>
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  );

  ipcMain.handle('app:askMic', async () => {
    if (IS_MAC) return systemPreferences.askForMediaAccess('microphone');
    return true;
  });

  ipcMain.handle('sources:list', () => listSources());

  ipcMain.handle('capture:select', (_e, { sourceId, systemAudio }) => {
    selectedSourceId = sourceId;
    wantSystemAudio = Boolean(systemAudio);
    return true;
  });

  ipcMain.handle('rec:start', (_e, opts) => startRecording(opts));
  ipcMain.handle('rec:chunk', (_e, data) => writeChunk(data));
  ipcMain.handle('rec:paused', (_e, paused) => setPaused(paused));
  ipcMain.handle('rec:finish', (_e, opts) => finishRecording(opts || {}));
  ipcMain.handle('rec:state', () => recStatePayload());

  // Toolbar -> recorder (the MediaRecorder lives in the main window).
  ipcMain.on('toolbar:command', (_e, cmd) => {
    if (['pause', 'resume', 'stop'].includes(cmd)) send(mainWin, 'recorder:command', cmd);
  });

  ipcMain.handle('draw:get', () => ({ ...draw }));
  ipcMain.on('draw:update', (_e, patch) => {
    const allowed = {};
    for (const k of ['enabled', 'tool', 'color', 'size', 'fade']) if (k in patch) allowed[k] = patch[k];
    setDraw(allowed);
  });
  ipcMain.on('draw:action', (_e, action) => {
    if (['clear', 'undo'].includes(action)) send(overlayWin, 'draw:action', action);
  });

  ipcMain.handle('settings:get', () => ({ ...store.getSettings(), saveDir: store.getSettings().saveDir || defaultSaveDir() }));
  ipcMain.handle('settings:set', (_e, patch) => {
    const allowed = {};
    for (const k of ['saveDir', 'autoUpload', 'keepLocalCopy', 'hidePanelsFromRecording', 'includeMic', 'micDeviceId', 'includeSystemAudio', 'quality', 'noiseMode']) {
      if (k in patch) allowed[k] = patch[k];
    }
    const next = store.setSettings(allowed);
    applyContentProtection();
    return next;
  });
  ipcMain.handle('settings:chooseSaveDir', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.setSettings({ saveDir: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('settings:importOAuth', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      title: 'Select the OAuth client JSON downloaded from Google Cloud',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return driveStatus();
    const before = getCredentials()?.clientId;
    const saved = store.importOAuthClient(r.filePaths[0]);
    if (before && before !== saved.clientId) drive.signOut(); // tokens belong to the old client
    return driveStatus();
  });
  ipcMain.handle('settings:setOAuthClient', (_e, { clientId, clientSecret } = {}) => {
    const before = getCredentials()?.clientId;
    const saved = store.setOAuthClient({ clientId, clientSecret });
    if (before && before !== saved.clientId) drive.signOut();
    return driveStatus();
  });

  ipcMain.handle('setup:saveToProject', async () => {
    const creds = getCredentials();
    const s = store.getSettings();
    if (!creds) throw new Error('Save your Google key first (Settings → step 1).');
    let file = projectConfigPath();
    if (app.isPackaged) {
      // An installed app can't write inside itself; let the teacher choose.
      const r = await dialog.showSaveDialog(mainWin, { defaultPath: 'zcord.config.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    writeProjectConfig(file, {
      google: { clientId: creds.clientId, clientSecret: creds.clientSecret },
      drive: s.folderId ? { folderId: s.folderId, folderName: s.folderName, folderLink: s.folderLink } : null,
    });
    return { file, inProject: !app.isPackaged, hasFolder: Boolean(s.folderId) };
  });

  // RNNoise model for "Strong" noise cancellation (the page can't fetch file://).
  ipcMain.handle('nr:wasm', (_e, simd) =>
    fs.promises.readFile(path.join(RENDERER, 'vendor', 'rnnoise', simd ? 'rnnoise_simd.wasm' : 'rnnoise.wasm'))
  );

  ipcMain.handle('drive:status', () => driveStatus());
  ipcMain.handle('drive:signIn', async () => {
    await drive.signIn();
    const status = driveStatus();
    send(mainWin, 'drive:changed', status);
    processQueue({ retryFailed: true });
    return status;
  });
  ipcMain.handle('drive:cancelSignIn', () => drive.cancelSignIn());
  ipcMain.handle('drive:signOut', () => {
    drive.signOut();
    return driveStatus();
  });
  ipcMain.handle('drive:setFolder', async (_e, input) => {
    const id = parseFolderId(input);
    const folder = await drive.getFolder(id);
    store.setSettings({ folderId: folder.id, folderName: folder.name, folderLink: folder.webViewLink || '' });
    // Items that failed only because no folder was set can go now.
    const queue = store.getQueue();
    for (const q of queue) if (q.status === 'failed' && !q.folderId) store.upsertQueueItem({ id: q.id, folderId: folder.id });
    return driveStatus();
  });

  ipcMain.handle('uploads:list', () => queuePayload());
  ipcMain.handle('uploads:retry', (_e, id) => {
    const item = store.getQueue().find((q) => q.id === id);
    if (item && item.status === 'failed') {
      store.upsertQueueItem({ id, status: 'pending', error: null, folderId: item.folderId || store.getSettings().folderId });
      broadcastQueue();
      processQueue();
    }
    return queuePayload();
  });
  ipcMain.handle('uploads:remove', (_e, id) => {
    const item = store.getQueue().find((q) => q.id === id);
    if (item && item.status !== 'uploading') store.removeQueueItem(id);
    return queuePayload();
  });

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https:\/\/(drive|docs)\.google\.com\//.test(url) || /^https:\/\/console\.cloud\.google\.com\//.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });
  ipcMain.handle('shell:showFile', (_e, filePath) => {
    if (typeof filePath === 'string' && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });
}

// ------------------------------------------------------------------ app --

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(() => {
  store = new Store(
    app.getPath('userData'),
    {
      saveDir: '',
      autoUpload: true,
      keepLocalCopy: true,
      hidePanelsFromRecording: true,
      includeMic: true,
      micDeviceId: 'default',
      includeSystemAudio: false,
      quality: 'high',
      noiseMode: 'strong',
      folderId: '',
      folderName: '',
      folderLink: '',
    },
    safeStorage
  );

  drive = new DriveClient({
    getCredentials,
    loadTokens: () => store.loadTokens(),
    saveTokens: (t) => store.saveTokens(t),
    openExternal: (url) => shell.openExternal(url),
    // Development/testing only: point the client at a fake Google server.
    endpoints: process.env.ZCORD_DRIVE_ENDPOINTS ? JSON.parse(process.env.ZCORD_DRIVE_ENDPOINTS) : undefined,
  });

  // Anything stuck in "uploading" was interrupted by a crash/quit.
  for (const q of store.getQueue()) if (q.status === 'uploading') store.upsertQueueItem({ id: q.id, status: 'pending' });

  adoptProjectFolder();
  registerIpc();
  installDisplayMediaHandler();
  createMainWindow();

  // Retry uploads that failed because of the network, now and every 5 min.
  setTimeout(() => processQueue({ retryFailed: true }), 3000);
  setInterval(() => processQueue({ retryFailed: true }), 5 * 60 * 1000);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
