import type { ClientMsg, GameConfig, IncidentKind, PlayerRole } from '../../shared/types.ts';
import { handleMessage, patch } from './store.ts';

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;
let manualClose = false;

export interface RoomInfo {
  exists: boolean;
  phase?: string | null;
  hasPassword?: boolean;
  passOk?: boolean;
}

export function playerId(): string {
  let pid = localStorage.getItem('dt-pid');
  if (!pid) {
    pid = crypto.randomUUID().slice(0, 8);
    localStorage.setItem('dt-pid', pid);
  }
  return pid;
}

export async function createRoom(): Promise<string> {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) throw new Error('could not create room');
  const { code } = (await res.json()) as { code: string };
  return code;
}

// Existence + password pre-check: { exists, phase, hasPassword, passOk }
export async function roomInfo(code: string, pass = ''): Promise<RoomInfo> {
  const q = pass ? `?pass=${encodeURIComponent(pass)}` : '';
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}${q}`);
  if (!res.ok) return { exists: false };
  return res.json() as Promise<RoomInfo>;
}

export function connect(code: string, name: string, pass = '') {
  manualClose = false;
  clearTimeout(retryTimer);
  localStorage.setItem('dt-room', code);
  patch({ status: retries ? 'reconnecting' : 'connecting', code, error: null });

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ name, pid: playerId() });
  if (pass) q.set('pass', pass);
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
    retryTimer = setTimeout(() => connect(code, name, pass), Math.min(500 * 2 ** retries, 8000));
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

export function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export type ConfigPatch = Omit<Partial<GameConfig>, 'incidents'> & {
  incidents?: Partial<Record<IncidentKind, boolean>>;
};

export const sendChat = (text: string) => send({ t: 'chat', text });
export const setControl = (key: string, value: number) => send({ t: 'control', key, value });
export const pressButton = (key: string) => send({ t: 'control', key, press: true });
export const guessCodeLine = (taskId: string, line: number) => send({ t: 'code_guess', taskId, line });
export const shipCode = (taskId: string) => send({ t: 'code_ship', taskId });
export const pickTriage = (taskId: string, choice: number) => send({ t: 'triage_pick', taskId, choice });
export const pickDesign = (taskId: string, choice: number) => send({ t: 'design_pick', taskId, choice });
export const requestHint = () => send({ t: 'hint' });
export const setRole = (role: PlayerRole) => send({ t: 'set_role', role });
export const renameSelf = (name: string) => send({ t: 'rename', name });
export const setRoomName = (name: string) => send({ t: 'set_name', name });
export const setPassword = (password: string) => send({ t: 'set_password', password });
export const makeHost = (pid: string) => send({ t: 'make_host', pid });
export const setConfig = (p: ConfigPatch) => send({ t: 'config', patch: p });
export const startGame = () => send({ t: 'start' });
export const nextSprint = () => send({ t: 'next_sprint' });
export const restartGame = () => send({ t: 'restart' });
