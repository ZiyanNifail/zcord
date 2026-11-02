'use strict';

/**
 * Small JSON-file persistence for settings, Google tokens and the queue of
 * recordings that still need uploading. Tokens are encrypted with the OS
 * keychain (Electron safeStorage) when it is available.
 */

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

class Store {
  /**
   * @param {string} dir          Directory for the JSON files (Electron userData).
   * @param {object} defaults     Default settings.
   * @param {object} [safeStorage] Electron safeStorage (optional).
   */
  constructor(dir, defaults, safeStorage) {
    this.dir = dir;
    this.defaults = defaults;
    this.safeStorage = safeStorage;
    this.settingsFile = path.join(dir, 'settings.json');
    this.tokensFile = path.join(dir, 'google-tokens.bin');
    this.queueFile = path.join(dir, 'upload-queue.json');
    this.oauthFile = path.join(dir, 'google-oauth.json');
  }

  // ---- settings
  getSettings() {
    return { ...this.defaults, ...readJson(this.settingsFile, {}) };
  }

  setSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    writeJson(this.settingsFile, next);
    return next;
  }

  // ---- OAuth client (the teacher's own "Desktop app" client from Google Cloud)
  getOAuthClient(extraSearchPaths = []) {
    for (const file of [this.oauthFile, ...extraSearchPaths]) {
      const parsed = parseOAuthClientJson(readJson(file, null));
      // A "Web application" client can never complete a desktop sign-in.
      if (parsed && parsed.type !== 'web') return parsed;
    }
    return null;
  }

  /** Import the JSON file Google Cloud lets you download for a client. */
  importOAuthClient(file) {
    const parsed = parseOAuthClientJson(readJson(file, null));
    if (!parsed) {
      throw new Error(
        'That file is not a Google client file. In Google Cloud open Clients, click the download icon next to your "Desktop" client, and pick that file.'
      );
    }
    if (parsed.type === 'web') throw new Error(WEB_CLIENT_MESSAGE);
    return this.setOAuthClient(parsed);
  }

  /** Save a Client ID + secret the teacher pasted in. */
  setOAuthClient({ clientId, clientSecret }) {
    const id = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) {
      throw new Error('That Client ID doesn\'t look right. It ends in ".apps.googleusercontent.com" — copy it again from Google Cloud → Clients.');
    }
    if (!secret) {
      throw new Error('Paste the Client secret too. It is shown next to the Client ID in Google Cloud (it usually starts with "GOCSPX-").');
    }
    writeJson(this.oauthFile, { installed: { client_id: id, client_secret: secret } });
    return { clientId: id, clientSecret: secret, type: 'installed' };
  }

  // ---- tokens
  loadTokens() {
    try {
      const raw = fs.readFileSync(this.tokensFile);
      const text =
        this.safeStorage && this.safeStorage.isEncryptionAvailable() && raw[0] !== 0x7b /* '{' */
          ? this.safeStorage.decryptString(raw)
          : raw.toString('utf8');
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  saveTokens(tokens) {
    if (!tokens) {
      fs.rmSync(this.tokensFile, { force: true });
      return;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    const text = JSON.stringify(tokens);
    const data =
      this.safeStorage && this.safeStorage.isEncryptionAvailable() ? this.safeStorage.encryptString(text) : text;
    fs.writeFileSync(this.tokensFile, data, { mode: 0o600 });
  }

  // ---- upload queue
  getQueue() {
    return readJson(this.queueFile, []);
  }

  saveQueue(queue) {
    writeJson(this.queueFile, queue);
  }

  upsertQueueItem(item) {
    const queue = this.getQueue();
    const i = queue.findIndex((q) => q.id === item.id);
    if (i >= 0) queue[i] = { ...queue[i], ...item };
    else queue.push(item);
    this.saveQueue(queue);
    return queue;
  }

  removeQueueItem(id) {
    const queue = this.getQueue().filter((q) => q.id !== id);
    this.saveQueue(queue);
    return queue;
  }
}

const WEB_CLIENT_MESSAGE =
  'This client is a "Web application", which can\'t be used by a desktop app. In Google Cloud go to Clients → Create client, choose Application type "Desktop app", and use that one instead.';

function parseOAuthClientJson(json) {
  if (!json || typeof json !== 'object') return null;
  const type = json.installed ? 'installed' : json.web ? 'web' : 'installed';
  const c = json.installed || json.web || json;
  if (!c || typeof c.client_id !== 'string' || !c.client_id) return null;
  return { clientId: c.client_id, clientSecret: c.client_secret || '', type };
}

module.exports = { Store, parseOAuthClientJson };
