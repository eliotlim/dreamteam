import { DurableObject } from 'cloudflare:workers';
import {
  ROLES, CRITICAL_CONTROLS, CONTROL_POOL, FEATURES, BUGS, INCIDENTS,
  INFRA_NODES, AMBIENT_LOGS, TRACE_ROUTES, BOTS, CEO_SPRINT_LINES,
  CEO_INCIDENT_LINES, instructionFor, NAME_ADJECTIVES, NAME_NOUNS,
} from '../shared/content.js';

const TICK_MS = 1000;
const REVIEW_SECONDS = 15;

export const DEFAULT_CONFIG = {
  preset: 'standard',
  sprintSeconds: 150,     // length of one sprint
  sprintCount: 3,         // sprints per game
  controlsPerPlayer: 4,   // panel size (criticals may overflow this)
  taskEverySec: 8,        // average seconds between new tasks (sprint 1)
  taskDeadlineSec: 30,    // seconds to finish a task (sprint 1)
  incidentEverySec: 45,   // average seconds between incidents
  incidentDeadlineSec: 60,// seconds before an incident auto-mitigates (with pain)
  maxActivePerPlayer: 2,  // max simultaneous instructions shown per player
  bugChance: 0.3,         // fraction of tasks that are bugs
  missPenalty: 8,         // health lost when a task expires
  incidentDrainPerSec: 0.5, // health lost per second while an incident burns
  healOnComplete: 2,      // health gained per completed task
  difficultyRamp: 0.25,   // +pace per sprint
  botChatter: true,       // flavor bots in chat
  incidents: { outage: true, spike: true, integration: true, queue: true, failover: true },
};

export const PRESETS = {
  chill:    { taskEverySec: 12, taskDeadlineSec: 45, incidentEverySec: 75, incidentDeadlineSec: 90, missPenalty: 5, incidentDrainPerSec: 0.25, sprintSeconds: 120, difficultyRamp: 0.15 },
  standard: {},
  chaos:    { taskEverySec: 5, taskDeadlineSec: 22, incidentEverySec: 30, incidentDeadlineSec: 45, missPenalty: 10, incidentDrainPerSec: 0.8, sprintSeconds: 180, difficultyRamp: 0.35 },
};

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => crypto.randomUUID().slice(0, 8);

function freshInfra() {
  const infra = {};
  for (const n of INFRA_NODES) infra[n.id] = 'ok';
  return infra;
}

function freshState(code) {
  return {
    code,
    createdAt: Date.now(),
    phase: 'lobby', // lobby | playing | review | ended
    config: structuredClone(DEFAULT_CONFIG),
    players: {},    // pid -> {id,name,role,isHost,connected,joinedAt,controls:[]}
    sprint: 0,
    sprintEndsAt: 0,
    reviewEndsAt: 0,
    score: 0,
    health: 100,
    victory: false,
    tasks: [],      // active tasks
    doneLog: [],    // recently finished/failed tasks (kanban Done/Failed)
    incident: null,
    backlog: [],
    chat: [],
    logs: [],
    traces: [],
    metrics: [],
    infra: freshInfra(),
    stats: { shipped: 0, bugsFixed: 0, incidentsResolved: 0, missed: 0, sprints: [] },
    sprintStats: null,
    nextTaskAt: 0,
    nextIncidentAt: 0,
    nextTraceAt: 0,
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
      // joining mid-game: deal a panel from the generic pool
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
    if (this.g.phase === 'playing') this.handleDeparture(p);
    this.persist();
    this.broadcast({ t: 'players', players: this.publicPlayers() });
  }

  webSocketError(ws) { this.webSocketClose(ws); }

  handleDeparture(p) {
    const g = this.g;
    // cancel tasks that need this player, no penalty
    const orphaned = g.tasks.filter((t) => t.ownerPid === p.id || t.displayPid === p.id);
    if (orphaned.length) {
      for (const t of orphaned) this.finishTask(t, 'cancelled');
      this.botSay('system', `${p.name} stepped away — ${orphaned.length} task(s) reassigned to the void.`);
    }
    // auto-complete incident needs stuck on their panel
    if (g.incident) {
      for (const need of g.incident.needs) {
        if (need.pid === p.id && !need.done) {
          need.done = true;
          this.botSay('pager', `auto-remediation kicked in for "${need.label}" (owner offline)`);
        }
      }
      this.checkIncidentResolved();
    }
  }

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
      Object.assign(c, structuredClone(DEFAULT_CONFIG), PRESETS[patch.preset], { preset: patch.preset, incidents: c.incidents });
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
    if (typeof patch.botChatter === 'boolean') c.botChatter = patch.botChatter;
    if (patch.incidents && typeof patch.incidents === 'object') {
      for (const k of Object.keys(INCIDENTS)) {
        if (typeof patch.incidents[k] === 'boolean') c.incidents[k] = patch.incidents[k];
      }
    }
    if (typeof patch.preset !== 'string') c.preset = 'custom';
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
    g.infra = freshInfra();
    g.stats = { shipped: 0, bugsFixed: 0, incidentsResolved: 0, missed: 0, sprints: [] };
    g.backlog = shuffle(FEATURES);
    this.dealAllControls();
    this.startSprint(1);
  }

  dealAllControls() {
    const players = this.activePlayers();
    for (const p of players) p.controls = [];
    // criticals first, preferring matching roles, then round-robin by panel size
    const byLoad = () => [...players].sort((a, b) => a.controls.length - b.controls.length);
    for (const def of shuffle(CRITICAL_CONTROLS)) {
      const match = byLoad().find((p) => p.role === def.role);
      const target = match || byLoad()[0];
      target.controls.push(this.instantiate(def));
    }
    // fill panels from the pool
    const pool = shuffle(CONTROL_POOL);
    for (const p of players) {
      const preferred = pool.filter((d) => d.role === p.role);
      const rest = pool.filter((d) => d.role !== p.role);
      for (const def of [...preferred, ...rest]) {
        if (p.controls.length >= this.g.config.controlsPerPlayer) break;
        if (p.controls.some((c) => c.key === def.key)) continue;
        if (players.some((o) => o !== p && o.controls.some((c) => c.key === def.key))) continue;
        p.controls.push(this.instantiate(def));
      }
    }
  }

  dealPoolControls(p) {
    const taken = new Set(
      Object.values(this.g.players).flatMap((x) => x.controls.map((c) => c.key)),
    );
    const pool = shuffle(CONTROL_POOL).filter((d) => !taken.has(d.key));
    const preferred = pool.filter((d) => d.role === p.role);
    const rest = pool.filter((d) => d.role !== p.role);
    p.controls = [...preferred, ...rest]
      .slice(0, this.g.config.controlsPerPlayer)
      .map((d) => this.instantiate(d));
  }

  instantiate(def) {
    const c = { key: def.key, label: def.label, type: def.type, value: 0 };
    if (def.type === 'slider') { c.max = def.max; c.value = rnd(def.max + 1); }
    if (def.type === 'select') { c.options = def.options; c.value = rnd(def.options.length); }
    if (def.type === 'toggle') c.value = rnd(2);
    return c;
  }

  ramp() { return 1 + this.g.config.difficultyRamp * (this.g.sprint - 1); }

  startSprint(n) {
    const g = this.g;
    const now = Date.now();
    g.phase = 'playing';
    g.sprint = n;
    g.sprintEndsAt = now + g.config.sprintSeconds * 1000;
    g.sprintStats = { shipped: 0, bugsFixed: 0, incidentsResolved: 0, missed: 0, scoreStart: g.score };
    g.tasks = [];
    g.incident = null;
    g.infra = freshInfra();
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
    if (g.victory) {
      this.botSay('ceo', 'We shipped the roadmap AND the site is up?! Promotions for everyone. (Figuratively.)');
    } else {
      this.botSay('ceo', 'The site is down and morale is downer. Mandatory fun retreat next week.');
    }
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
    g.infra = freshInfra();
    for (const p of Object.values(g.players)) p.controls = [];
    this.persist();
    this.ctx.storage.deleteAlarm();
    this.broadcast({ t: 'snapshot', g: this.publicState() });
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
    const events = { logs: [] };

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
      g.health -= g.config.incidentDrainPerSec;
      if (now >= g.incident.deadlineAt) {
        g.health -= 15;
        this.botSay('pager', `🔥 "${g.incident.title}" auto-mitigated after timeout. That one leaves a mark.`);
        this.clearIncident(false);
      } else {
        const def = INCIDENTS[g.incident.kind];
        if (Math.random() < 0.6) events.logs.push(this.makeLog(pick(def.logs)));
      }
    } else if (now >= g.nextIncidentAt) {
      this.spawnIncident();
    }

    // task spawning
    if (now >= g.nextTaskAt) {
      this.spawnTask();
      const gap = (g.config.taskEverySec * 1000) / this.ramp();
      g.nextTaskAt = now + gap * (0.7 + Math.random() * 0.6);
    }

    // ambient telemetry
    if (Math.random() < 0.7) events.logs.push(this.makeLog(pick(AMBIENT_LOGS)));
    const point = this.metricsPoint(now);
    g.metrics.push(point);
    if (g.metrics.length > 90) g.metrics.shift();
    for (const l of events.logs) { g.logs.push(l); if (g.logs.length > 120) g.logs.shift(); }
    let trace = null;
    if (now >= g.nextTraceAt) {
      trace = this.makeTrace(now);
      g.traces.push(trace);
      if (g.traces.length > 20) g.traces.shift();
      g.nextTraceAt = now + 3000 + rnd(3000);
    }

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
      m: point, logs: events.logs, trace,
    });

    if (now >= g.sprintEndsAt) { this.persist(); this.endSprint(); return; }

    this.persist();
    this.ctx.storage.setAlarm(now + TICK_MS);
  }

  // ------------------------------------------------------------- tasks

  targetedControls() {
    const set = new Set();
    for (const t of this.g.tasks) set.add(t.controlKey);
    if (this.g.incident) for (const n of this.g.incident.needs) set.add(n.key);
    return set;
  }

  spawnTask() {
    const g = this.g;
    const players = this.activePlayers();
    if (!players.length) return;
    const displays = players.filter(
      (p) => g.tasks.filter((t) => t.displayPid === p.id).length < g.config.maxActivePerPlayer,
    );
    if (!displays.length) return;

    const targeted = this.targetedControls();
    const owners = shuffle(players).filter((p) => p.controls.some((c) => !targeted.has(c.key)));
    if (!owners.length) return;
    const owner = owners[0];
    const control = pick(owner.controls.filter((c) => !targeted.has(c.key)));

    let target = 1;
    if (control.type === 'toggle') target = control.value ? 0 : 1;
    if (control.type === 'slider') { do { target = rnd(control.max + 1); } while (target === control.value); }
    if (control.type === 'select') { do { target = rnd(control.options.length); } while (target === control.value); }

    const isBug = Math.random() < g.config.bugChance;
    if (!g.backlog.length) g.backlog = shuffle(FEATURES);
    const title = isBug ? pick(BUGS) : g.backlog.shift();
    const deadline = (g.config.taskDeadlineSec * 1000) / (1 + 0.15 * (g.sprint - 1));

    const task = {
      id: uid(),
      kind: isBug ? 'bug' : 'feature',
      title,
      instr: instructionFor(control, target),
      displayPid: pick(displays).id,
      ownerPid: owner.id,
      ownerName: owner.name,
      controlKey: control.key,
      target,
      createdAt: Date.now(),
      deadlineAt: Date.now() + deadline,
      status: 'active',
      points: isBug ? 80 : 100,
    };
    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    if (isBug && g.config.botChatter && Math.random() < 0.5) {
      this.botSay('support', `New ticket: "${title}" — 3 customers affected 📩`);
    }
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
    const points = task.points + (fast ? 25 : 0);
    g.score += points;
    g.health = clamp(g.health + g.config.healOnComplete, 0, 100);
    if (task.kind === 'bug') { g.stats.bugsFixed++; g.sprintStats.bugsFixed++; }
    else { g.stats.shipped++; g.sprintStats.shipped++; }
    this.finishTask(task, 'done');
    if (task.kind === 'feature' && g.config.botChatter && Math.random() < 0.35) {
      this.botSay('system', `Shipped: "${task.title}" ${fast ? '⚡ speed bonus!' : '🎉'}`);
    }
  }

  // ------------------------------------------------------------- incidents

  spawnIncident() {
    const g = this.g;
    const enabled = Object.keys(INCIDENTS).filter((k) => g.config.incidents[k]);
    if (!enabled.length) { g.nextIncidentAt = Infinity; return; }

    for (const kind of shuffle(enabled)) {
      const def = INCIDENTS[kind];
      const needs = [];
      let feasible = true;
      for (const need of def.needs) {
        const owner = this.activePlayers().find((p) => p.controls.some((c) => c.key === need.key));
        if (!owner) { feasible = false; break; }
        const control = owner.controls.find((c) => c.key === need.key);
        const pre = control.type !== 'button' && control.value === need.target;
        needs.push({
          pid: owner.id, ownerName: owner.name, key: need.key, target: need.target,
          label: instructionFor(control, need.target), done: pre,
        });
      }
      if (!feasible || needs.every((n) => n.done)) continue;

      g.incident = {
        id: uid(), kind,
        title: def.title, desc: def.desc,
        needs,
        startedAt: Date.now(),
        deadlineAt: Date.now() + g.config.incidentDeadlineSec * 1000,
        status: 'active',
      };
      for (const [node, status] of Object.entries(def.affects)) g.infra[node] = status;
      this.botSay('pager', `🚨 INCIDENT: ${g.incident.title} — ${def.desc}`);
      if (g.config.botChatter && Math.random() < 0.5) this.botSay('ceo', pick(CEO_INCIDENT_LINES));
      this.broadcast({ t: 'incident', incident: g.incident });
      this.broadcast({ t: 'infra', infra: g.infra });
      return;
    }
    // nothing spawnable right now; retry later
    g.nextIncidentAt = Date.now() + 15000;
  }

  clearIncident(resolved, silent = false) {
    const g = this.g;
    if (!g.incident) return;
    g.incident.status = resolved ? 'resolved' : 'failed';
    g.doneLog.push({
      id: g.incident.id, kind: 'incident', title: g.incident.title,
      status: resolved ? 'done' : 'failed', finishedAt: Date.now(),
    });
    if (g.doneLog.length > 12) g.doneLog.shift();
    const last = g.incident;
    g.incident = null;
    g.infra = freshInfra();
    g.nextIncidentAt = Date.now() + (g.config.incidentEverySec * 1000) / this.ramp();
    if (!silent) this.broadcast({ t: 'incident', incident: last });
    this.broadcast({ t: 'infra', infra: g.infra });
  }

  checkIncidentResolved() {
    const g = this.g;
    if (!g.incident || !g.incident.needs.every((n) => n.done)) return;
    const fast = Date.now() - g.incident.startedAt < (g.config.incidentDeadlineSec * 1000) / 2;
    g.score += 150 + (fast ? 50 : 0);
    g.stats.incidentsResolved++; g.sprintStats.incidentsResolved++;
    this.botSay('pager', `✅ Incident resolved: ${g.incident.title}${fast ? ' — blazing fast, +50 bonus' : ''}. Uptime restored.`);
    this.clearIncident(true);
  }

  // ------------------------------------------------------------- controls

  handleControl(p, key, value, press) {
    const g = this.g;
    if (g.phase !== 'playing') return;
    const control = p.controls.find((c) => c.key === key);
    if (!control) return;

    if (control.type === 'button') {
      if (!press) return;
    } else {
      if (typeof value !== 'number') return;
      if (control.type === 'toggle') value = value ? 1 : 0;
      if (control.type === 'slider') value = clamp(Math.round(value), 0, control.max);
      if (control.type === 'select') value = clamp(Math.round(value), 0, control.options.length - 1);
      control.value = value;
      this.broadcast({ t: 'control', pid: p.id, key, value });
    }

    const effective = control.type === 'button' ? 1 : control.value;

    // task completion (oldest matching first)
    const match = g.tasks
      .filter((t) => t.ownerPid === p.id && t.controlKey === key && t.target === effective)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (match) this.completeTask(match);

    // incident needs
    if (g.incident) {
      let changed = false;
      for (const need of g.incident.needs) {
        if (need.pid !== p.id || need.key !== key) continue;
        const ok = control.type === 'button' ? press : control.value === need.target;
        if (ok && !need.done) { need.done = true; changed = true; }
        if (!ok && need.done && control.type !== 'button') { need.done = false; changed = true; }
      }
      if (changed) {
        this.broadcast({ t: 'incident', incident: g.incident });
        this.checkIncidentResolved();
      }
    }
    this.persist();
  }

  // ------------------------------------------------------------- telemetry

  metricsPoint(now) {
    const g = this.g;
    const wobble = Math.sin(now / 20000) * 15;
    let rps = 120 + wobble + (Math.random() - 0.5) * 20;
    let err = 0.5 + Math.random() * 0.8;
    let p95 = 180 + (Math.random() - 0.5) * 40;
    let queue = 5 + Math.random() * 4;
    if (g.incident) {
      const fx = INCIDENTS[g.incident.kind].metrics;
      const elapsed = (now - g.incident.startedAt) / 1000;
      if (fx.rps) rps += fx.rps;
      if (fx.err) err += fx.err * (0.6 + Math.random() * 0.8);
      if (fx.p95) p95 += fx.p95 * (0.7 + Math.random() * 0.6);
      if (fx.queue) queue += fx.queue * elapsed * 0.35;
    }
    return {
      t: now,
      rps: Math.max(0, Math.round(rps)),
      err: Math.round(Math.max(0, err) * 10) / 10,
      p95: Math.max(20, Math.round(p95)),
      queue: Math.max(0, Math.round(queue)),
    };
  }

  makeLog([level, svc, tmpl]) {
    return {
      ts: Date.now(), level, svc,
      text: tmpl.replaceAll('{n}', String(20 + rnd(480))),
    };
  }

  makeTrace(now) {
    const g = this.g;
    const route = pick(TRACE_ROUTES);
    const affected = g.incident ? Object.keys(INCIDENTS[g.incident.kind].affects) : [];
    let total = 0;
    const spans = route.spans.map((svc) => {
      let ms = 4 + rnd(60);
      if (affected.includes(svc)) ms = Math.round(ms * (3 + Math.random() * 3));
      total += ms;
      return { svc, ms };
    });
    return { id: uid(), ts: now, name: route.name, total, spans, error: affected.length > 0 && Math.random() < 0.5 };
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
        connected: p.connected, controls: p.controls,
      };
    }
    return out;
  }

  publicState() {
    const g = this.g;
    return {
      code: g.code, phase: g.phase, config: g.config,
      players: this.publicPlayers(),
      sprint: g.sprint, sprintEndsAt: g.sprintEndsAt, reviewEndsAt: g.reviewEndsAt,
      score: g.score, health: g.health, victory: g.victory,
      tasks: g.tasks, doneLog: g.doneLog, incident: g.incident,
      backlog: g.backlog.slice(0, 6),
      chat: g.chat.slice(-50), logs: g.logs.slice(-60),
      traces: g.traces, metrics: g.metrics, infra: g.infra,
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
      infra: g.infra,
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
