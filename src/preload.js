'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:info',
  'app:openScreenPermissionSettings',
  'app:askMic',
  'sources:list',
  'capture:select',
  'rec:start',
  'rec:chunk',
  'rec:paused',
  'rec:finish',
  'rec:state',
  'draw:get',
  'settings:get',
  'settings:set',
  'settings:chooseSaveDir',
  'settings:importOAuth',
  'settings:setOAuthClient',
  'setup:saveToProject',
  'nr:wasm',
  'drive:status',
  'drive:signIn',
  'drive:cancelSignIn',
  'drive:signOut',
  'drive:setFolder',
  'uploads:list',
  'uploads:retry',
  'uploads:remove',
  'shell:openExternal',
  'shell:showFile',
]);
const SEND = new Set(['toolbar:command', 'draw:update', 'draw:action']);
const LISTEN = new Set(['rec:state', 'draw:state', 'draw:action', 'recorder:command', 'uploads:changed', 'drive:changed']);

contextBridge.exposeInMainWorld('zcord', {
  invoke(channel, ...args) {
    if (!INVOKE.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, payload) {
    if (!SEND.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    ipcRenderer.send(channel, payload);
  },
  on(channel, fn) {
    if (!LISTEN.has(channel)) throw new Error(`Blocked channel: ${channel}`);
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
