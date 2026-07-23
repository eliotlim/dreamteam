import { useSyncExternalStore } from 'react';

// Single external store. Server messages mutate `state.g`, then emit() swaps
// the top-level reference so useSyncExternalStore re-renders subscribers.

let state = {
  status: 'idle', // idle | connecting | connected | reconnecting | error
  error: null,
  code: null,
  you: null,
  clockOffset: 0, // serverNow - clientNow
  g: null,        // mirrored game state from the server
};

const listeners = new Set();

export const getState = () => state;
export const serverNow = () => Date.now() + state.clockOffset;

function emit() {
  state = { ...state };
  if (import.meta.env.DEV) window.__dt = state;
  for (const fn of listeners) fn();
}

export function useStore() {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    getState,
    getState,
  );
}

export function patch(partial) {
  Object.assign(state, partial);
  emit();
}

const cap = (arr, n) => { while (arr.length > n) arr.shift(); };

export function handleMessage(msg) {
  const g = state.g;
  switch (msg.t) {
    case 'snapshot':
      state.g = msg.g;
      if (msg.you) state.you = msg.you;
      if (msg.now) state.clockOffset = msg.now - Date.now();
      state.status = 'connected';
      break;

    case 'players':
      if (g) g.players = msg.players;
      break;

    case 'config':
      if (g) g.config = msg.config;
      break;

    case 'room':
      if (!g) break;
      if (msg.name !== undefined) g.name = msg.name;
      if (msg.hasPassword !== undefined) g.hasPassword = msg.hasPassword;
      break;

    case 'phase':
      if (!g) break;
      Object.assign(g, {
        phase: msg.phase, sprint: msg.sprint, sprintEndsAt: msg.sprintEndsAt,
        reviewEndsAt: msg.reviewEndsAt, score: msg.score, health: msg.health,
        victory: msg.victory, stats: msg.stats, sprintStats: msg.sprintStats,
        players: msg.players, backlog: msg.backlog,
        services: msg.services ?? g.services, nodes: msg.nodes ?? g.nodes,
      });
      // game end ships the causal ledger + failure analysis for the retro
      if (msg.events) g.events = msg.events;
      if (msg.analysis) g.analysis = msg.analysis;
      // sprint boundaries invalidate live work; a fresh game (sprint 1)
      // also invalidates the previous game's telemetry
      if (msg.phase === 'playing' || msg.phase === 'review') { g.tasks = []; g.incident = null; }
      if (msg.phase === 'playing' && msg.sprint === 1) {
        g.logs = []; g.traces = []; g.metrics = []; g.doneLog = [];
      }
      if (msg.now) state.clockOffset = msg.now - Date.now();
      break;

    case 'task': {
      if (!g) break;
      const t = msg.task;
      g.tasks = g.tasks.filter((x) => x.id !== t.id);
      if (t.status === 'active') {
        g.tasks.push(t);
      } else {
        g.doneLog.push({ ...t, finishedAt: Date.now() });
        cap(g.doneLog, 12);
      }
      break;
    }

    case 'incident': {
      if (!g) break;
      const inc = msg.incident;
      if (inc.status === 'active') {
        g.incident = inc;
      } else {
        g.incident = null;
        g.doneLog.push({
          id: inc.id, kind: 'incident', title: inc.title,
          status: inc.status === 'resolved' ? 'done' : 'failed',
          finishedAt: Date.now(),
        });
        cap(g.doneLog, 12);
      }
      break;
    }

    case 'control': {
      const p = g?.players?.[msg.pid];
      const c = p?.controls?.find((c) => c.key === msg.key);
      if (c) c.value = msg.value;
      break;
    }

    case 'chat':
      if (!g) break;
      g.chat.push(msg.msg);
      cap(g.chat, 100);
      break;

    case 'services':
      if (!g) break;
      g.services = msg.services;
      if (msg.nodes) g.nodes = msg.nodes;
      break;

    case 'tick':
      if (!g) break;
      state.clockOffset = msg.now - Date.now();
      Object.assign(g, {
        score: msg.score, health: msg.health,
        sprint: msg.sprint, sprintEndsAt: msg.sprintEndsAt,
      });
      if (msg.nodes) g.nodes = msg.nodes;
      if (msg.incident !== undefined) g.incident = msg.incident;
      g.metrics.push(msg.m);
      cap(g.metrics, 90);
      for (const l of msg.logs || []) g.logs.push(l);
      cap(g.logs, 120);
      if (msg.trace) { g.traces.push(msg.trace); cap(g.traces, 20); }
      break;

    default:
      return; // unknown message; don't emit
  }
  emit();
}
