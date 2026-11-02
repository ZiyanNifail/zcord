'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { DriveClient, AuthError, UploadError, parseFolderId } = require('../src/drive');
const { Store, parseOAuthClientJson } = require('../src/store');

const CHUNK = 256 * 1024;

/**
 * Minimal fake of Google's token + Drive resumable upload endpoints.
 * opts.failChunkPuts: set of PUT indexes (0-based) that should return 503
 * opts.dropAfterBytes: on a failing PUT, still store this many bytes (simulates a partial write)
 */
function startFakeGoogle(opts = {}) {
  const state = {
    sessions: new Map(),
    files: new Map(),
    putCount: 0,
    tokenRequests: [],
    initRequests: [],
    validToken: 'access-1',
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/token') {
      const params = new URLSearchParams(body.toString());
      state.tokenRequests.push(Object.fromEntries(params));
      if (params.get('refresh_token') === 'revoked') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      state.validToken = `access-${state.tokenRequests.length + 1}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ access_token: state.validToken, expires_in: 3600 }));
    }

    if (req.headers.authorization && req.headers.authorization !== `Bearer ${state.validToken}`) {
      res.writeHead(401);
      return res.end();
    }

    if (url.pathname === '/drive/v3/files/folder123abc') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          id: 'folder123abc',
          name: 'Class Recordings',
          mimeType: 'application/vnd.google-apps.folder',
          webViewLink: 'https://drive.google.com/drive/folders/folder123abc',
          capabilities: { canAddChildren: true },
        })
      );
    }

    if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
      assert.equal(url.searchParams.get('uploadType'), 'resumable');
      const meta = JSON.parse(body.toString());
      state.initRequests.push({ meta, headers: req.headers });
      const id = crypto.randomUUID();
      state.sessions.set(id, {
        meta,
        total: Number(req.headers['x-upload-content-length']),
        data: Buffer.alloc(0),
      });
      res.writeHead(200, { location: `http://127.0.0.1:${server.address().port}/session/${id}` });
      return res.end();
    }

    if (url.pathname.startsWith('/session/') && req.method === 'PUT') {
      const s = state.sessions.get(url.pathname.split('/').pop());
      if (!s) {
        res.writeHead(404);
        return res.end();
      }
      const range = req.headers['content-range'];
      const respondProgress = () => {
        if (s.data.length >= s.total) {
          const file = { id: 'file-' + state.files.size, name: s.meta.name, webViewLink: 'https://drive.google.com/file/d/x/view' };
          state.files.set(file.id, { ...file, data: s.data, parents: s.meta.parents });
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify(file));
        }
        const headers = s.data.length ? { range: `bytes=0-${s.data.length - 1}` } : {};
        res.writeHead(308, headers);
        return res.end();
      };
      if (range.startsWith('bytes */')) return respondProgress(); // status query

      const idx = state.putCount++;
      const m = range.match(/bytes (\d+)-(\d+)\/(\d+)/);
      const start = Number(m[1]);
      assert.equal(start, s.data.length, 'client must resume from the byte Drive reported');
      if (opts.failChunkPuts && opts.failChunkPuts.has(idx)) {
        if (opts.dropAfterBytes) s.data = Buffer.concat([s.data, body.subarray(0, opts.dropAfterBytes)]);
        res.writeHead(503);
        return res.end();
      }
      s.data = Buffer.concat([s.data, body]);
      return respondProgress();
    }

    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        state,
        server,
        endpoints: { token: `${base}/token`, api: `${base}/drive/v3`, upload: `${base}/upload/drive/v3` },
        close: () => new Promise((r) => server.close(r)),
      });
    })
  );
}

function makeClient(fake, tokens, extra = {}) {
  let saved = tokens;
  const client = new DriveClient({
    getCredentials: () => ({ clientId: 'cid', clientSecret: 'secret' }),
    loadTokens: () => saved,
    saveTokens: (t) => (saved = t),
    endpoints: fake.endpoints,
    chunkSize: CHUNK,
    retryBaseMs: 5,
    ...extra,
  });
  return { client, tokens: () => saved };
}

function tempFile(size) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'classcast-')), 'lesson.mp4');
  const data = crypto.randomBytes(size);
  fs.writeFileSync(file, data);
  return { file, data };
}

test('parseFolderId accepts links and raw IDs', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-123';
  assert.equal(parseFolderId(id), id);
  assert.equal(parseFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
  assert.equal(parseFolderId(`https://drive.google.com/drive/u/1/folders/${id}`), id);
  assert.equal(parseFolderId(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(parseFolderId('not a folder'), '');
  assert.equal(parseFolderId(''), '');
});

test('parseOAuthClientJson reads the Google Cloud "installed" format', () => {
  assert.deepEqual(parseOAuthClientJson({ installed: { client_id: 'a.apps.googleusercontent.com', client_secret: 's' } }), {
    clientId: 'a.apps.googleusercontent.com',
    clientSecret: 's',
  });
  assert.equal(parseOAuthClientJson({ foo: 1 }), null);
});

test('uploads a multi-chunk file into the chosen folder', async () => {
  const fake = await startFakeGoogle();
  try {
    const { client } = makeClient(fake, { refresh_token: 'r', access_token: 'access-1', expiry: Date.now() + 3600e3 });
    const { file, data } = tempFile(CHUNK * 3 + 1234);
    const progress = [];
    const result = await client.uploadFile({
      filePath: file,
      name: 'Lesson 1.mp4',
      mimeType: 'video/mp4',
      folderId: 'https://drive.google.com/drive/folders/folder123abc',
      onProgress: (sent, total) => progress.push([sent, total]),
    });
    const stored = fake.state.files.get(result.id);
    assert.ok(stored.data.equals(data), 'uploaded bytes match the file');
    assert.deepEqual(stored.parents, ['folder123abc']);
    assert.equal(stored.name, 'Lesson 1.mp4');
    assert.equal(fake.state.initRequests[0].headers['x-upload-content-type'], 'video/mp4');
    assert.deepEqual(progress.at(-1), [data.length, data.length]);
    assert.equal(fake.state.putCount, 4);
  } finally {
    await fake.close();
  }
});

test('recovers from server errors and partial writes by resuming at the reported offset', async () => {
  const fake = await startFakeGoogle({ failChunkPuts: new Set([1, 2]), dropAfterBytes: 1000 });
  try {
    const { client } = makeClient(fake, { refresh_token: 'r', access_token: 'access-1', expiry: Date.now() + 3600e3 });
    const { file, data } = tempFile(CHUNK * 4);
    const result = await client.uploadFile({ filePath: file, name: 'x.mp4', mimeType: 'video/mp4', folderId: 'folder123abc' });
    assert.ok(fake.state.files.get(result.id).data.equals(data));
  } finally {
    await fake.close();
  }
});

test('resumes an earlier session after an app restart', async () => {
  const fake = await startFakeGoogle({ failChunkPuts: new Set([1]) });
  try {
    const { client } = makeClient(fake, { refresh_token: 'r', access_token: 'access-1', expiry: Date.now() + 3600e3 }, { maxRetries: 0 });
    const { file, data } = tempFile(CHUNK * 3);
    let sessionUri;
    await assert.rejects(
      client.uploadFile({ filePath: file, name: 'x.mp4', mimeType: 'video/mp4', folderId: 'folder123abc', onSession: (u) => (sessionUri = u) }),
      UploadError
    );
    assert.ok(sessionUri);
    const result = await client.uploadFile({ filePath: file, name: 'x.mp4', mimeType: 'video/mp4', folderId: 'folder123abc', sessionUri });
    assert.ok(fake.state.files.get(result.id).data.equals(data));
    assert.equal(fake.state.initRequests.length, 1, 'did not start a second session');
  } finally {
    await fake.close();
  }
});

test('refreshes an expired access token automatically', async () => {
  const fake = await startFakeGoogle();
  try {
    const { client, tokens } = makeClient(fake, { refresh_token: 'r', access_token: 'old', expiry: Date.now() - 1000 });
    const folder = await client.getFolder('folder123abc');
    assert.equal(folder.name, 'Class Recordings');
    assert.equal(fake.state.tokenRequests[0].grant_type, 'refresh_token');
    assert.equal(tokens().access_token, fake.state.validToken);
  } finally {
    await fake.close();
  }
});

test('retries once with a fresh token on 401', async () => {
  const fake = await startFakeGoogle();
  try {
    // Token looks valid locally but the server rejects it.
    const { client } = makeClient(fake, { refresh_token: 'r', access_token: 'stale', expiry: Date.now() + 3600e3 });
    const folder = await client.getFolder('folder123abc');
    assert.equal(folder.id, 'folder123abc');
    assert.equal(fake.state.tokenRequests.length, 1);
  } finally {
    await fake.close();
  }
});

test('a revoked sign-in clears tokens and raises AuthError', async () => {
  const fake = await startFakeGoogle();
  try {
    const { client, tokens } = makeClient(fake, { refresh_token: 'revoked', access_token: 'x', expiry: 0 });
    await assert.rejects(client.getFolder('folder123abc'), AuthError);
    assert.equal(tokens(), null);
    assert.equal(client.isSignedIn(), false);
  } finally {
    await fake.close();
  }
});

test('Store keeps settings, tokens and the upload queue on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classcast-store-'));
  const store = new Store(dir, { autoUpload: true, folderId: '' });
  assert.equal(store.getSettings().autoUpload, true);
  store.setSettings({ folderId: 'abc' });
  assert.equal(new Store(dir, {}).getSettings().folderId, 'abc');

  store.saveTokens({ refresh_token: 'r' });
  assert.deepEqual(store.loadTokens(), { refresh_token: 'r' });
  store.saveTokens(null);
  assert.equal(store.loadTokens(), null);

  store.upsertQueueItem({ id: '1', status: 'pending' });
  store.upsertQueueItem({ id: '1', status: 'done' });
  assert.deepEqual(store.getQueue(), [{ id: '1', status: 'done' }]);
  store.removeQueueItem('1');
  assert.deepEqual(store.getQueue(), []);
});
