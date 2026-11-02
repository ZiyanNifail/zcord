'use strict';

/**
 * Google Drive client used by ClassCast.
 *
 * - OAuth 2.0 "installed app" flow with PKCE and a loopback redirect
 *   (http://127.0.0.1:<random port>), which is what Google recommends for
 *   desktop apps.
 * - Resumable, chunked uploads that survive flaky Wi-Fi: every chunk is
 *   retried with back-off, and after an error the client asks Drive how many
 *   bytes it already has and continues from there instead of starting over.
 *
 * This file only depends on Node built-ins (fetch, http, crypto, fs) so it
 * can be unit-tested without Electron.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
};

// Full Drive scope is needed so recordings can be put into a folder that the
// teacher created themselves (or that a school shared with them). The
// narrower drive.file scope can only write into folders this app created.
const SCOPES = ['https://www.googleapis.com/auth/drive', 'openid', 'email'];

// Must be a multiple of 256 KiB (Drive requirement).
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

class UploadError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.retryable = retryable;
  }
}

/** Accepts a raw folder ID or any Drive folder URL and returns the ID. */
function parseFolderId(input) {
  if (!input) return '';
  const value = String(input).trim();
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]{10,})/, // https://drive.google.com/drive/folders/<id>
    /[?&]id=([a-zA-Z0-9_-]{10,})/, // https://drive.google.com/open?id=<id>
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) return value;
  return '';
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DriveClient {
  /**
   * @param {object} opts
   * @param {() => ({clientId: string, clientSecret?: string} | null)} opts.getCredentials
   * @param {() => object | null} opts.loadTokens
   * @param {(tokens: object | null) => void} opts.saveTokens
   * @param {(url: string) => void} opts.openExternal
   * @param {object} [opts.endpoints]
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {number} [opts.chunkSize]
   * @param {number} [opts.maxRetries]
   * @param {number} [opts.retryBaseMs]
   */
  constructor(opts) {
    this.getCredentials = opts.getCredentials;
    this.loadTokens = opts.loadTokens;
    this.saveTokens = opts.saveTokens;
    this.openExternal = opts.openExternal || (() => {});
    this.endpoints = { ...DEFAULT_ENDPOINTS, ...(opts.endpoints || {}) };
    this.fetch = opts.fetchImpl || globalThis.fetch;
    this.chunkSize = opts.chunkSize || DEFAULT_CHUNK_SIZE;
    this.maxRetries = opts.maxRetries ?? 8;
    this.retryBaseMs = opts.retryBaseMs ?? 1000;
    this._pendingSignIn = null;
  }

  // ---------------------------------------------------------------- auth --

  isSignedIn() {
    const t = this.loadTokens();
    return Boolean(t && t.refresh_token);
  }

  account() {
    const t = this.loadTokens();
    return t ? { email: t.email || null } : null;
  }

  signOut() {
    const t = this.loadTokens();
    this.saveTokens(null);
    if (t && t.refresh_token) {
      // Best-effort revoke; ignore failures (e.g. offline).
      this.fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token)}`, {
        method: 'POST',
      }).catch(() => {});
    }
  }

  cancelSignIn() {
    if (this._pendingSignIn) this._pendingSignIn.cancel();
  }

  /** Opens the browser for Google sign-in and resolves with {email}. */
  async signIn({ timeoutMs = 5 * 60 * 1000 } = {}) {
    const creds = this.getCredentials();
    if (!creds || !creds.clientId) {
      throw new AuthError('Google OAuth client is not configured. Open Settings and import your OAuth client JSON.');
    }
    this.cancelSignIn();

    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));

    let redirectUri = '';
    const code = await new Promise((resolve, reject) => {
      let settled = false;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        const gotCode = url.searchParams.get('code');
        const gotState = url.searchParams.get('state');
        const ok = !err && gotCode && gotState === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>ClassCast</title>` +
            `<body style="font-family:system-ui;text-align:center;padding:4rem">` +
            (ok
              ? '<h2>Signed in to ClassCast ✅</h2><p>You can close this tab and go back to the app.</p>'
              : `<h2>Sign-in did not complete</h2><p>${err ? String(err).replace(/[<>&]/g, '') : 'Unexpected response.'}</p>`) +
            '</body>'
        );
        finish(ok ? null : new AuthError(err ? `Google sign-in failed: ${err}` : 'Google sign-in failed.'), gotCode);
      });

      const timer = setTimeout(() => finish(new AuthError('Google sign-in timed out.')), timeoutMs);

      const finish = (error, gotCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._pendingSignIn = null;
        server.close();
        if (error) reject(error);
        else resolve(gotCode);
      };

      this._pendingSignIn = { cancel: () => finish(new AuthError('Sign-in cancelled.')) };

      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${server.address().port}`;
        const params = new URLSearchParams({
          client_id: creds.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES.join(' '),
          access_type: 'offline',
          prompt: 'consent',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        });
        this.openExternal(`${this.endpoints.auth}?${params}`);
      });
      server.on('error', (e) => finish(new AuthError(`Could not start sign-in listener: ${e.message}`)));
    });

    const body = new URLSearchParams({
      code,
      client_id: creds.clientId,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (creds.clientSecret) body.set('client_secret', creds.clientSecret);

    const res = await this.fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AuthError(`Token exchange failed: ${json.error_description || json.error || res.status}`);
    }
    if (!json.refresh_token) {
      throw new AuthError('Google did not return a refresh token. Remove ClassCast from your Google account permissions and sign in again.');
    }
    const tokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expiry: Date.now() + (json.expires_in || 3600) * 1000,
      email: emailFromIdToken(json.id_token),
    };
    this.saveTokens(tokens);
    return { email: tokens.email };
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    const t = this.loadTokens();
    if (!t || !t.refresh_token) throw new AuthError('Not signed in to Google Drive.');
    if (!forceRefresh && t.access_token && t.expiry - 60_000 > Date.now()) return t.access_token;

    const creds = this.getCredentials();
    if (!creds || !creds.clientId) throw new AuthError('Google OAuth client is not configured.');
    const body = new URLSearchParams({
      client_id: creds.clientId,
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
    });
    if (creds.clientSecret) body.set('client_secret', creds.clientSecret);

    const res = await this.fetch(this.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === 'invalid_grant') {
        this.saveTokens(null);
        throw new AuthError('Your Google sign-in expired or was revoked. Please sign in again.');
      }
      throw new UploadError(`Could not refresh Google token (${json.error || res.status}).`, {
        status: res.status,
        retryable: true,
      });
    }
    const next = {
      ...t,
      access_token: json.access_token,
      expiry: Date.now() + (json.expires_in || 3600) * 1000,
    };
    this.saveTokens(next);
    return next.access_token;
  }

  async _authedFetch(url, init = {}) {
    let token = await this.getAccessToken();
    let res = await this.fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      token = await this.getAccessToken({ forceRefresh: true });
      res = await this.fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    }
    return res;
  }

  // -------------------------------------------------------------- folder --

  /** Returns {id, name, webViewLink} or throws if the folder is unusable. */
  async getFolder(folderId) {
    const id = parseFolderId(folderId);
    if (!id) throw new UploadError('That does not look like a Google Drive folder link or ID.');
    const res = await this._authedFetch(
      `${this.endpoints.api}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,webViewLink,capabilities/canAddChildren&supportsAllDrives=true`
    );
    const json = await res.json().catch(() => ({}));
    if (res.status === 404) throw new UploadError('Folder not found, or your Google account has no access to it.', { status: 404 });
    if (!res.ok) throw new UploadError(json.error?.message || `Drive error ${res.status}`, { status: res.status });
    if (json.mimeType !== 'application/vnd.google-apps.folder') throw new UploadError('That link points to a file, not a folder.');
    if (json.capabilities && json.capabilities.canAddChildren === false) {
      throw new UploadError(`You can view "${json.name}" but cannot add files to it. Ask the owner for Editor access.`);
    }
    return { id: json.id, name: json.name, webViewLink: json.webViewLink };
  }

  // -------------------------------------------------------------- upload --

  /**
   * Uploads a local file with Drive's resumable protocol.
   *
   * @param {object} p
   * @param {string} p.filePath
   * @param {string} p.name           File name shown in Drive.
   * @param {string} p.mimeType
   * @param {string} p.folderId
   * @param {string} [p.sessionUri]   Resume a previous upload session.
   * @param {(uri: string) => void} [p.onSession]  Called when a new session starts (persist it to resume after a crash).
   * @param {(sent: number, total: number) => void} [p.onProgress]
   * @param {AbortSignal} [p.signal]
   * @returns {Promise<{id: string, name: string, webViewLink?: string}>}
   */
  async uploadFile(p) {
    const { size } = await fs.promises.stat(p.filePath);
    const folderId = parseFolderId(p.folderId);
    if (!folderId) throw new UploadError('No Google Drive folder is configured.');

    let sessionUri = p.sessionUri || null;
    let offset = 0;
    let restartedSession = false;

    if (sessionUri) {
      const status = await this._queryStatus(sessionUri, size).catch(() => null);
      if (status && status.done) return status.file;
      if (status && typeof status.offset === 'number') offset = status.offset;
      else sessionUri = null; // expired; start a new one
    }
    if (!sessionUri) {
      sessionUri = await this._startSession({ ...p, folderId, size });
      if (p.onSession) p.onSession(sessionUri);
      offset = 0;
    }
    p.onProgress?.(offset, size);

    const fh = await fs.promises.open(p.filePath, 'r');
    try {
      let attempt = 0;
      // Empty files still need one (empty) PUT to finalize.
      while (offset < size || size === 0) {
        if (p.signal?.aborted) throw new UploadError('Upload cancelled.');
        const end = Math.min(offset + this.chunkSize, size);
        const length = end - offset;
        const buf = Buffer.alloc(length);
        if (length) await fh.read(buf, 0, length, offset);

        let res;
        try {
          res = await this.fetch(sessionUri, {
            method: 'PUT',
            headers: {
              'Content-Length': String(length),
              'Content-Range': size === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${size}`,
            },
            body: buf,
            signal: p.signal,
          });
        } catch (e) {
          if (p.signal?.aborted) throw new UploadError('Upload cancelled.');
          res = null; // network failure
        }

        if (res && (res.status === 200 || res.status === 201)) {
          p.onProgress?.(size, size);
          return await res.json();
        }
        if (res && res.status === 308) {
          offset = nextOffset(res);
          attempt = 0;
          p.onProgress?.(offset, size);
          continue;
        }
        if (res && res.status === 404 && !restartedSession) {
          // Session expired (they last ~1 week). Start over once.
          restartedSession = true;
          sessionUri = await this._startSession({ ...p, folderId, size });
          if (p.onSession) p.onSession(sessionUri);
          offset = 0;
          continue;
        }
        const retryable = !res || res.status >= 500 || res.status === 429 || res.status === 408;
        if (!retryable) {
          const text = res ? await res.text().catch(() => '') : '';
          throw new UploadError(`Drive rejected the upload (${res.status}). ${extractMessage(text)}`.trim(), {
            status: res.status,
          });
        }
        if (++attempt > this.maxRetries) {
          throw new UploadError('Upload failed after several retries (network problem?). It will be retried later.', {
            retryable: true,
          });
        }
        await sleep(Math.min(this.retryBaseMs * 2 ** (attempt - 1), 32_000) + Math.random() * 250);
        // Ask Drive what it actually received before continuing.
        const status = await this._queryStatus(sessionUri, size).catch(() => null);
        if (status && status.done) {
          p.onProgress?.(size, size);
          return status.file;
        }
        if (status && typeof status.offset === 'number') offset = status.offset;
      }
      throw new UploadError('Upload ended unexpectedly.');
    } finally {
      await fh.close();
    }
  }

  async _startSession({ name, mimeType, folderId, size }) {
    const res = await this._authedFetch(
      `${this.endpoints.upload}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({ name, mimeType, parents: [folderId] }),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new UploadError(`Could not start upload (${res.status}). ${extractMessage(text)}`.trim(), {
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const location = res.headers.get('location');
    if (!location) throw new UploadError('Drive did not return an upload session URL.', { retryable: true });
    return location;
  }

  async _queryStatus(sessionUri, size) {
    const res = await this.fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` },
    });
    if (res.status === 200 || res.status === 201) return { done: true, file: await res.json() };
    if (res.status === 308) return { done: false, offset: nextOffset(res) };
    return null;
  }
}

function nextOffset(res) {
  const range = res.headers.get('range'); // e.g. "bytes=0-8388607"
  const m = range && range.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

function extractMessage(text) {
  try {
    return JSON.parse(text).error?.message || '';
  } catch {
    return '';
  }
}

function emailFromIdToken(idToken) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email || null;
  } catch {
    return null;
  }
}

module.exports = { DriveClient, AuthError, UploadError, parseFolderId, SCOPES };
