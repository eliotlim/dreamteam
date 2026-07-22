import { DurableObject } from 'cloudflare:workers';
import {
  ROLES, CRITICAL_CONTROLS, CONTROL_POOL, FEATURES, BUGS, INCIDENTS, MODES,
  CODE_SNIPPETS, TRIAGE_TICKETS, TRIAGE_OPTIONS,
  SERVICES, CORE_SERVICES, EPIC_FEATURES, REGIONS, AMBIENT_LOGS, SERVICE_LOGS,
  TRACE_ROUTES, BOTS, CEO_SPRINT_LINES, CEO_INCIDENT_LINES, instructionFor,
  NAME_ADJECTIVES, NAME_NOUNS,
} from '../shared/content.js';

const TICK_MS = 1000;
const REVIEW_SECONDS = 15;
const PER_REPLICA_RPS = 35;

// Deterministic starting values for the ops console — the sim needs a sane
// initial state (3 pods, warm-ish cache, moderate drain, nothing to zero).
const CRITICAL_INIT = {
  autoscaler: 0, circuit_breaker: 0, queue_drain: 4, replicas: 3, cache_ttl: 3,
};

export const DEFAULT_CONFIG = {
  preset: 'standard',
  mode: 'arcade',         // arcade | assisted | realism — how much the game tells you
  megaMode: false,        // crowd play: dials duplicated, missions need a quorum
  botChatter: true,       // flavor bots in chat
  codeChance: MODES.arcade.codeChance,       // chance a task is a find-the-bug code review
  triageChance: MODES.arcade.triageChance,   // chance a task is a ticket triage
  sprintCount: 3,
  // --- advanced ---
  sprintSeconds: 150,
  controlsPerPlayer: 4,
  taskEverySec: 8,
  taskDeadlineSec: 30,
  incidentEverySec: 45,
  incidentDeadlineSec: 60,
  maxActivePerPlayer: 2,
  bugChance: 0.3,
  missPenalty: 8,
  incidentDrainPerSec: 0.5,
  healOnComplete: 2,
  difficultyRamp: 0.25,
  spikeMult: 4,
  incidents: Object.fromEntries(Object.keys(INCIDENTS).map((k) => [k, true])),
};

// Presets tune pacing AND how much infrastructure you start with.
export const PRESETS = {
  chill: {
    taskEverySec: 12, taskDeadlineSec: 45, incidentEverySec: 75,
    incidentDeadlineSec: 90, missPenalty: 5, incidentDrainPerSec: 0.25,
    sprintSeconds: 120, difficultyRamp: 0.15, spikeMult: 3,
    startingServices: [],
  },
  standard: { startingServices: ['cache', 'queue'] },
  chaos: {
    taskEverySec: 5, taskDeadlineSec: 22, incidentEverySec: 30,
    incidentDeadlineSec: 45, missPenalty: 10, incidentDrainPerSec: 0.8,
    sprintSeconds: 180, difficultyRamp: 0.35, spikeMult: 5,
    startingServices: ['cache', 'queue', 'payments'],
  },
};

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => crypto.randomUUID().slice(0, 8);

function freshSim() {
  return {
    rps: 90, util: 0.7, err: 0.5, p95: 160, queueDepth: 12, dbIops: 150,
    crashedPods: 0, trafficMult: 1, paymentsUp: true, failedRegion: null,
    leak: 0, leakFixed: false, cacheWarmth: 1, badDeploy: false,
    dbCorrupt: false, restoring: 0, dnsSwitchedAt: null,
    stableTicks: 0,
  };
}

function freshState(code) {
  return {
    code,
    createdAt: Date.now(),
    phase: 'lobby',
    config: structuredClone(DEFAULT_CONFIG),
    players: {},
    services: [...CORE_SERVICES, ...PRESETS.standard.startingServices],
    sprint: 0,
    sprintEndsAt: 0,
    reviewEndsAt: 0,
    score: 0,
    health: 100,
    victory: false,
    tasks: [],
    doneLog: [],
    incident: null,
    backlog: [],
    chat: [],
    logs: [],
    traces: [],
    metrics: [],
    nodes: {},
    sim: freshSim(),
    stats: { shipped: 0, bugsFixed: 0, incidentsResolved: 0, triaged: 0, missed: 0, sprints: [] },
    sprintStats: null,
    usedSnippets: [],
    usedTickets: [],
    nextTaskAt: 0,
    nextIncidentAt: 0,
    nextTraceAt: 0,
    tickCount: 0,
  };
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
      const row = [...ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'game'`)][0];
      this.g = row ? JSON.parse(row.v) : null;
      // migrate rooms persisted before game modes existed
      if (this.g?.config && !this.g.config.mode) {
        this.g.config.mode = 'arcade';
        this.g.config.codeChance ??= MODES.arcade.codeChance;
        this.g.config.triageChance ??= MODES.arcade.triageChance;
      }
    });
  }

  persist() {
    if (!this.g) return;
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('game', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(this.g),
    );
  }

  // ------------------------------------------------------------- HTTP entry

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      if (!this.g) {
        this.g = freshState(url.searchParams.get('code') || '????');
        this.persist();
      }
      return Response.json({ ok: true, code: this.g.code });
    }

    if (url.pathname.endsWith('/exists')) {
      return Response.json({ exists: !!this.g, phase: this.g?.phase ?? null });
    }

    if (url.pathname.endsWith('/ws')) {
      if (!this.g) return new Response('room not found', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const name = (url.searchParams.get('name') || '').trim().slice(0, 24)
        || `${pick(NAME_ADJECTIVES)}_${pick(NAME_NOUNS)}`;
      const pid = url.searchParams.get('pid') || uid();
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ pid });
      this.handleJoin(pid, name, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  // ------------------------------------------------------------- join/leave

  handleJoin(pid, name, ws) {
    const g = this.g;
    let p = g.players[pid];
    if (!p) {
      const takenRoles = Object.values(g.players).filter((x) => x.connected).map((x) => x.role);
      const role = ROLES.find((r) => !takenRoles.includes(r)) || pick(ROLES);
      p = {
        id: pid, name, role,
        isHost: !Object.values(g.players).some((x) => x.isHost),
        connected: true, joinedAt: Date.now(), controls: [],
      };
      g.players[pid] = p;
      if (g.phase === 'playing' && role !== 'spectator') this.dealPoolControls(p);
      this.botSay('system', `${name} joined the team 👋`);
    } else {
      p.connected = true;
      p.name = name || p.name;
    }
    this.persist();
    this.send(ws, { t: 'snapshot', g: this.publicState(), you: pid, now: Date.now() });
    this.broadcast({ t: 'players', players: this.publicPlayers() }, ws);
  }

  webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (!att || !this.g) return;
    const stillHere = this.ctx.getWebSockets().some(
      (o) => o !== ws && o.deserializeAttachment()?.pid === att.pid,
    );
    if (stillHere) return;
    const p = this.g.players[att.pid];
    if (!p) return;
    p.connected = false;
    if (p.isHost) {
      p.isHost = false;
      const next = Object.values(this.g.players)
        .filter((x) => x.connected)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) next.isHost = true;
    }
    if (this.g.phase === 'playing') {
      const orphaned = this.g.tasks.filter((t) => t.ownerPid === p.id || t.displayPid === p.id);
      for (const t of orphaned) this.finishTask(t, 'cancelled');
      if (orphaned.length) {
        this.botSay('system', `${p.name} stepped away — ${orphaned.length} task(s) reassigned to the void.`);
      }
    }
    this.persist();
    this.broadcast({ t: 'players', players: this.publicPlayers() });
  }

  webSocketError(ws) { this.webSocketClose(ws); }

  // ------------------------------------------------------------- messages

  webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment();
    const g = this.g;
    if (!att || !g) return;
    const p = g.players[att.pid];
    if (!p) return;

    switch (msg.t) {
      case 'set_role': {
        if (g.phase !== 'lobby') break;
        if (![...ROLES, 'spectator'].includes(msg.role)) break;
        p.role = msg.role;
        this.persist();
        this.broadcast({ t: 'players', players: this.publicPlayers() });
        break;
      }
      case 'config': {
        if (!p.isHost || g.phase !== 'lobby') break;
        this.applyConfig(msg.patch || {});
        this.persist();
        this.broadcast({ t: 'config', config: g.config });
        break;
      }
      case 'start': {
        if (!p.isHost || g.phase !== 'lobby') break;
        this.startGame();
        break;
      }
      case 'next_sprint': {
        if (!p.isHost || g.phase !== 'review') break;
        this.startSprint(g.sprint + 1);
        break;
      }
      case 'restart': {
        if (!p.isHost || !['ended', 'review', 'playing'].includes(g.phase)) break;
        this.toLobby();
        break;
      }
      case 'control': {
        this.handleControl(p, msg.key, msg.value, !!msg.press);
        break;
      }
      case 'code_guess': {
        if (g.phase !== 'playing') break;
        const task = g.tasks.find((x) => x.id === msg.taskId && x.kind === 'code');
        if (!task || task.displayPid !== p.id) break;
        if (Number(msg.line) === task.bugLine) {
          this.completeTask(task);
        } else {
          task.wrongGuesses = (task.wrongGuesses ?? 0) + 1;
          task.deadlineAt -= 4000;
          g.score = Math.max(0, g.score - 10);
          this.broadcast({ t: 'task', task });
        }
        this.persist();
        break;
      }
      case 'triage_pick': {
        if (g.phase !== 'playing') break;
        const task = g.tasks.find((x) => x.id === msg.taskId && x.kind === 'triage');
        if (!task || task.displayPid !== p.id) break;
        if (Number(msg.choice) === task.answer) {
          this.completeTask(task);
        } else {
          task.wrongGuesses = (task.wrongGuesses ?? 0) + 1;
          task.deadlineAt -= 4000;
          g.score = Math.max(0, g.score - 10);
          this.broadcast({ t: 'task', task });
        }
        this.persist();
        break;
      }
      case 'hint': {
        if (g.phase !== 'playing' || !g.incident) break;
        if (g.config.mode !== 'assisted' || g.incident.hint) break;
        const cost = MODES.assisted.hintCost;
        g.incident.hint = INCIDENTS[g.incident.kind].hint;
        g.incident.hintAvailable = false;
        g.score = Math.max(0, g.score - cost);
        this.botSay('system', `${p.name} pulled up the runbook (−${cost} pts) 💡`);
        this.broadcast({ t: 'incident', incident: g.incident });
        this.persist();
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 300);
        if (!text) break;
        const m = { id: uid(), from: p.name, pid: p.id, role: p.role, text, ts: Date.now() };
        g.chat.push(m);
        if (g.chat.length > 100) g.chat.shift();
        this.persist();
        this.broadcast({ t: 'chat', msg: m });
        break;
      }
    }
  }

  applyConfig(patch) {
    const c = this.g.config;
    const num = (k, lo, hi) => { if (typeof patch[k] === 'number' && !Number.isNaN(patch[k])) c[k] = clamp(patch[k], lo, hi); };
    if (typeof patch.preset === 'string' && PRESETS[patch.preset]) {
      const { startingServices, ...knobs } = PRESETS[patch.preset];
      Object.assign(c, structuredClone(DEFAULT_CONFIG), knobs, {
        preset: patch.preset, incidents: c.incidents, mode: c.mode,
        codeChance: c.codeChance, triageChance: c.triageChance, botChatter: c.botChatter,
      });
      this.g.services = [...CORE_SERVICES, ...startingServices];
    }
    if (typeof patch.mode === 'string' && MODES[patch.mode]) {
      c.mode = patch.mode;
      c.codeChance = MODES[patch.mode].codeChance;
      c.triageChance = MODES[patch.mode].triageChance;
    }
    num('sprintSeconds', 45, 600);
    num('sprintCount', 1, 10);
    num('controlsPerPlayer', 2, 8);
    num('taskEverySec', 3, 60);
    num('taskDeadlineSec', 10, 120);
    num('incidentEverySec', 15, 300);
    num('incidentDeadlineSec', 20, 180);
    num('maxActivePerPlayer', 1, 4);
    num('bugChance', 0, 1);
    num('missPenalty', 0, 25);
    num('incidentDrainPerSec', 0, 3);
    num('healOnComplete', 0, 10);
    num('difficultyRamp', 0, 1);
    num('spikeMult', 2, 8);
    num('codeChance', 0, 1);
    num('triageChance', 0, 1);
    if (typeof patch.botChatter === 'boolean') c.botChatter = patch.botChatter;
    if (typeof patch.megaMode === 'boolean') c.megaMode = patch.megaMode;
    if (patch.incidents && typeof patch.incidents === 'object') {
      for (const k of Object.keys(INCIDENTS)) {
        if (typeof patch.incidents[k] === 'boolean') c.incidents[k] = patch.incidents[k];
      }
    }
    // mode & botChatter are orthogonal to pacing — only knob changes mark the preset custom
    const cosmetic = ['preset', 'mode', 'botChatter', 'megaMode'];
    if (typeof patch.preset !== 'string' && Object.keys(patch).some((k) => !cosmetic.includes(k))) {
      c.preset = 'custom';
    }
  }

  // ------------------------------------------------------------- controls helpers

  findControl(key) {
    for (const p of Object.values(this.g.players)) {
      const c = p.controls.find((c) => c.key === key);
      if (c) return { p, c };
    }
    return null;
  }

  ctlVal(key, fallback = 0) {
    return this.findControl(key)?.c.value ?? fallback;
  }

  setCtl(key, value) {
    const found = this.findControl(key);
    if (!found) return;
    found.c.value = value;
    this.broadcast({ t: 'control', pid: found.p.id, key, value });
  }

  // ------------------------------------------------------------- game flow

  activePlayers() {
    return Object.values(this.g.players).filter((p) => p.connected && p.role !== 'spectator');
  }

  startGame() {
    const g = this.g;
    if (this.activePlayers().length === 0) return;
    g.score = 0;
    g.health = 100;
    g.victory = false;
    g.tasks = [];
    g.doneLog = [];
    g.incident = null;
    g.logs = [];
    g.traces = [];
    g.metrics = [];
    g.sim = freshSim();
    g.stats = { shipped: 0, bugsFixed: 0, incidentsResolved: 0, triaged: 0, missed: 0, sprints: [] };
    g.usedSnippets = [];
    g.usedTickets = [];
    this.buildBacklog();
    this.dealAllControls();
    this.startSprint(1);
  }

  buildBacklog() {
    const g = this.g;
    const epics = shuffle(EPIC_FEATURES.filter((e) => !g.services.includes(e.service)));
    const base = shuffle(FEATURES);
    // interleave: an epic every ~3 features so the infra grows steadily
    const out = [];
    while (base.length || epics.length) {
      out.push(...base.splice(0, 2).map((title) => ({ title })));
      if (epics.length) out.push(epics.shift());
    }
    g.backlog = out;
  }

  dealAllControls() {
    const players = this.activePlayers();
    const cfg = this.g.config;
    for (const p of players) p.controls = [];
    const byLoad = () => [...players].sort((a, b) => a.controls.length - b.controls.length);
    for (const def of shuffle(CRITICAL_CONTROLS)) {
      const match = byLoad().find((p) => p.role === def.role);
      (match || byLoad()[0]).controls.push(this.instantiate(def, true));
    }
    if (cfg.megaMode) {
      // mega mode: deal a small set of pool dials round-robin so every dial
      // lives on ~2+ screens — missions then demand a quorum of holders
      const slots = players.reduce(
        (n, p) => n + Math.max(0, cfg.controlsPerPlayer - p.controls.length), 0);
      const nKeys = clamp(Math.ceil(slots / 2), 2, CONTROL_POOL.length);
      const chosen = shuffle(CONTROL_POOL).slice(0, nKeys);
      let ci = 0;
      let progress = true;
      while (progress) {
        progress = false;
        for (const p of byLoad()) {
          if (p.controls.length >= cfg.controlsPerPlayer) continue;
          for (let k = 0; k < chosen.length; k++) {
            const def = chosen[(ci + k) % chosen.length];
            if (p.controls.some((c) => c.key === def.key)) continue;
            p.controls.push(this.instantiate(def, false));
            ci = (ci + k + 1) % chosen.length;
            progress = true;
            break;
          }
        }
      }
      return;
    }
    const pool = shuffle(CONTROL_POOL);
    for (const p of players) {
      const preferred = pool.filter((d) => d.role === p.role);
      const rest = pool.filter((d) => d.role !== p.role);
      for (const def of [...preferred, ...rest]) {
        if (p.controls.length >= this.g.config.controlsPerPlayer) break;
        if (p.controls.some((c) => c.key === def.key)) continue;
        if (players.some((o) => o !== p && o.controls.some((c) => c.key === def.key))) continue;
        p.controls.push(this.instantiate(def, false));
      }
    }
  }

  dealPoolControls(p) {
    const cfg = this.g.config;
    const taken = new Set(
      Object.values(this.g.players).flatMap((x) => x.controls.map((c) => c.key)),
    );
    if (cfg.megaMode) {
      // late joiners swell the existing quorum pools before drawing new dials
      const dealt = shuffle(CONTROL_POOL.filter((d) => taken.has(d.key)));
      const fresh = shuffle(CONTROL_POOL.filter((d) => !taken.has(d.key)));
      p.controls = [...dealt, ...fresh]
        .slice(0, cfg.controlsPerPlayer)
        .map((d) => this.instantiate(d, false));
      return;
    }
    const pool = shuffle(CONTROL_POOL).filter((d) => !taken.has(d.key));
    const preferred = pool.filter((d) => d.role === p.role);
    const rest = pool.filter((d) => d.role !== p.role);
    p.controls = [...preferred, ...rest]
      .slice(0, this.g.config.controlsPerPlayer)
      .map((d) => this.instantiate(d, false));
  }

  instantiate(def, crit) {
    const c = { key: def.key, label: def.label, type: def.type, value: 0, crit };
    if (def.type === 'slider') {
      c.min = def.min ?? 0;
      c.max = def.max;
      c.value = c.min + rnd(c.max - c.min + 1);
    }
    if (def.type === 'select') { c.options = def.options; c.value = rnd(def.options.length); }
    if (def.type === 'toggle') c.value = rnd(2);
    if (def.key in CRITICAL_INIT) c.value = CRITICAL_INIT[def.key];
    if (def.key === 'dns_primary') c.value = rnd(REGIONS.length);
    return c;
  }

  ramp() { return 1 + this.g.config.difficultyRamp * (this.g.sprint - 1); }

  startSprint(n) {
    const g = this.g;
    const now = Date.now();
    g.phase = 'playing';
    g.sprint = n;
    g.sprintEndsAt = now + g.config.sprintSeconds * 1000;
    g.sprintStats = { shipped: 0, bugsFixed: 0, incidentsResolved: 0, triaged: 0, missed: 0, scoreStart: g.score };
    g.tasks = [];
    g.incident = null;
    g.sim.trafficMult = 1;
    g.sim.crashedPods = 0;
    g.sim.paymentsUp = true;
    g.sim.failedRegion = null;
    g.sim.dnsSwitchedAt = null;
    g.sim.leak = 0;
    g.sim.leakFixed = false;
    g.sim.badDeploy = false;
    g.sim.dbCorrupt = false;
    g.sim.restoring = 0;
    g.sim.cacheWarmth = 1;
    if (n > 1) g.health = clamp(g.health + 10, 0, 100);
    g.nextTaskAt = now + 3000;
    g.nextIncidentAt = now + (g.config.incidentEverySec * 1000) / this.ramp();
    g.nextTraceAt = now;
    if (g.config.botChatter) this.botSay('ceo', pick(CEO_SPRINT_LINES));
    this.botSay('system', `Sprint ${n} of ${g.config.sprintCount} started — ${g.config.sprintSeconds}s on the clock. Ship it! 🚀`);
    this.persist();
    this.broadcastPhase();
    this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  endSprint() {
    const g = this.g;
    const s = g.sprintStats;
    s.scoreDelta = g.score - s.scoreStart;
    g.stats.sprints.push({ sprint: g.sprint, ...s });
    for (const t of g.tasks) this.finishTask(t, 'cancelled');
    g.tasks = [];
    if (g.incident) this.clearIncident(false, true);
    if (g.sprint >= g.config.sprintCount) {
      g.victory = true;
      this.endGame();
      return;
    }
    g.phase = 'review';
    g.reviewEndsAt = Date.now() + REVIEW_SECONDS * 1000;
    this.botSay('system', `Sprint ${g.sprint} review: ${s.shipped} shipped, ${s.bugsFixed} bugs fixed, ${s.incidentsResolved} incidents resolved, ${s.missed} missed.`);
    this.persist();
    this.broadcastPhase();
    this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  endGame() {
    const g = this.g;
    g.phase = 'ended';
    this.botSay('ceo', g.victory
      ? 'We shipped the roadmap AND the site is up?! Promotions for everyone. (Figuratively.)'
      : 'The site is down and morale is downer. Mandatory fun retreat next week.');
    this.persist();
    this.broadcastPhase();
    this.ctx.storage.deleteAlarm();
  }

  toLobby() {
    const g = this.g;
    g.phase = 'lobby';
    g.sprint = 0;
    g.tasks = [];
    g.doneLog = [];
    g.incident = null;
    g.sim = freshSim();
    for (const p of Object.values(g.players)) p.controls = [];
    const { startingServices = [] } = PRESETS[g.config.preset] || {};
    g.services = [...CORE_SERVICES, ...startingServices];
    this.persist();
    this.ctx.storage.deleteAlarm();
    this.broadcast({ t: 'snapshot', g: this.publicState(), now: Date.now() });
  }

  // ------------------------------------------------------------- simulation

  simTick(now) {
    const g = this.g;
    const sim = g.sim;
    const cfg = g.config;
    const has = (svc) => g.services.includes(svc);
    const inc = g.incident;

    // --- demand ---
    const growth = 1 + 0.2 * (g.sprint - 1);
    let demand = (85 + 30 * Math.sin(now / 20000) + (Math.random() - 0.5) * 16) * growth;
    const firewall = this.ctlVal('firewall', 2);
    if (inc?.kind === 'spike') {
      const ramp = Math.min(1, (now - inc.startedAt) / 6000);
      sim.trafficMult = 1 + (cfg.spikeMult - 1) * ramp;
    } else if (inc?.kind === 'ddos') {
      const ramp = Math.min(1, (now - inc.startedAt) / 5000);
      const shed = Math.min(0.95, firewall / 8);           // strict firewall drops the bots
      sim.trafficMult = 1 + cfg.spikeMult * ramp * (1 - shed);
    } else {
      sim.trafficMult = Math.max(1, sim.trafficMult - 0.3); // spikes subside
    }
    demand *= sim.trafficMult;
    sim.rps = Math.max(5, Math.round(demand));

    // --- memory leak decays capacity until pods are restarted ---
    if (inc?.kind === 'memleak' && !sim.leakFixed) {
      sim.leak = Math.min(0.6, sim.leak + 0.04);
    }

    // --- cache warmth rebuilds over time, faster with a longer TTL ---
    const cacheTtl = this.ctlVal('cache_ttl', 3);
    if (has('cache')) {
      sim.cacheWarmth = Math.min(1, sim.cacheWarmth + 0.008 + 0.012 * cacheTtl);
    }

    // --- restore-from-backup countdown; RPO depends on the backup dial ---
    if (sim.restoring > 0) {
      sim.restoring--;
      if (sim.restoring === 0 && sim.dbCorrupt) {
        sim.dbCorrupt = false;
        const freq = this.ctlVal('backup_freq', 3);
        if (freq >= 6) {
          this.botSay('system', 'Database restored from a 5-minute-old snapshot — barely any data lost 📦✨');
        } else if (freq >= 3) {
          this.botSay('system', 'Database restored from backup — lost about an hour of writes 📦');
        } else {
          g.health -= 8;
          this.botSay('system', 'Database restored, but the last backup was ancient — a full day of data gone 📦💀 (−8 health)');
        }
      }
    }

    // --- capacity ---
    const replicas = this.ctlVal('replicas', 3);
    const effReplicas = Math.max(1, replicas - sim.crashedPods);
    const cacheFactor = has('cache') ? 1 + 0.06 * cacheTtl * sim.cacheWarmth : 1;
    const cdnFactor = has('cdn') ? 1.1 : 1;
    const coldRegion = sim.dnsSwitchedAt && now - sim.dnsSwitchedAt < 16000;
    const capacity = effReplicas * PER_REPLICA_RPS * cacheFactor * cdnFactor
      * (1 - sim.leak) * (coldRegion ? 0.75 : 1);
    sim.util = sim.rps / capacity;

    // --- autoscaler nudges the real replicas dial (owner sees it move) ---
    if (this.ctlVal('autoscaler') === 1 && g.tickCount % 3 === 0) {
      if (sim.util > 0.85 && replicas < 8) this.setCtl('replicas', replicas + 1);
      else if (sim.util < 0.35 && replicas > 1) this.setCtl('replicas', replicas - 1);
    }

    // --- latency & errors follow utilization ---
    let p95 = 130 + 60 * sim.util + (Math.random() - 0.5) * 30;
    if (sim.util > 0.8) p95 += (sim.util - 0.8) * 1200;
    p95 += sim.leak * 500;                                 // GC pauses
    let err = 0.3 + Math.random() * 0.5;
    if (sim.util > 1) err += (sim.util - 1) * 45;          // load shedding
    if (sim.crashedPods > 0) err += 6;                     // crash-looping pods
    if (sim.badDeploy) { err += 18; p95 += 120; }          // broken build in prod
    if (sim.dbCorrupt) err += 22;                          // writes failing integrity checks
    else if (sim.restoring > 0) err += 8;                  // restore still in progress
    if (inc?.kind === 'ddos' && firewall < 6) err += 5;    // junk auth traffic errors
    const breakerOn = this.ctlVal('circuit_breaker') === 1;
    if (has('payments') && !sim.paymentsUp) {
      err += breakerOn ? 2 : 14;                           // fail fast vs timeouts
      p95 += breakerOn ? 20 : 350;
    }
    const dnsRegion = REGIONS[this.ctlVal('dns_primary', 0)];
    if (sim.failedRegion) {
      if (dnsRegion === sim.failedRegion) {
        sim.dnsSwitchedAt = null;                          // pointing at the dead region
        err += 28; p95 += 500;
      } else {
        if (!sim.dnsSwitchedAt) {
          sim.dnsSwitchedAt = now;
          this.botSay('system', '🌐 DNS record updated — waiting out TTL propagation…');
        }
        if (now - sim.dnsSwitchedAt < 8000) { err += 12; p95 += 220; } // stale resolvers
      }
    }

    // --- queue dynamics ---
    if (has('queue')) {
      let inflow = sim.rps * 0.12;
      if (has('payments') && !sim.paymentsUp && !breakerOn) inflow += sim.rps * 0.4; // retry storm
      if (g.incident?.kind === 'queue' && now - g.incident.startedAt < 15000) inflow += 30;
      const outflow = 4 + 7 * this.ctlVal('queue_drain', 4);
      sim.queueDepth = clamp(sim.queueDepth + Math.round(inflow - outflow), 0, 999);
      if (sim.queueDepth > 250) err += 4;                  // jobs timing out
    } else {
      sim.queueDepth = 0;
    }

    // --- db ---
    const cacheHitRatio = has('cache') ? (0.35 + 0.06 * cacheTtl) * sim.cacheWarmth : 0;
    sim.dbIops = Math.round(sim.rps * 2.2 * (1 - cacheHitRatio) * (sim.failedRegion && dnsRegion !== sim.failedRegion ? 1.4 : 1));

    sim.err = Math.round(clamp(err, 0, 100) * 10) / 10;
    sim.p95 = Math.round(clamp(p95, 40, 3000));
    sim.cacheHit = Math.round(cacheHitRatio * 100);

    // sustained customer pain drains morale even outside incidents
    if (sim.err > 12) g.health -= 0.2;
  }

  nodeStats() {
    const g = this.g;
    const sim = g.sim;
    const has = (svc) => g.services.includes(svc);
    const dnsRegion = REGIONS[this.ctlVal('dns_primary', 0)];
    const replicas = this.ctlVal('replicas', 3);
    const breakerOn = this.ctlVal('circuit_breaker') === 1;
    const nodes = {};

    nodes.dns = {
      v: dnsRegion,
      s: sim.failedRegion && dnsRegion === sim.failedRegion ? 'down' : 'ok',
    };
    nodes.lb = {
      v: `${sim.rps} rps`,
      s: sim.util > 1.2 || (g.incident?.kind === 'ddos' && this.ctlVal('firewall', 2) < 6) ? 'degraded' : 'ok',
    };
    nodes.frontend = {
      v: `${sim.p95} ms p95`,
      s: sim.util > 1.15 || sim.crashedPods > 0 ? 'degraded' : 'ok',
    };
    nodes.backend = {
      v: `${Math.round(sim.util * 100)}% load · ${replicas - sim.crashedPods}/${replicas} pods`,
      s: sim.crashedPods > 0 || sim.util > 1.15 ? 'down'
        : sim.util > 0.85 || sim.leak > 0.15 || sim.badDeploy ? 'degraded' : 'ok',
    };
    nodes.db = sim.dbCorrupt
      ? { v: sim.restoring > 0 ? `restoring… ${sim.restoring}s` : 'integrity errors', s: sim.restoring > 0 ? 'degraded' : 'down' }
      : {
          v: `${sim.dbIops} iops`,
          s: (sim.failedRegion && dnsRegion === sim.failedRegion) || sim.dbIops > 700 ? 'degraded' : 'ok',
        };
    if (has('cdn')) nodes.cdn = { v: `${70 + rnd(25)}% hit`, s: 'ok' };
    if (has('cache')) {
      nodes.cache = {
        v: `${sim.cacheHit}% hit`,
        s: sim.cacheWarmth < 0.25 ? 'down' : sim.cacheWarmth < 0.6 ? 'degraded' : 'ok',
      };
    }
    if (has('queue')) {
      nodes.queue = {
        v: `${sim.queueDepth} jobs`,
        s: sim.queueDepth > 250 ? 'down' : sim.queueDepth > 100 ? 'degraded' : 'ok',
      };
    }
    if (has('payments')) {
      nodes.payments = {
        v: sim.paymentsUp ? `${40 + rnd(60)} ms` : breakerOn ? 'breaker open' : 'timeouts',
        s: sim.paymentsUp ? 'ok' : breakerOn ? 'degraded' : 'down',
      };
    }
    if (has('search')) nodes.search = { v: `${Math.round(sim.rps * 0.3)} qps`, s: 'ok' };
    if (has('analytics')) nodes.analytics = { v: `${Math.round(sim.rps * 4)} ev/s`, s: 'ok' };
    return nodes;
  }

  // ------------------------------------------------------------- tick

  async alarm() {
    const g = this.g;
    if (!g) return;
    if (g.phase === 'review') {
      if (Date.now() >= g.reviewEndsAt) { this.startSprint(g.sprint + 1); return; }
      this.ctx.storage.setAlarm(Date.now() + TICK_MS);
      return;
    }
    if (g.phase !== 'playing') return;

    const now = Date.now();
    g.tickCount++;
    const logs = [];

    this.simTick(now);

    // task deadlines
    for (const t of [...g.tasks]) {
      if (now >= t.deadlineAt) {
        this.finishTask(t, 'failed');
        g.health -= g.config.missPenalty;
        g.stats.missed++; g.sprintStats.missed++;
        if (g.config.botChatter && Math.random() < 0.4) {
          this.botSay('support', `Ticket escalated: "${t.title}" — customer says "unacceptable" 😤`);
        }
      }
    }

    // incident lifecycle
    if (g.incident) {
      this.updateIncident(now, logs);
    } else if (now >= g.nextIncidentAt) {
      this.spawnIncident(now);
    }

    // task spawning
    if (now >= g.nextTaskAt) {
      this.spawnTask();
      const gap = (g.config.taskEverySec * 1000) / this.ramp();
      g.nextTaskAt = now + gap * (0.7 + Math.random() * 0.6);
    }

    // telemetry
    if (Math.random() < 0.6) logs.push(this.makeLog(pick(AMBIENT_LOGS)));
    const extraPools = g.services.filter((s) => SERVICE_LOGS[s]);
    if (extraPools.length && Math.random() < 0.35) {
      logs.push(this.makeLog(pick(SERVICE_LOGS[pick(extraPools)])));
    }
    if (g.sim.util > 1 && Math.random() < 0.7) {
      logs.push(this.makeLog(['error', 'backend', '503 shedding load at {n}% utilization']));
    }
    const point = { t: now, rps: g.sim.rps, err: g.sim.err, p95: g.sim.p95, queue: g.sim.queueDepth };
    g.metrics.push(point);
    if (g.metrics.length > 90) g.metrics.shift();
    for (const l of logs) { g.logs.push(l); if (g.logs.length > 120) g.logs.shift(); }
    let trace = null;
    if (now >= g.nextTraceAt) {
      trace = this.makeTrace(now);
      g.traces.push(trace);
      if (g.traces.length > 20) g.traces.shift();
      g.nextTraceAt = now + 3000 + rnd(3000);
    }
    g.nodes = this.nodeStats();

    g.health = clamp(g.health, 0, 100);
    if (g.health <= 0) {
      g.victory = false;
      this.persist();
      this.endGame();
      return;
    }

    this.broadcast({
      t: 'tick',
      now, score: g.score, health: g.health,
      sprint: g.sprint, sprintEndsAt: g.sprintEndsAt,
      m: point, logs, trace, nodes: g.nodes,
      incident: g.incident,
    });

    if (now >= g.sprintEndsAt) { this.persist(); this.endSprint(); return; }
    this.persist();
    this.ctx.storage.setAlarm(now + TICK_MS);
  }

  // ------------------------------------------------------------- tasks

  targetedControls() {
    const set = new Set();
    for (const t of this.g.tasks) set.add(t.controlKey);
    return set;
  }

  pickBacklogItem(isBug) {
    const g = this.g;
    if (isBug) return { title: pick(BUGS) };
    if (!g.backlog.length) g.backlog = shuffle(FEATURES).map((title) => ({ title }));
    return g.backlog.shift();
  }

  taskDeadline(mult = 1) {
    return (this.g.config.taskDeadlineSec * 1000 * mult) / (1 + 0.15 * (this.g.sprint - 1));
  }

  // spread work evenly: new tasks land on the least-loaded screen
  pickDisplay(displays) {
    const load = (p) => this.g.tasks.filter((t) => t.displayPid === p.id).length;
    const min = Math.min(...displays.map(load));
    return pick(displays.filter((p) => load(p) === min));
  }

  spawnTask() {
    const g = this.g;
    const players = this.activePlayers();
    if (!players.length) return;
    const displays = players.filter(
      (p) => g.tasks.filter((t) => t.displayPid === p.id).length < g.config.maxActivePerPlayer,
    );
    if (!displays.length) return;

    // one roll decides the task family: triage ticket, code review, or dial
    const roll = Math.random();
    if (roll < g.config.triageChance && this.spawnTriageTask(displays)) return;
    if (roll < g.config.triageChance + g.config.codeChance && this.spawnCodeTask(displays)) return;

    // mega mode: dial missions demand a quorum of holders instead of one owner
    if (g.config.megaMode && this.spawnQuorumTask(displays)) return;

    // tasks only target mission dials (pool controls) — the ops console is
    // reserved for running the actual system
    const targeted = this.targetedControls();
    const eligible = (p) => p.controls.filter((c) => !c.crit && !targeted.has(c.key));
    const owners = shuffle(players).filter((p) => eligible(p).length > 0);
    if (!owners.length) return;
    const owner = owners[0];
    const control = pick(eligible(owner));

    let target = 1;
    if (control.type === 'toggle') target = control.value ? 0 : 1;
    if (control.type === 'slider') { do { target = control.min + rnd(control.max - control.min + 1); } while (target === control.value); }
    if (control.type === 'select') { do { target = rnd(control.options.length); } while (target === control.value); }

    const isBug = Math.random() < g.config.bugChance;
    const item = this.pickBacklogItem(isBug);

    const task = {
      id: uid(),
      kind: isBug ? 'bug' : 'feature',
      title: item.title,
      epicService: !isBug && item.service && !g.services.includes(item.service) ? item.service : null,
      instr: instructionFor(control, target),
      displayPid: this.pickDisplay(displays).id,
      ownerPid: owner.id,
      ownerName: owner.name,
      controlKey: control.key,
      target,
      createdAt: Date.now(),
      deadlineAt: Date.now() + this.taskDeadline(),
      status: 'active',
      points: isBug ? 80 : 100,
    };
    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    if (isBug && g.config.botChatter && Math.random() < 0.5) {
      this.botSay('support', `New ticket: "${item.title}" — 3 customers affected 📩`);
    }
  }

  // Mega-mode dial mission: the same dial lives on several screens and the
  // mission only completes once enough holders perform the action.
  spawnQuorumTask(displays) {
    const g = this.g;
    const players = this.activePlayers();
    const targeted = this.targetedControls();
    const holders = {};
    for (const p of players) {
      for (const c of p.controls) {
        if (!c.crit && !targeted.has(c.key)) (holders[c.key] ??= []).push({ p, c });
      }
    }
    const candidates = Object.entries(holders).filter(([, hs]) => hs.length >= 2);
    if (!candidates.length) return false;
    const [key, hs] = pick(candidates);
    const sample = hs[0].c;

    let target = 1;
    if (sample.type === 'toggle') {
      // aim at whichever state the minority holds so it's never pre-satisfied
      const ones = hs.filter(({ c }) => c.value === 1).length;
      target = ones * 2 >= hs.length ? 0 : 1;
    }
    if (sample.type === 'slider') { do { target = (sample.min ?? 0) + rnd(sample.max - (sample.min ?? 0) + 1); } while (target === sample.value); }
    if (sample.type === 'select') { do { target = rnd(sample.options.length); } while (target === sample.value); }

    const required = Math.max(2, Math.ceil(hs.length * 0.6));
    const have = sample.type === 'button' ? 0 : hs.filter(({ c }) => c.value === target).length;
    const isBug = Math.random() < g.config.bugChance;
    const item = this.pickBacklogItem(isBug);
    const display = this.pickDisplay(displays);

    const task = {
      id: uid(),
      kind: isBug ? 'bug' : 'feature',
      title: item.title,
      epicService: !isBug && item.service && !g.services.includes(item.service) ? item.service : null,
      instr: sample.type === 'button'
        ? `${required} teammates: press ${sample.label}`
        : `${instructionFor(sample, target)} — ${required} of ${hs.length} needed`,
      quorum: { required, have, holders: hs.length },
      pressedBy: [],
      displayPid: display.id,
      ownerPid: display.id,
      ownerName: 'the crowd',
      controlKey: key,
      target,
      createdAt: Date.now(),
      deadlineAt: Date.now() + this.taskDeadline(1.5),
      status: 'active',
      points: isBug ? 100 : 120,
    };
    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    return true;
  }

  // Find-the-bug code review. The buggy line index ships with the task;
  // engineers render a lens marker over it, everyone else squints.
  spawnCodeTask(displays) {
    const g = this.g;
    const inUse = new Set(g.tasks.filter((t) => t.kind === 'code').map((t) => t.snippetId));
    let avail = CODE_SNIPPETS.filter((s) => !inUse.has(s.id) && !g.usedSnippets.includes(s.id));
    if (!avail.length) {
      g.usedSnippets = [];
      avail = CODE_SNIPPETS.filter((s) => !inUse.has(s.id));
    }
    if (!avail.length) return false;
    const snippet = pick(avail);
    g.usedSnippets.push(snippet.id);

    const isBug = Math.random() < g.config.bugChance;
    const item = this.pickBacklogItem(isBug);
    const codeKind = isBug ? 'bug' : item.service && !g.services.includes(item.service) ? 'service' : 'feature';
    const title = codeKind === 'bug' ? `Fix: ${item.title}`
      : codeKind === 'service' ? `Build service: ${item.title}`
      : `Build: ${item.title}`;
    const display = this.pickDisplay(displays);

    const task = {
      id: uid(), kind: 'code', codeKind, title,
      epicService: codeKind === 'service' ? item.service : null,
      instr: 'Review the code — tap the broken line',
      snippetId: snippet.id,
      snippet: { name: snippet.name, lines: snippet.lines },
      bugLine: snippet.bug, why: snippet.why, wrongGuesses: 0,
      displayPid: display.id, ownerPid: display.id, ownerName: display.name,
      createdAt: Date.now(), deadlineAt: Date.now() + this.taskDeadline(1.8),
      status: 'active', points: 150,
    };
    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    return true;
  }

  // Ticket triage — route a customer request or bug report to the right
  // priority. PMs get an instinct marker on the correct option.
  spawnTriageTask(displays) {
    const g = this.g;
    const inUse = new Set(g.tasks.filter((t) => t.kind === 'triage').map((t) => t.ticketText));
    let avail = TRIAGE_TICKETS.filter((t) => !inUse.has(t.text) && !g.usedTickets.includes(t.text));
    if (!avail.length) {
      g.usedTickets = [];
      avail = TRIAGE_TICKETS.filter((t) => !inUse.has(t.text));
    }
    if (!avail.length) return false;
    const ticket = pick(avail);
    g.usedTickets.push(ticket.text);
    const display = this.pickDisplay(displays);

    const task = {
      id: uid(), kind: 'triage', triageKind: ticket.kind,
      title: ticket.kind === 'bug' ? 'Triage: bug report' : 'Triage: customer request',
      instr: 'Route it to the right priority',
      ticketText: ticket.text,
      options: TRIAGE_OPTIONS, answer: ticket.answer, why: ticket.why, wrongGuesses: 0,
      displayPid: display.id, ownerPid: display.id, ownerName: display.name,
      createdAt: Date.now(), deadlineAt: Date.now() + this.taskDeadline(1.3),
      status: 'active', points: 90,
    };
    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    if (g.config.botChatter && Math.random() < 0.6) {
      this.botSay('support', `📥 New ${ticket.kind === 'bug' ? 'bug report' : 'request'}: "${ticket.text}"`);
    }
    return true;
  }

  finishTask(task, status) {
    const g = this.g;
    task.status = status;
    g.tasks = g.tasks.filter((t) => t.id !== task.id);
    g.doneLog.push({ ...task, finishedAt: Date.now() });
    if (g.doneLog.length > 12) g.doneLog.shift();
    this.broadcast({ t: 'task', task });
  }

  completeTask(task) {
    const g = this.g;
    const fast = Date.now() - task.createdAt < (task.deadlineAt - task.createdAt) / 2;
    g.score += task.points + (fast ? 25 : 0);
    g.health = clamp(g.health + g.config.healOnComplete, 0, 100);
    const asBug = task.kind === 'bug' || task.codeKind === 'bug';
    if (task.kind === 'triage') {
      g.stats.triaged = (g.stats.triaged ?? 0) + 1;
      g.sprintStats.triaged = (g.sprintStats.triaged ?? 0) + 1;
    } else if (asBug) { g.stats.bugsFixed++; g.sprintStats.bugsFixed++; }
    else { g.stats.shipped++; g.sprintStats.shipped++; }
    this.finishTask(task, 'done');
    if (task.epicService) this.unlockService(task.epicService, task.title);
    else if (task.why) this.botSay('system', `🧠 ${task.why}`);
    else if (task.kind === 'feature' && g.config.botChatter && Math.random() < 0.35) {
      this.botSay('system', `Shipped: "${task.title}" ${fast ? '⚡ speed bonus!' : '🎉'}`);
    }
  }

  unlockService(svc, featureTitle) {
    const g = this.g;
    if (g.services.includes(svc)) return;
    g.services.push(svc);
    g.nodes = this.nodeStats();
    this.botSay('system', `Customers loved "${featureTitle}" — new service deployed: ${SERVICES[svc].icon} ${SERVICES[svc].label}. More infra, more ways to break! 📈`);
    this.broadcast({ t: 'services', services: g.services, nodes: g.nodes });
  }

  // ------------------------------------------------------------- incidents

  spawnIncident(now) {
    const g = this.g;
    const cfg = g.config;
    // scenarios that hinge on a pool dial only fire if that dial was dealt
    const dealt = (key) => {
      const found = this.findControl(key);
      return !!found && found.p.connected && found.p.role !== 'spectator';
    };
    const enabled = Object.keys(INCIDENTS).filter((k) => {
      if (!cfg.incidents[k]) return false;
      const def = INCIDENTS[k];
      if (def.requires && !g.services.includes(def.requires)) return false;
      if (def.requiresControl && !dealt(def.requiresControl)) return false;
      return true;
    });
    if (!enabled.length) { g.nextIncidentAt = now + 30000; return; }

    const kind = pick(enabled);
    const def = INCIDENTS[kind];
    const sim = g.sim;

    // seed the situation into the simulation
    if (kind === 'outage') sim.crashedPods = Math.max(1, Math.floor(this.ctlVal('replicas', 3) * 0.6));
    if (kind === 'memleak') { sim.leak = 0.08; sim.leakFixed = false; }
    if (kind === 'bad_deploy') sim.badDeploy = true;
    if (kind === 'stampede') sim.cacheWarmth = 0.05;
    if (kind === 'integration') sim.paymentsUp = false;
    if (kind === 'queue') sim.queueDepth = clamp(sim.queueDepth + 220, 0, 999);
    if (kind === 'failover') { sim.failedRegion = REGIONS[this.ctlVal('dns_primary', 0)]; sim.dnsSwitchedAt = null; }
    if (kind === 'data_loss') { sim.dbCorrupt = true; sim.restoring = 0; }
    sim.stableTicks = 0;

    // what the players get told depends on the game mode
    const mode = MODES[cfg.mode] ? cfg.mode : 'arcade';
    const base = {
      id: uid(), kind, startedAt: now,
      deadlineAt: now + cfg.incidentDeadlineSec * 1000,
      status: 'active', goalDone: false,
    };
    if (mode === 'realism') {
      g.incident = { ...base, title: 'Alerts firing', desc: def.alert, goal: null, hint: null };
    } else if (mode === 'assisted') {
      g.incident = { ...base, title: def.title, desc: def.desc, goal: def.goal, hint: null, hintAvailable: true };
    } else {
      g.incident = { ...base, title: def.title, desc: def.desc, goal: def.goal, hint: def.hint };
    }
    this.botSay('pager', `🚨 INCIDENT: ${mode === 'realism' ? def.alert : `${def.title} — ${def.desc}`}`);
    if (cfg.botChatter && Math.random() < 0.5) this.botSay('ceo', pick(CEO_INCIDENT_LINES));
    this.broadcast({ t: 'incident', incident: g.incident });
  }

  incidentGoalMet() {
    const g = this.g;
    const sim = g.sim;
    switch (g.incident.kind) {
      case 'outage': return sim.crashedPods === 0 && sim.util < 1;
      case 'spike': return sim.util < 0.9;
      case 'memleak': return sim.leakFixed && sim.util < 1;
      case 'bad_deploy': return !sim.badDeploy;
      case 'stampede': return sim.cacheWarmth >= 0.7;
      case 'integration': return this.ctlVal('circuit_breaker') === 1;
      case 'queue': return sim.queueDepth < 60;
      case 'ddos': return this.ctlVal('firewall', 0) >= 6;
      case 'failover':
        // realistic DR: DNS must point at a healthy region AND TTL propagation
        // must have finished AND the (cold) standby must handle the load
        return REGIONS[this.ctlVal('dns_primary', 0)] !== sim.failedRegion
          && !!sim.dnsSwitchedAt && Date.now() - sim.dnsSwitchedAt >= 8000
          && sim.util < 1;
      case 'data_loss': return !sim.dbCorrupt && sim.restoring === 0;
      default: return false;
    }
  }

  updateIncident(now, logs) {
    const g = this.g;
    const inc = g.incident;
    g.health -= g.config.incidentDrainPerSec;

    if (Math.random() < 0.6) logs.push(this.makeLog(pick(INCIDENTS[inc.kind].logs)));

    // traffic-ramp incidents can't be "solved" before the ramp even lands
    const ramping = (inc.kind === 'spike' || inc.kind === 'ddos') && now - inc.startedAt < 7000;
    // goal must hold for 2 consecutive ticks (no flapping past the finish line)
    inc.goalDone = !ramping && this.incidentGoalMet();
    if (inc.goalDone) {
      g.sim.stableTicks++;
      if (g.sim.stableTicks >= 2) {
        const fast = now - inc.startedAt < (g.config.incidentDeadlineSec * 1000) / 2;
        g.score += 150 + (fast ? 50 : 0);
        g.stats.incidentsResolved++; g.sprintStats.incidentsResolved++;
        this.botSay('pager', `✅ Incident resolved: ${INCIDENTS[inc.kind].title}${fast ? ' — blazing fast, +50 bonus' : ''}.`);
        this.clearIncident(true);
        return;
      }
    } else {
      g.sim.stableTicks = 0;
    }

    if (now >= inc.deadlineAt) {
      g.health -= 15;
      const def = INCIDENTS[inc.kind];
      this.botSay('pager', `🔥 "${def.title}" burned for ${Math.round((now - inc.startedAt) / 1000)}s before outside help arrived. That one leaves a mark.`);
      if (g.config.mode !== 'arcade') this.botSay('system', `📖 Post-mortem: ${def.hint}`);
      this.clearIncident(false);
    }
  }

  clearIncident(resolved, silent = false) {
    const g = this.g;
    if (!g.incident) return;
    const inc = g.incident;
    inc.status = resolved ? 'resolved' : 'failed';
    g.doneLog.push({
      id: inc.id, kind: 'incident', title: INCIDENTS[inc.kind]?.title || inc.title,
      status: resolved ? 'done' : 'failed', finishedAt: Date.now(),
    });
    if (g.doneLog.length > 12) g.doneLog.shift();
    g.incident = null;
    // the world heals: external causes end when the incident ends
    g.sim.crashedPods = 0;
    g.sim.paymentsUp = true;
    g.sim.failedRegion = null;
    g.sim.dnsSwitchedAt = null;
    g.sim.leak = 0;
    g.sim.leakFixed = false;
    g.sim.badDeploy = false;
    g.sim.dbCorrupt = false;
    g.sim.restoring = 0;
    if (!resolved) g.sim.cacheWarmth = 1;
    g.sim.trafficMult = Math.min(g.sim.trafficMult, resolved ? g.sim.trafficMult : 1);
    g.nextIncidentAt = Date.now() + (g.config.incidentEverySec * 1000) / this.ramp();
    if (!silent) this.broadcast({ t: 'incident', incident: inc });
  }

  // ------------------------------------------------------------- control input

  handleControl(p, key, value, press) {
    const g = this.g;
    if (g.phase !== 'playing') return;
    const control = p.controls.find((c) => c.key === key);
    if (!control) return;

    if (control.type === 'button') {
      if (!press) return;
      if (key === 'restart_backend' && (g.sim.crashedPods > 0 || g.sim.leak > 0)) {
        g.sim.crashedPods = 0;
        if (g.incident?.kind === 'memleak') g.sim.leakFixed = true;
        g.sim.leak = 0;
        this.botSay('system', `${p.name} restarted the backend pods 🔄`);
      }
      if (key === 'hotfix' && g.sim.badDeploy) {
        g.sim.badDeploy = false;
        this.botSay('system', `${p.name} pushed a hotfix — rolling back the bad build 🚑`);
      }
      if (key === 'restore_backup') {
        if (g.sim.dbCorrupt && g.sim.restoring === 0) {
          g.sim.restoring = 10;
          this.botSay('system', `${p.name} kicked off a restore from backup — ETA 10s ⏳`);
        } else if (!g.sim.dbCorrupt) {
          this.botSay('system', `${p.name} ran a restore drill — backups verified ✅`);
        }
      }
      if (key === 'clear_cache') {
        g.sim.cacheWarmth = Math.min(g.sim.cacheWarmth, 0.15);
        this.botSay('system', `${p.name} flushed the cache — hit ratio rebuilding from cold 🧊`);
      }
    } else {
      if (typeof value !== 'number') return;
      if (control.type === 'toggle') value = value ? 1 : 0;
      if (control.type === 'slider') value = clamp(Math.round(value), control.min ?? 0, control.max);
      if (control.type === 'select') value = clamp(Math.round(value), 0, control.options.length - 1);
      control.value = value;
      this.broadcast({ t: 'control', pid: p.id, key, value });
    }

    // mega mode: quorum missions count actions from every holder of the dial
    for (const task of g.tasks.filter((t) => t.quorum && t.controlKey === key)) {
      if (control.type === 'button') {
        if (press && !task.pressedBy.includes(p.id)) task.pressedBy.push(p.id);
        task.quorum.have = task.pressedBy.length;
      } else {
        let have = 0;
        for (const pl of this.activePlayers()) {
          const copy = pl.controls.find((c) => c.key === key);
          if (copy && copy.value === task.target) have++;
        }
        task.quorum.have = have;
      }
      if (task.quorum.have >= task.quorum.required) this.completeTask(task);
      else this.broadcast({ t: 'task', task });
    }

    const effective = control.type === 'button' ? 1 : control.value;
    const match = g.tasks
      .filter((t) => !t.quorum && t.ownerPid === p.id && t.controlKey === key && t.target === effective)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (match) this.completeTask(match);

    this.persist();
  }

  // ------------------------------------------------------------- telemetry

  makeLog([level, svc, tmpl]) {
    return {
      ts: Date.now(), level, svc,
      text: tmpl.replaceAll('{n}', String(20 + rnd(480))),
    };
  }

  makeTrace(now) {
    const g = this.g;
    const route = pick(TRACE_ROUTES.filter((r) => r.spans.every((s) => g.services.includes(s) || s === 'dns')));
    if (!route) return null;
    const slowSvcs = new Set();
    if (g.sim.util > 0.9 || g.sim.crashedPods > 0) slowSvcs.add('backend');
    if (!g.sim.paymentsUp) slowSvcs.add('payments');
    if (g.sim.queueDepth > 150) slowSvcs.add('queue');
    if (g.sim.failedRegion) slowSvcs.add('db');
    let total = 0;
    const spans = route.spans.map((svc) => {
      let ms = 4 + rnd(50);
      if (slowSvcs.has(svc)) ms = Math.round(ms * (3 + Math.random() * 4));
      total += ms;
      return { svc, ms };
    });
    return { id: uid(), ts: now, name: route.name, total, spans, error: slowSvcs.size > 0 && Math.random() < 0.5 };
  }

  // ------------------------------------------------------------- chat/bots

  botSay(bot, text) {
    const b = BOTS[bot] || BOTS.system;
    const m = { id: uid(), from: b.name, bot: true, icon: b.icon, text, ts: Date.now() };
    this.g.chat.push(m);
    if (this.g.chat.length > 100) this.g.chat.shift();
    this.broadcast({ t: 'chat', msg: m });
  }

  // ------------------------------------------------------------- wire

  publicPlayers() {
    const out = {};
    for (const [pid, p] of Object.entries(this.g.players)) {
      out[pid] = {
        id: p.id, name: p.name, role: p.role, isHost: p.isHost,
        connected: p.connected, controls: p.controls, joinedAt: p.joinedAt,
      };
    }
    return out;
  }

  publicState() {
    const g = this.g;
    return {
      code: g.code, phase: g.phase, config: g.config,
      players: this.publicPlayers(),
      services: g.services,
      sprint: g.sprint, sprintEndsAt: g.sprintEndsAt, reviewEndsAt: g.reviewEndsAt,
      score: g.score, health: g.health, victory: g.victory,
      tasks: g.tasks, doneLog: g.doneLog, incident: g.incident,
      backlog: g.backlog.slice(0, 6),
      chat: g.chat.slice(-50), logs: g.logs.slice(-60),
      traces: g.traces, metrics: g.metrics, nodes: g.nodes,
      stats: g.stats, sprintStats: g.sprintStats,
    };
  }

  broadcastPhase() {
    const g = this.g;
    this.broadcast({
      t: 'phase', now: Date.now(), phase: g.phase, sprint: g.sprint,
      sprintEndsAt: g.sprintEndsAt, reviewEndsAt: g.reviewEndsAt,
      score: g.score, health: g.health, victory: g.victory,
      stats: g.stats, sprintStats: g.sprintStats,
      players: this.publicPlayers(), backlog: g.backlog.slice(0, 6),
      services: g.services, nodes: g.nodes,
    });
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }

  broadcast(msg, except = null) {
    const raw = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(raw); } catch { /* socket gone */ }
    }
  }
}
