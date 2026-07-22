import { handleMessage, patch, getState } from './store.js';

let ws = null;
let retryTimer = null;
let retries = 0;
let manualClose = false;

export function playerId() {
  let pid = localStorage.getItem('dt-pid');
  if (!pid) {
    pid = crypto.randomUUID().slice(0, 8);
    localStorage.setItem('dt-pid', pid);
  }
  return pid;
}

export async function createRoom() {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) throw new Error('could not create room');
  const { code } = await res.json();
  return code;
}

export async function roomExists(code) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return false;
  const { exists } = await res.json();
  return exists;
}

export function connect(code, name) {
  manualClose = false;
  clearTimeout(retryTimer);
  localStorage.setItem('dt-room', code);
  patch({ status: retries ? 'reconnecting' : 'connecting', code, error: null });

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ name, pid: playerId() });
  ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws?${q}`);

  ws.onopen = () => { retries = 0; };
  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch { /* malformed */ }
  };
  ws.onclose = (e) => {
    console.info(`[dt] ws closed code=${e.code} reason=${e.reason || '-'}`);
    ws = null;
    if (manualClose) return;
    retries++;
    if (retries > 8) {
      patch({ status: 'error', error: 'Connection lost. Refresh to retry.' });
      return;
    }
    patch({ status: 'reconnecting' });
    retryTimer = setTimeout(() => connect(code, name), Math.min(500 * 2 ** retries, 8000));
  };
}

export function disconnect() {
  manualClose = true;
  clearTimeout(retryTimer);
  localStorage.removeItem('dt-room');
  ws?.close();
  ws = null;
  patch({ status: 'idle', code: null, g: null, you: null });
}

// After a page refresh mid-game, rejoin the room automatically.
export function tryResume() {
  const code = new URLSearchParams(location.search).get('room')?.toUpperCase();
  const last = localStorage.getItem('dt-room');
  const name = localStorage.getItem('dt-name') || '';
  if (code && code === last) {
    connect(code, name);
    return true;
  }
  return false;
}

export function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export const sendChat = (text) => send({ t: 'chat', text });
export const setControl = (key, value) => send({ t: 'control', key, value });
export const pressButton = (key) => send({ t: 'control', key, press: true });
export const setRole = (role) => send({ t: 'set_role', role });
export const setConfig = (p) => send({ t: 'config', patch: p });
export const startGame = () => send({ t: 'start' });
export const nextSprint = () => send({ t: 'next_sprint' });
export const restartGame = () => send({ t: 'restart' });
