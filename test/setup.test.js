'use strict';

// Google sign-in and first-time setup: the parts a teacher hits before the
// first upload. Google is simulated with a local HTTP server.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DriveClient, AuthError, UploadError } = require('../src/drive');
const { Store } = require('../src/store');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function idToken(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ email })}.sig`;
}

/** Fake Google token + Drive endpoints. `opts.token` overrides the token response. */
function fakeGoogle(opts = {}) {
  const seen = { tokenRequests: [] };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/token') {
      const params = Object.fromEntries(new URLSearchParams(body));
      seen.tokenRequests.push(params);
      const [status, json] = opts.token || [
        200,
        { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: `openid ${DRIVE_SCOPE} email`, id_token: idToken('teacher@gmail.com') },
      ];
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(json));
    }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const [status, json] = opts.folder || [200, { id: 'x', name: 'n', mimeType: 'application/vnd.google-apps.folder' }];
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(json));
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        seen,
        endpoints: { auth: `${base}/auth`, token: `${base}/token`, api: `${base}/drive/v3`, upload: `${base}/upload/drive/v3` },
        close: () => new Promise((r) => server.close(r)),
      });
    })
  );
}

/**
 * Plays the browser's part: reads the consent URL zcord opened and
 * redirects back to zcord's loopback address like Google would.
 */
function browser(redirect) {
  const opened = [];
  return {
    opened,
    openExternal: (authUrl) => {
      const u = new URL(authUrl);
      opened.push(u);
      const back = new URL(u.searchParams.get('redirect_uri'));
      for (const [k, v] of Object.entries(redirect(u))) back.searchParams.set(k, v);
      fetch(back).catch(() => {});
    },
  };
}

function client(fake, b, tokens = null) {
  let saved = tokens;
  return {
    drive: new DriveClient({
      getCredentials: () => ({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'GOCSPX-s' }),
      loadTokens: () => saved,
      saveTokens: (t) => (saved = t),
      openExternal: b ? b.openExternal : undefined,
      endpoints: fake.endpoints,
    }),
    tokens: () => saved,
  };
}

test('sign-in: opens Google with PKCE + loopback redirect and stores the refresh token', async () => {
  const fake = await fakeGoogle();
  try {
    const b = browser((u) => ({ code: 'the-code', state: u.searchParams.get('state') }));
    const { drive, tokens } = client(fake, b);
    const result = await drive.signIn();

    assert.equal(result.email, 'teacher@gmail.com');
    assert.equal(tokens().refresh_token, 'rt');
    const u = b.opened[0];
    assert.match(u.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.ok(u.searchParams.get('scope').split(' ').includes(DRIVE_SCOPE));
    const tr = fake.seen.tokenRequests[0];
    assert.equal(tr.code, 'the-code');
    assert.equal(tr.redirect_uri, u.searchParams.get('redirect_uri'), 'token exchange reuses the exact redirect_uri');
    assert.ok(tr.code_verifier && tr.client_secret === 'GOCSPX-s');
  } finally {
    await fake.close();
  }
});

test('sign-in: unticked Drive permission is explained, not silently accepted', async () => {
  const fake = await fakeGoogle({ token: [200, { access_token: 'at', refresh_token: 'rt', scope: 'openid email', expires_in: 3600 }] });
  try {
    const b = browser((u) => ({ code: 'c', state: u.searchParams.get('state') }));
    const { drive, tokens } = client(fake, b);
    await assert.rejects(drive.signIn(), (e) => e instanceof AuthError && /tick/.test(e.message));
    assert.equal(tokens(), null, 'nothing saved');
  } finally {
    await fake.close();
  }
});

test('sign-in: "Access blocked" (access_denied) points to Test users', async () => {
  const fake = await fakeGoogle();
  try {
    const b = browser((u) => ({ error: 'access_denied', state: u.searchParams.get('state') }));
    const { drive } = client(fake, b);
    await assert.rejects(drive.signIn(), (e) => e instanceof AuthError && /Test users/.test(e.message));
  } finally {
    await fake.close();
  }
});

test('sign-in: wrong client secret gives a fix-it message', async () => {
  const fake = await fakeGoogle({ token: [401, { error: 'invalid_client', error_description: 'Unauthorized' }] });
  try {
    const b = browser((u) => ({ code: 'c', state: u.searchParams.get('state') }));
    const { drive } = client(fake, b);
    await assert.rejects(drive.signIn(), (e) => /Client ID or Client secret/.test(e.message));
  } finally {
    await fake.close();
  }
});

test('sign-in can be cancelled', async () => {
  const fake = await fakeGoogle();
  try {
    const { drive } = client(fake, { openExternal: () => {} });
    const p = drive.signIn();
    setTimeout(() => drive.cancelSignIn(), 50);
    await assert.rejects(p, /cancelled/);
  } finally {
    await fake.close();
  }
});

test('folder check: Drive API turned off gives the link to turn it on', async () => {
  const fake = await fakeGoogle({
    folder: [
      403,
      {
        error: {
          code: 403,
          message: 'Google Drive API has not been used in project 123 before or it is disabled.',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'SERVICE_DISABLED' }],
        },
      },
    ],
  });
  try {
    const { drive } = client(fake, null, { refresh_token: 'r', access_token: 'at', expiry: Date.now() + 3600e3 });
    await assert.rejects(drive.getFolder('1AbCdEfGhIjK'), (e) => e instanceof UploadError && /drive\.googleapis\.com/.test(e.message));
  } finally {
    await fake.close();
  }
});

test('setup: pasted Client ID/secret are validated and saved', () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'zcord-setup-')), {});
  assert.throws(() => store.setOAuthClient({ clientId: 'not-an-id', clientSecret: 'x' }), /Client ID/);
  assert.throws(() => store.setOAuthClient({ clientId: '1-a.apps.googleusercontent.com', clientSecret: ' ' }), /secret/);
  store.setOAuthClient({ clientId: ' 1-a.apps.googleusercontent.com ', clientSecret: ' GOCSPX-z ' });
  assert.deepEqual(store.getOAuthClient(), { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'GOCSPX-z', type: 'installed' });
});

test('setup: a "Web application" client file is rejected with an explanation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcord-setup-'));
  const store = new Store(dir, {});
  const webFile = path.join(dir, 'web.json');
  fs.writeFileSync(webFile, JSON.stringify({ web: { client_id: '1-a.apps.googleusercontent.com', client_secret: 's' } }));
  assert.throws(() => store.importOAuthClient(webFile), /Desktop app/);
  // ...and one left over from before is ignored rather than causing a broken sign-in.
  fs.copyFileSync(webFile, path.join(dir, 'google-oauth.json'));
  assert.equal(store.getOAuthClient(), null);

  const desktopFile = path.join(dir, 'desktop.json');
  fs.writeFileSync(desktopFile, JSON.stringify({ installed: { client_id: '2-b.apps.googleusercontent.com', client_secret: 'GOCSPX-y' } }));
  assert.equal(store.importOAuthClient(desktopFile).clientId, '2-b.apps.googleusercontent.com');
});
