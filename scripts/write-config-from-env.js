#!/usr/bin/env node
'use strict';

/**
 * Used by the "Build installers" workflow. If the repository has the
 * secrets ZCORD_GOOGLE_CLIENT_ID / ZCORD_GOOGLE_CLIENT_SECRET (and
 * optionally ZCORD_DRIVE_FOLDER), it writes zcord.config.json so the
 * installers come pre-configured. Without them it does nothing, so public
 * builds stay generic.
 */

const path = require('node:path');
const fs = require('node:fs');
const { writeProjectConfig, readProjectConfig } = require('../src/store');
const { parseFolderId } = require('../src/drive');

const file = path.join(__dirname, '..', 'zcord.config.json');
const clientId = (process.env.ZCORD_GOOGLE_CLIENT_ID || '').trim();
const clientSecret = (process.env.ZCORD_GOOGLE_CLIENT_SECRET || '').trim();
const folder = (process.env.ZCORD_DRIVE_FOLDER || '').trim();
const folderName = (process.env.ZCORD_DRIVE_FOLDER_NAME || '').trim();

if (!clientId) {
  console.log(
    fs.existsSync(file)
      ? 'Using the zcord.config.json committed to this repository.'
      : 'No setup secrets: building a generic zcord (each user sets up Google in the app).'
  );
  process.exit(0);
}
if (!clientSecret) {
  console.error('ZCORD_GOOGLE_CLIENT_ID is set but ZCORD_GOOGLE_CLIENT_SECRET is missing.');
  process.exit(1);
}

const folderId = folder ? parseFolderId(folder) : '';
if (folder && !folderId) {
  console.error('ZCORD_DRIVE_FOLDER is not a Google Drive folder link or ID.');
  process.exit(1);
}

writeProjectConfig(file, {
  google: { clientId, clientSecret },
  drive: folderId
    ? { folderId, folderName: folderName || 'Class recordings', folderLink: `https://drive.google.com/drive/folders/${folderId}` }
    : null,
});
if (!readProjectConfig(file)?.google) {
  console.error('The Client ID does not look like a Google OAuth client ID (…apps.googleusercontent.com).');
  process.exit(1);
}
console.log(`Wrote zcord.config.json (Google key${folderId ? ' + class folder' : ''}). Secrets are not printed.`);
