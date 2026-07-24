import { DurableObject } from 'cloudflare:workers';
import {
  ROLES, CRITICAL_CONTROLS, CONTROL_POOL, FEATURES, BUGS, INCIDENTS, MODES,
  TRIAGE_TICKETS, TRIAGE_OPTIONS, GUESS_PENALTY, INCIDENT_TUNING,
  SERVICES, CORE_SERVICES, EPIC_FEATURES, REGIONS, AMBIENT_LOGS, SERVICE_LOGS,
  TRACE_ROUTES, BOTS, CEO_SPRINT_LINES, CEO_INCIDENT_LINES, instructionFor,
  NAME_ADJECTIVES, NAME_NOUNS, CONTROL_SERVICE, DESIGN_COLORS, DESIGN_RADII,
} from '../shared/content.ts';
import { CODE_SNIPPETS, SNIPPETS_BY_TITLE } from '../shared/snippets.ts';
import type {
  AnalysisItem, BacklogItem, ClientGame, ClientMsg, CodeTask, ControlDef,
  ControlInstance, DesignTask, DialTask, GameConfig, GameEvent, GameState,
  GameStats, Incident, IncidentKind, LogLine, LogTemplate, NodeStat,
  NumericConfigKey, Player, PlayerRole, PresetId, ServerMsg, Sim, Task,
  TaskStatus, Trace, TriageTask,
} from '../shared/types.ts';

const TICK_MS = 1000;
const REVIEW_SECONDS = 15;
const PER_REPLICA_RPS = 35;
// a room nobody has touched for this long deletes itself
const ROOM_TTL_MS = 30 * 60 * 1000;
// a player with no socket for this long leaves the party for real
const PLAYER_TTL_MS = 60 * 1000;

// Deterministic starting values for the ops console — the sim needs a sane
// initial state (3 pods, warm-ish cache, moderate drain, nothing to zero).
const CRITICAL_INIT = {
  autoscaler: 0, circuit_breaker: 0, queue_drain: 4, replicas: 3, cache_ttl: 3,
};

export const DEFAULT_CONFIG: GameConfig = {
  preset: 'standard',
  mode: 'arcade',         // arcade | assisted | realism — how much the game tells you
  megaMode: false,        // crowd play: dials duplicated, missions need a quorum
  botChatter: true,       // flavor bots in chat
  hintsEnabled: true,     // realism only: allow paid runbook hints
  codeChance: MODES.arcade.codeChance,       // chance a task is a find-the-bug code review
  triageChance: MODES.arcade.triageChance,   // chance a task is a ticket triage
  designChance: MODES.arcade.designChance,   // chance a task is a design review
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
  incidents: Object.fromEntries(Object.keys(INCIDENTS).map((k) => [k, true])) as Record<IncidentKind, boolean>,
};

// Presets tune pacing AND how much infrastructure you start with.
export const PRESETS: Record<PresetId, Partial<GameConfig> & { startingServices: string[] }> = {
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

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: readonly T[]): T => arr[rnd(arr.length)];
const shuffle = <T,>(arr: readonly T[]): T[] => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const uid = () => crypto.randomUUID().slice(0, 8);

// dial missions (feature/bug) are the only tasks bound to a control
const isDialTask = (t: Task): t is DialTask => t.kind === 'feature' || t.kind === 'bug';

// Incident-transient sim fields — reset together when a sprint starts or an
// incident ends. trafficMult and cacheWarmth are excluded: they decay/rebuild
// naturally and have per-site rules.
const INCIDENT_SIM_RESET = {
  crashedPods: 0, paymentsUp: true, failedRegion: null, dnsSwitchedAt: null,
  leak: 0, leakFixed: false, badDeploy: false, dbCorrupt: false, restoring: 0,
};

function freshSim(): Sim {
  return {
    rps: 90, util: 0.7, err: 0.5, p95: 160, queueDepth: 12, dbIops: 150,
    trafficMult: 1, cacheWarmth: 1, stableTicks: 0,
    ...INCIDENT_SIM_RESET,
  };
}

function freshStats(): GameStats {
  return {
    shipped: 0, bugsFixed: 0, incidentsResolved: 0, triaged: 0, missed: 0,
    bugsShipped: 0, wrongGuesses: 0, sprints: [],
  };
}

function freshState(code: string): GameState {
  return {
    code,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    phase: 'lobby',
    name: '',
    password: null,
    creatorPid: null,
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
    stats: freshStats(),
    // causal ledger: everything notable that happened, with `cause` links —
    // feeds the retro Gantt and the failure-mode analysis
    events: [],
    openEv: { sprint: null, incident: null, crash: null, badDeploy: null },
    analysis: null,
    sprintStats: null,
    usedSnippets: [],
    usedTickets: [],
    nextTaskAt: 0,
    nextIncidentAt: 0,
    nextTraceAt: 0,
    tickCount: 0,
  };
}

export class GameRoom extends DurableObject<Env> {
  g: GameState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);
      const row = [...ctx.storage.sql.exec(`SELECT v FROM kv WHERE k = 'game'`)][0];
      this.g = row ? JSON.parse(row.v as string) : null;
      // rooms persisted by a pre-simulation build can't run under this code
      if (this.g && (!Array.isArray(this.g!.services) || !this.g!.sim)) {
        this.g = freshState(this.g!.code || '????');
      }
      // migrate rooms persisted before game modes / mega mode existed
      if (this.g?.config) {
        if (!this.g!.config.mode) {
          this.g!.config.mode = 'arcade';
          this.g!.config.codeChance ??= MODES.arcade.codeChance;
          this.g!.config.triageChance ??= MODES.arcade.triageChance;
        }
        this.g!.config.designChance ??= MODES[this.g!.config.mode]?.designChance ?? MODES.arcade.designChance;
        this.g!.lastActiveAt ??= Date.now();
        this.g!.config.megaMode ??= false;
        this.g!.config.hintsEnabled ??= true;
        this.g!.usedSnippets ??= [];
        this.g!.usedTickets ??= [];
        this.g!.stats ??= freshStats();
        this.g!.stats.triaged ??= 0;
        this.g!.stats.bugsShipped ??= 0;
        this.g!.stats.wrongGuesses ??= 0;
        this.g!.name ??= '';
        this.g!.password ??= null;
        this.g!.creatorPid ??= null;
        this.g!.events ??= [];
        this.g!.openEv ??= { sprint: null, incident: null, crash: null, badDeploy: null };
        this.g!.analysis ??= null;
      }
      // every live room keeps an alarm pending — ticks while playing, the
      // idle sweep otherwise — so rooms persisted before TTLs existed need one
      if (this.g && (await ctx.storage.getAlarm()) === null) {
        ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      }
    });
  }

  // any human interaction marks the room active; the idle sweep in alarm()
  // reclaims rooms untouched for ROOM_TTL_MS
  touch() {
    if (this.g) this.g!.lastActiveAt = Date.now();
  }

  persist() {
    if (!this.g) return;
    this.ctx.storage.sql.exec(
      `INSERT INTO kv (k, v) VALUES ('game', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(this.g),
    );
  }

  // ------------------------------------------------------------- HTTP entry

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      if (!this.g) {
        this.g = freshState(url.searchParams.get('code') || '????');
        this.persist();
        this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      }
      return Response.json({ ok: true, code: this.g!.code });
    }

    if (url.pathname.endsWith('/exists')) {
      const hasPassword = !!this.g?.password;
      return Response.json({
        exists: !!this.g,
        phase: this.g?.phase ?? null,
        hasPassword,
        passOk: !hasPassword || url.searchParams.get('pass') === this.g?.password,
      });
    }

    if (url.pathname.endsWith('/ws')) {
      if (!this.g) return new Response('room not found', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const name = (url.searchParams.get('name') || '').trim().slice(0, 24)
        || `${pick(NAME_ADJECTIVES)}_${pick(NAME_NOUNS)}`;
      const pid = url.searchParams.get('pid') || uid();
      // password-protected room: known players (rejoin/refresh) pass freely,
      // new faces need the password
      if (this.g!.password && !this.g!.players[pid]
        && url.searchParams.get('pass') !== this.g!.password) {
        return new Response('wrong password', { status: 403 });
      }
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

  handleJoin(pid: string, name: string, ws: WebSocket) {
    const g = this.g!;
    this.touch();
    g.creatorPid ??= pid; // first joiner founded the lobby — hosting defaults to them
    let p = g.players[pid];
    if (!p) {
      const takenRoles = Object.values(g.players).filter((x) => x.connected).map((x) => x.role);
      // fresh joins always land on a playing role — spectator is opt-in
      const role: PlayerRole = ROLES.find((r) => !takenRoles.includes(r)) || pick(ROLES);
      p = <Player>{
        id: pid, name, role,
        isHost: !Object.values(g.players).some((x) => x.isHost),
        connected: true, joinedAt: Date.now(), controls: [],
      };
      g.players[pid] = p;
      if (['playing', 'review'].includes(g.phase)) this.dealPoolControls(p);
      this.botSay('system', `${name} joined the team 👋`);
    } else {
      p.connected = true;
      p.name = name || p.name;
    }
    // a room must never end up hostless (solo host reconnecting with the same pid)
    if (!Object.values(g.players).some((x) => x.isHost)) p.isHost = true;
    this.persist();
    this.send(ws, { t: 'snapshot', g: this.publicState(), you: pid, now: Date.now() });
    this.broadcast({ t: 'players', players: this.publicPlayers() }, ws);
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment();
    if (!att || !this.g) return;
    const stillHere = this.ctx.getWebSockets().some(
      (o) => o !== ws && o.deserializeAttachment()?.pid === att.pid,
    );
    if (stillHere) return;
    const p = this.g!.players[att.pid];
    if (!p) return;
    this.releasePlayer(p);
    this.persist();
    this.broadcast({ t: 'players', players: this.publicPlayers() });
    // lobby/ended rooms sleep until the room TTL — pull the alarm forward so
    // the inactivity sweep can retire this player on time
    const due = Date.now() + PLAYER_TTL_MS;
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || cur > due) this.ctx.storage.setAlarm(due);
  }

  // Shared teardown for disconnects, explicit leaves, and the inactivity
  // sweep: hand off hosting, crit controls, and any live work.
  releasePlayer(p: Player) {
    p.connected = false;
    p.lastSeenAt = Date.now();
    if (p.isHost) {
      p.isHost = false;
      // hosting falls back to the lobby's creator when present, else seniority
      const next = Object.values(this.g!.players)
        .filter((x) => x.connected)
        .sort((a, b) =>
          Number(b.id === this.g!.creatorPid) - Number(a.id === this.g!.creatorPid) || a.joinedAt - b.joinedAt)[0];
      if (next) next.isHost = true;
    }
    if (['playing', 'review'].includes(this.g!.phase)) {
      const orphaned = this.g!.tasks.filter((t) => t.ownerPid === p.id || t.displayPid === p.id);
      for (const t of orphaned) this.finishTask(t, 'cancelled');
      if (orphaned.length) {
        this.botSay('system', `${p.name} stepped away — ${orphaned.length} task(s) reassigned to the void.`);
      }
      const remaining = this.activePlayers();
      if (remaining.length) {
        // the ops console must never freeze: hand crit dials to someone
        // present — plus the pool dial an active incident depends on, if the
        // leaver held the only copy
        const moves = p.controls.filter((c) => c.crit);
        const reqKey = this.g!.incident && INCIDENTS[this.g!.incident.kind]?.requiresControl;
        if (reqKey) {
          const mine = p.controls.find((c) => c.key === reqKey && !c.crit);
          const elsewhere = remaining.some((pl) => pl.controls.some((c) => c.key === reqKey));
          if (mine && !elsewhere) moves.push(mine);
        }
        if (moves.length) {
          const heir = this.leastLoaded(remaining)[0];
          heir.controls.push(...moves);
          p.controls = p.controls.filter((c) => !moves.includes(c));
          this.botSay('system', `${p.name}'s ops controls were handed to ${heir.name} 🎛️`);
        }
        // recount quorums that lost a holder so missions stay winnable
        for (const t of this.g!.tasks.filter((t): t is DialTask => isDialTask(t) && !!t.quorum)) {
          const holders = remaining.filter((pl) => pl.controls.some((c) => c.key === t.controlKey));
          if (!holders.length) { this.finishTask(t, 'cancelled'); continue; }
          const ctl = holders[0].controls.find((c) => c.key === t.controlKey)!;
          const have = ctl.type === 'button'
            ? (t.pressedBy ?? []).length
            : holders.filter((pl) => pl.controls.find((c) => c.key === t.controlKey)!.value === t.target).length;
          t.quorum!.holders = holders.length;
          t.quorum!.required = Math.min(t.quorum!.required, holders.length);
          t.quorum!.have = have;
          if (have >= t.quorum!.required) this.completeTask(t);
          else this.broadcast({ t: 'task', task: t });
        }
      }
    }
  }

  // Drop a player from the roster for good — explicit leave or timed out.
  removePlayer(p: Player, farewell: string) {
    this.releasePlayer(p);
    delete this.g!.players[p.id];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.deserializeAttachment()?.pid === p.id) {
        try { ws.close(1000, 'left the room'); } catch { /* already gone */ }
      }
    }
    this.botSay('system', farewell);
    this.persist();
    this.broadcast({ t: 'players', players: this.publicPlayers() });
  }

  webSocketError(ws: WebSocket) { this.webSocketClose(ws); }

  // ------------------------------------------------------------- messages

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMsg;
    try { msg = JSON.parse(raw as string); } catch { return; }
    const att = ws.deserializeAttachment();
    const g = this.g!;
    if (!att || !g) return;
    const p = g.players[att.pid];
    if (!p) return;
    this.touch();

    switch (msg.t) {
      case 'set_role': {
        if (g.phase !== 'lobby') break;
        if (![...ROLES, 'spectator'].includes(msg.role)) break;
        p.role = msg.role;
        this.persist();
        this.broadcast({ t: 'players', players: this.publicPlayers() });
        break;
      }
      case 'rename': {
        const name = String(msg.name || '').trim().slice(0, 24);
        if (!name || name === p.name) break;
        const old = p.name;
        p.name = name;
        for (const t of g.tasks) if (t.ownerPid === p.id) t.ownerName = name;
        this.botSay('system', `${old} is now known as ${name} ✏️`);
        this.persist();
        this.broadcast({ t: 'players', players: this.publicPlayers() });
        break;
      }
      case 'set_name': {
        if (!p.isHost) break;
        g.name = String(msg.name || '').trim().slice(0, 32);
        this.persist();
        this.broadcast({ t: 'room', name: g.name });
        break;
      }
      case 'set_password': {
        if (!p.isHost) break;
        const pw = String(msg.password || '').trim().slice(0, 32);
        g.password = pw || null;
        this.botSay('system', pw ? '🔒 The lobby is now password-protected.' : '🔓 Lobby password removed.');
        this.persist();
        this.broadcast({ t: 'room', hasPassword: !!g.password });
        break;
      }
      case 'leave': {
        this.removePlayer(p, `${p.name} left the team 👋`);
        break;
      }
      case 'make_host': {
        if (!p.isHost) break;
        const target = g.players[msg.pid];
        if (!target || target.id === p.id || !target.connected) break;
        p.isHost = false;
        target.isHost = true;
        this.botSay('system', `👑 ${p.name} handed hosting to ${target.name}.`);
        this.persist();
        this.broadcast({ t: 'players', players: this.publicPlayers() });
        break;
      }
      case 'config': {
        if (!p.isHost || g.phase !== 'lobby') break;
        this.applyConfig(msg.patch || {});
        this.persist();
        this.broadcast({ t: 'config', config: g.config });
        // preset changes swap the starting services — keep clients current
        this.broadcast({ t: 'services', services: g.services, nodes: g.nodes });
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
        this.handleCodeGuess(p, msg.taskId, Number(msg.line));
        break;
      }
      case 'code_ship': {
        this.handleCodeShip(p, msg.taskId);
        break;
      }
      case 'triage_pick': {
        this.answerTask<TriageTask>(p, msg.taskId, 'triage', (task) => Number(msg.choice) === task.answer);
        break;
      }
      case 'design_pick': {
        this.answerTask<DesignTask>(p, msg.taskId, 'design', (task) => Number(msg.choice) === task.answer);
        break;
      }
      case 'hint': {
        // paid runbook pulls exist only in realism mode (assisted shows the
        // hint from the start, free) and only if the lobby enabled them
        if (g.phase !== 'playing' || !g.incident) break;
        if (g.config.mode !== 'realism' || !g.config.hintsEnabled || g.incident.hint) break;
        const cost = MODES.realism.hintCost;
        const def = INCIDENTS[g.incident.kind];
        Object.assign(g.incident, {
          title: def.title, desc: def.desc, goal: def.goal, hint: def.hint,
          hintAvailable: false,
        });
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

  applyConfig(patch: Omit<Partial<GameConfig>, 'incidents'> & { incidents?: Partial<Record<IncidentKind, boolean>> }) {
    const c = this.g!.config;
    const num = (k: NumericConfigKey, lo: number, hi: number) => {
      const v = patch[k];
      if (typeof v === 'number' && !Number.isNaN(v)) c[k] = clamp(v, lo, hi);
    };
    if (typeof patch.preset === 'string' && PRESETS[patch.preset as PresetId]) {
      const { startingServices, ...knobs } = PRESETS[patch.preset as PresetId];
      Object.assign(c, structuredClone(DEFAULT_CONFIG), knobs, {
        preset: patch.preset, incidents: c.incidents, mode: c.mode, megaMode: c.megaMode,
        codeChance: c.codeChance, triageChance: c.triageChance, designChance: c.designChance,
        botChatter: c.botChatter, hintsEnabled: c.hintsEnabled,
      });
      this.g!.services = [...CORE_SERVICES, ...startingServices];
    }
    if (typeof patch.mode === 'string' && MODES[patch.mode]) {
      c.mode = patch.mode;
      c.codeChance = MODES[patch.mode].codeChance;
      c.triageChance = MODES[patch.mode].triageChance;
      c.designChance = MODES[patch.mode].designChance;
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
    num('designChance', 0, 1);
    if (typeof patch.botChatter === 'boolean') c.botChatter = patch.botChatter;
    if (typeof patch.megaMode === 'boolean') c.megaMode = patch.megaMode;
    if (typeof patch.hintsEnabled === 'boolean') c.hintsEnabled = patch.hintsEnabled;
    if (patch.incidents && typeof patch.incidents === 'object') {
      for (const k of Object.keys(INCIDENTS) as IncidentKind[]) {
        const v = patch.incidents[k];
        if (typeof v === 'boolean') c.incidents[k] = v;
      }
    }
    // mode & botChatter are orthogonal to pacing — only knob changes mark the preset custom
    const cosmetic = ['preset', 'mode', 'botChatter', 'megaMode', 'hintsEnabled'];
    if (typeof patch.preset !== 'string' && Object.keys(patch).some((k) => !cosmetic.includes(k))) {
      c.preset = 'custom';
    }
  }

  // Quiz-style missions (triage/design): right answer completes, wrong
  // answers share one penalty policy.
  answerTask<T extends Task>(p: Player, taskId: string, kind: T['kind'], isCorrect: (task: T) => boolean) {
    const g = this.g!;
    if (g.phase !== 'playing') return;
    const task = g.tasks.find((x) => x.id === taskId && x.kind === kind) as T | undefined;
    if (!task || task.displayPid !== p.id) return;
    if (isCorrect(task)) {
      this.completeTask(task, p);
    } else {
      this.penalizeGuess(task);
    }
    this.persist();
  }

  penalizeGuess(task: Task) {
    const g = this.g!;
    task.wrongGuesses = (task.wrongGuesses ?? 0) + 1;
    task.deadlineAt -= GUESS_PENALTY.secs * 1000;
    g.score = Math.max(0, g.score - GUESS_PENALTY.points);
    g.stats.wrongGuesses++;
    this.broadcast({ t: 'task', task });
  }

  // Code review, act 1: tap the broken line. A correct tap patches the line in
  // place (the card re-renders the fix); the mission still needs a ship.
  handleCodeGuess(p: Player, taskId: string, line: number) {
    const g = this.g!;
    if (g.phase !== 'playing') return;
    const task = g.tasks.find((x) => x.id === taskId && x.kind === 'code') as CodeTask | undefined;
    if (!task || task.displayPid !== p.id || task.patched) return;
    if (task.bugLine >= 0 && line === task.bugLine) {
      task.patched = true;
      task.snippet.lines[task.bugLine] = task.fix;
      this.broadcast({ t: 'task', task });
    } else {
      this.penalizeGuess(task);
    }
    this.persist();
  }

  // Code review, act 2: ship it. Shipping with the bug still in there is
  // where production pain comes from.
  handleCodeShip(p: Player, taskId: string) {
    const g = this.g!;
    if (g.phase !== 'playing') return;
    const task = g.tasks.find((x) => x.id === taskId && x.kind === 'code') as CodeTask | undefined;
    if (!task || task.displayPid !== p.id) return;
    if (task.bugLine < 0 || task.patched) {
      this.completeTask(task, p);
    } else {
      this.shipBuggy(task, p);
    }
    this.persist();
  }

  // A bug made it to prod. The build "ships" (kanban moves on) but the sim
  // takes real damage: backend pods crash-loop or the frontend melts down —
  // recovered the same way real incidents are (restart / hotfix).
  shipBuggy(task: CodeTask, p: Player) {
    const g = this.g!;
    g.score += Math.round(task.points * 0.3); // it did ship… technically
    g.stats.shipped++; g.sprintStats!.shipped++;
    g.stats.bugsShipped++; g.sprintStats!.bugsShipped++;
    this.finishTask(task, 'done');
    const causeId = this.logEvent('bug_shipped', `Shipped with a bug: ${task.title}`, { actor: p.name });
    const backendHit = Math.random() < 0.5;
    if (backendHit) {
      g.sim.crashedPods = Math.max(g.sim.crashedPods, Math.max(1, Math.ceil(this.ctlVal('replicas', 3) * 0.5)));
      if (!g.openEv.crash) {
        g.openEv.crash = this.logEvent('crash', 'Backend pods crash-looping', { cause: causeId });
      }
      this.botSay('pager', `💥 ${p.name} shipped "${task.title}" with a bug — backend pods are crash-looping! Restart them, fast.`);
      g.logs.push(this.makeLog(['error', 'backend', `pod backend-${uid().slice(0, 4)} crashed: unhandled exception in new build`]));
    } else {
      g.sim.badDeploy = true;
      if (!g.openEv.badDeploy) {
        g.openEv.badDeploy = this.logEvent('bad_deploy', 'Frontend erroring on the bad build', { cause: causeId });
      }
      this.botSay('pager', `💥 ${p.name} shipped "${task.title}" with a bug — the frontend is throwing errors everywhere. Push a hotfix!`);
      g.logs.push(this.makeLog(['error', 'frontend', `TypeError: cannot read properties of undefined ("${task.title}")`]));
    }
    if (task.why) this.botSay('system', `🔍 The missed bug: ${task.why}`);
  }

  // ------------------------------------------------------------- event ledger

  logEvent(type: string, label: string, opts: Partial<GameEvent> = {}): string {
    const e: GameEvent = { id: uid(), ts: Date.now(), type, label, ...opts };
    this.g!.events.push(e);
    if (this.g!.events.length > 400) this.g!.events.shift();
    return e.id;
  }

  closeEvent(id: string | null | undefined, patch: Partial<GameEvent> = {}) {
    if (!id) return;
    const e = this.g!.events.find((x) => x.id === id);
    if (e && !e.end) Object.assign(e, { end: Date.now() }, patch);
  }

  // Which open situation does an ops action most plausibly address? Links the
  // fixing action to its cause in the ledger.
  actionCause(key: string): string | null {
    const open = this.g!.openEv;
    if (open.crash && key === 'restart_backend') return open.crash;
    if (open.badDeploy && key === 'hotfix') return open.badDeploy;
    return open.incident;
  }

  // ------------------------------------------------------------- controls helpers

  findControl(key: string): { p: Player; c: ControlInstance } | null {
    for (const p of Object.values(this.g!.players)) {
      const c = p.controls.find((c) => c.key === key);
      if (c) return { p, c };
    }
    return null;
  }

  ctlVal(key: string, fallback = 0): number {
    // in mega mode a pool dial exists on several screens — the sim honors the
    // strongest connected copy so any holder's action counts
    if (this.g!.config.megaMode) {
      let best: number | null = null;
      for (const p of this.activePlayers()) {
        const c = p.controls.find((c) => c.key === key);
        if (c && (best === null || c.value > best)) best = c.value;
      }
      if (best !== null) return best;
    }
    return this.findControl(key)?.c.value ?? fallback;
  }

  setCtl(key: string, value: number) {
    const found = this.findControl(key);
    if (!found) return;
    found.c.value = value;
    this.broadcast({ t: 'control', pid: found.p.id, key, value });
  }

  // ------------------------------------------------------------- game flow

  activePlayers(): Player[] {
    return Object.values(this.g!.players).filter((p) => p.connected && p.role !== 'spectator');
  }

  startGame() {
    const g = this.g!;
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
    g.stats = freshStats();
    g.usedSnippets = [];
    g.usedTickets = [];
    g.events = [];
    g.openEv = { sprint: null, incident: null, crash: null, badDeploy: null };
    g.analysis = null;
    for (const p of Object.values(g.players)) p.dialHints = 0;
    this.buildBacklog();
    this.dealAllControls();
    this.startSprint(1);
  }

  buildBacklog() {
    const g = this.g!;
    const epics = shuffle(EPIC_FEATURES.filter((e) => !g.services.includes(e.service)));
    const base = shuffle(FEATURES);
    // interleave: an epic every ~3 features so the infra grows steadily
    const out: BacklogItem[] = [];
    while (base.length || epics.length) {
      out.push(...base.splice(0, 2).map((title) => ({ title })));
      if (epics.length) out.push(epics.shift()!);
    }
    g.backlog = out;
  }

  leastLoaded(players: Player[]): Player[] {
    return [...players].sort((a, b) => a.controls.length - b.controls.length);
  }

  dealAllControls() {
    const players = this.activePlayers();
    const cfg = this.g!.config;
    for (const p of players) p.controls = [];
    for (const def of shuffle(CRITICAL_CONTROLS)) {
      const byLoad = this.leastLoaded(players);
      (byLoad.find((p) => p.role === def.role) || byLoad[0])!.controls.push(this.instantiate(def, true));
    }
    if (cfg.megaMode) {
      // mega mode: deal a small set of pool dials so every dial lives on
      // multiple screens — missions then demand a quorum of holders.
      // Bigger crowds get more copies per dial so quorums feel like a crowd.
      const slots = players.reduce(
        (n, p) => n + Math.max(0, cfg.controlsPerPlayer - p.controls.length), 0);
      const copies = clamp(Math.round(players.length / 4) + 1, 2, 6);
      const nKeys = clamp(Math.ceil(slots / copies), 2, CONTROL_POOL.length);
      const chosen = shuffle(CONTROL_POOL).slice(0, nKeys);
      // flat deck of repeated dials, each card dealt to the least-loaded
      // player who can still take it
      const deck = shuffle(Array.from({ length: slots }, (_, i) => chosen[i % chosen.length]));
      for (const def of deck) {
        const p = this.leastLoaded(players).find(
          (pl) => pl.controls.length < cfg.controlsPerPlayer && !pl.controls.some((c) => c.key === def.key),
        );
        if (p) p.controls.push(this.instantiate(def, false));
      }
      return;
    }
    const pool = shuffle(CONTROL_POOL);
    for (const p of players) {
      const preferred = pool.filter((d) => d.role === p.role);
      const rest = pool.filter((d) => d.role !== p.role);
      // small teams end up crit-heavy (8 crit dials over few hands) — always
      // deal at least 2 mission dials on top so dial missions can spawn
      const want = Math.max(this.g!.config.controlsPerPlayer, p.controls.length + 2);
      for (const def of [...preferred, ...rest]) {
        if (p.controls.length >= want) break;
        if (p.controls.some((c) => c.key === def.key)) continue;
        if (players.some((o) => o !== p && o.controls.some((c) => c.key === def.key))) continue;
        p.controls.push(this.instantiate(def, false));
      }
    }
  }

  dealPoolControls(p: Player) {
    const cfg = this.g!.config;
    const taken = new Set(
      Object.values(this.g!.players).flatMap((x) => x.controls.map((c) => c.key)),
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
      .slice(0, this.g!.config.controlsPerPlayer)
      .map((d) => this.instantiate(d, false));
  }

  instantiate(def: ControlDef, crit: boolean): ControlInstance {
    const c: ControlInstance = { key: def.key, label: def.label, type: def.type, value: 0, crit };
    if (def.type === 'slider') {
      const min = def.min ?? 0;
      const max = def.max ?? min;
      c.min = min;
      c.max = max;
      c.value = min + rnd(max - min + 1);
    }
    if (def.type === 'select') { c.options = def.options; c.value = rnd(def.options!.length); }
    if (def.type === 'toggle') c.value = rnd(2);
    if (def.key in CRITICAL_INIT) c.value = CRITICAL_INIT[def.key as keyof typeof CRITICAL_INIT];
    if (def.key === 'dns_primary') c.value = rnd(REGIONS.length);
    return c;
  }

  ramp() { return 1 + this.g!.config.difficultyRamp * (this.g!.sprint - 1); }

  startSprint(n: number) {
    const g = this.g!;
    const now = Date.now();
    g.phase = 'playing';
    g.sprint = n;
    g.sprintEndsAt = now + g.config.sprintSeconds * 1000;
    g.sprintStats = { shipped: 0, bugsFixed: 0, incidentsResolved: 0, triaged: 0, missed: 0, bugsShipped: 0, scoreStart: g.score };
    this.closeEvent(g.openEv.sprint);
    g.openEv.sprint = this.logEvent('sprint', `Sprint ${n}`);
    g.tasks = [];
    g.incident = null;
    Object.assign(g.sim, INCIDENT_SIM_RESET, { trafficMult: 1, cacheWarmth: 1 });
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
    const g = this.g!;
    const s = g.sprintStats!;
    s.scoreDelta = g.score - s.scoreStart;
    g.stats.sprints.push({ sprint: g.sprint, ...s });
    for (const t of g.tasks) this.finishTask(t, 'cancelled');
    g.tasks = [];
    if (g.incident) this.clearIncident(false);
    this.closeEvent(g.openEv.sprint);
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
    const g = this.g!;
    g.phase = 'ended';
    for (const k of Object.keys(g.openEv) as (keyof GameState['openEv'])[]) {
      this.closeEvent(g.openEv[k]);
      g.openEv[k] = null;
    }
    g.analysis = this.analyzeGame();
    this.botSay('ceo', g.victory
      ? 'We shipped the roadmap AND the site is up?! Promotions for everyone. (Figuratively.)'
      : 'The site is down and morale is downer. Mandatory fun retreat next week.');
    this.persist();
    this.broadcastPhase();
    // ticking stops, but the idle + inactivity sweeps must keep running
    this.armIdleAlarm();
  }

  // Post-game cause analysis: read the ledger, spot the team's recurring
  // failure modes, and say them out loud for the retro.
  analyzeGame(): AnalysisItem[] {
    const g = this.g!;
    const ev = g.events;
    const out: AnalysisItem[] = [];
    const incidents = ev.filter((e) => e.type === 'incident');
    const resolved = incidents.filter((e) => e.outcome === 'resolved');
    const failed = incidents.filter((e) => e.outcome === 'failed');
    const shippedBugs = g.stats.bugsShipped;

    if (shippedBugs > 0) {
      const meltdowns = ev.filter((e) => (e.type === 'crash' || e.type === 'bad_deploy') && e.cause).length;
      out.push({
        icon: '🚢', title: `${shippedBugs} build${shippedBugs > 1 ? 's' : ''} shipped with the bug still in`,
        detail: `Rushed code reviews caused ${meltdowns} self-inflicted production meltdown${meltdowns === 1 ? '' : 's'}. Read every line before hitting ship — the 30% partial credit is not worth the pager.`,
      });
    } else if (ev.some((e) => e.type === 'ship' || e.type === 'fix')) {
      out.push({
        icon: '🧼', title: 'Zero bugs escaped code review',
        detail: 'Every review caught its bug before ship. Textbook engineering discipline.',
      });
    }

    const byKind: Record<string, number> = {};
    for (const i of incidents) if (i.kind) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    const top = Object.entries(byKind).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const [topKind, topCount] = top;
      const t = INCIDENTS[topKind as IncidentKind];
      out.push({
        icon: '🔁', title: `Recurring failure mode: ${t?.shortLabel?.toLowerCase() ?? topKind} ×${topCount}`,
        detail: `The same class of incident kept coming back. Post-incident fix that sticks: ${t?.hint ?? 'write the runbook.'}`,
      });
    }

    const mttr = resolved.map((e) => (e.end! - e.ts) / 1000);
    if (mttr.length) {
      const avg = Math.round(mttr.reduce((a, b) => a + b, 0) / mttr.length);
      out.push(avg <= g.config.incidentDeadlineSec / 2
        ? { icon: '🏎️', title: `Mean time to recovery: ${avg}s`, detail: `${resolved.length} incident${resolved.length > 1 ? 's' : ''} resolved, most before the pager got loud. Genuinely good SRE work.` }
        : { icon: '🐌', title: `Mean time to recovery: ${avg}s`, detail: 'Diagnosis is eating the clock. Agree on who reads the graphs and who turns the dials before the next incident, not during it.' });
    }
    if (failed.length) {
      out.push({
        icon: '🔥', title: `${failed.length} incident${failed.length > 1 ? 's' : ''} burned out unresolved`,
        detail: 'They timed out and took team health with them. When the pager fires, someone must own it out loud within seconds.',
      });
    }
    if (g.stats.missed >= 3) {
      out.push({
        icon: '⏰', title: `${g.stats.missed} missions expired untouched`,
        detail: 'Work is landing on screens nobody is watching. Call out your instructions — the dial is probably on someone else\'s console.',
      });
    }
    if (g.stats.wrongGuesses >= 5) {
      out.push({
        icon: '🎯', title: `${g.stats.wrongGuesses} wrong taps across reviews and triage`,
        detail: `Guessing costs ${GUESS_PENALTY.points} points and ${GUESS_PENALTY.secs}s each. Slow down half a beat — the answer is usually in the text.`,
      });
    }
    if (!out.length) {
      out.push({ icon: '✨', title: 'A suspiciously clean run', detail: 'No recurring failure modes detected. Either you are excellent or the chaos settings are too kind.' });
    }
    return out.slice(0, 5);
  }

  toLobby() {
    const g = this.g!;
    g.phase = 'lobby';
    g.sprint = 0;
    g.tasks = [];
    g.doneLog = [];
    g.incident = null;
    g.sim = freshSim();
    for (const p of Object.values(g.players)) p.controls = [];
    const { startingServices = [] } = PRESETS[g.config.preset as PresetId] || {};
    g.services = [...CORE_SERVICES, ...startingServices];
    this.persist();
    // ticking stops, but the idle + inactivity sweeps must keep running
    this.armIdleAlarm();
    this.broadcast({ t: 'snapshot', g: this.publicState(), now: Date.now() });
  }

  // ------------------------------------------------------------- simulation

  simTick(now: number) {
    const g = this.g!;
    const sim = g.sim;
    const cfg = g.config;
    const has = (svc: string) => g.services.includes(svc);
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
    const coldRegion = sim.dnsSwitchedAt && now - sim.dnsSwitchedAt < INCIDENT_TUNING.dnsTtlMs * 2;
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
    if (inc?.kind === 'ddos' && firewall < INCIDENT_TUNING.firewallShed) err += 5; // junk auth errors
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
        if (now - sim.dnsSwitchedAt < INCIDENT_TUNING.dnsTtlMs) { err += 12; p95 += 220; } // stale resolvers
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

  // Per-service map stats: `v` is the one-line headline on the node, `s` the
  // status, `d` the detail rows shown in the node inspector.
  nodeStats(): Record<string, NodeStat> {
    const g = this.g!;
    const sim = g.sim;
    const has = (svc: string) => g.services.includes(svc);
    const dnsRegion = REGIONS[this.ctlVal('dns_primary', 0)];
    const replicas = this.ctlVal('replicas', 3);
    const breakerOn = this.ctlVal('circuit_breaker') === 1;
    const firewall = this.ctlVal('firewall', 2);
    const cacheTtl = this.ctlVal('cache_ttl', 3);
    const drain = this.ctlVal('queue_drain', 4);
    const nodes: Record<string, NodeStat> = {};

    nodes.dns = {
      v: dnsRegion,
      s: sim.failedRegion && dnsRegion === sim.failedRegion ? 'down' : 'ok',
      d: [
        ['primary record', dnsRegion],
        ['ttl', `${INCIDENT_TUNING.dnsTtlMs / 1000}s`],
        ['propagation', sim.dnsSwitchedAt && Date.now() - sim.dnsSwitchedAt < INCIDENT_TUNING.dnsTtlMs ? 'in progress…' : 'settled'],
      ],
    };
    nodes.lb = {
      v: `${sim.rps} rps`,
      s: sim.util > 1.2 || (g.incident?.kind === 'ddos' && firewall < INCIDENT_TUNING.firewallShed) ? 'degraded' : 'ok',
      d: [['traffic', `${sim.rps} rps`], ['error rate', `${sim.err}%`], ['firewall', `${firewall}/8`]],
    };
    nodes.frontend = {
      v: `${sim.p95} ms p95`,
      s: sim.badDeploy ? 'down' : sim.util > 1.15 || sim.crashedPods > 0 ? 'degraded' : 'ok',
      d: [
        ['p95 latency', `${sim.p95} ms`],
        ['build', sim.badDeploy ? '💥 erroring — hotfix!' : 'healthy'],
      ],
    };
    nodes.backend = {
      v: `${Math.round(sim.util * 100)}% load · ${Math.max(0, replicas - sim.crashedPods)}/${replicas} pods`,
      s: sim.crashedPods > 0 || sim.util > 1.15 ? 'down'
        : sim.util > 0.85 || sim.leak > 0.15 || sim.badDeploy ? 'degraded' : 'ok',
      d: [
        ['utilization', `${Math.round(sim.util * 100)}%`],
        ['pods healthy', `${Math.max(0, replicas - sim.crashedPods)}/${replicas}`],
        ['autoscaler', this.ctlVal('autoscaler') === 1 ? 'on' : 'off'],
        ...(sim.leak > 0 ? ([['memory', `leaking (+${Math.round(sim.leak * 100)}%)`]] as [string, string][]) : []),
      ],
    };
    const backupFreq = this.ctlVal('backup_freq', 3);
    nodes.db = sim.dbCorrupt
      ? {
          v: sim.restoring > 0 ? `restoring… ${sim.restoring}s` : 'integrity errors',
          s: sim.restoring > 0 ? 'degraded' : 'down',
          d: [['status', sim.restoring > 0 ? `restore ETA ${sim.restoring}s` : 'CORRUPT'], ['backup freq', `${backupFreq}/8`]],
        }
      : {
          v: `${sim.dbIops} iops`,
          s: (sim.failedRegion && dnsRegion === sim.failedRegion) || sim.dbIops > 700 ? 'degraded' : 'ok',
          d: [['iops', sim.dbIops], ['backup freq', `${backupFreq}/8`]],
        };
    if (has('cdn')) {
      const hit = 70 + rnd(25);
      nodes.cdn = { v: `${hit}% hit`, s: 'ok', d: [['hit ratio', `${hit}%`]] };
    }
    if (has('cache')) {
      nodes.cache = {
        v: `${sim.cacheHit}% hit`,
        s: sim.cacheWarmth < 0.25 ? 'down' : sim.cacheWarmth < 0.6 ? 'degraded' : 'ok',
        d: [
          ['hit ratio', `${sim.cacheHit}%`],
          ['warmth', `${Math.round(sim.cacheWarmth * 100)}%`],
          ['ttl', `${cacheTtl}/8`],
        ],
      };
    }
    if (has('queue')) {
      nodes.queue = {
        v: `${sim.queueDepth} jobs`,
        s: sim.queueDepth > 250 ? 'down' : sim.queueDepth > 100 ? 'degraded' : 'ok',
        d: [['backlog', `${sim.queueDepth} jobs`], ['drain rate', `${4 + 7 * drain}/s`]],
      };
    }
    if (has('payments')) {
      nodes.payments = {
        v: sim.paymentsUp ? `${40 + rnd(60)} ms` : breakerOn ? 'breaker open' : 'timeouts',
        s: sim.paymentsUp ? 'ok' : breakerOn ? 'degraded' : 'down',
        d: [
          ['provider', sim.paymentsUp ? 'operational' : 'DOWN (their status page lies)'],
          ['circuit breaker', breakerOn ? 'open (failing fast)' : 'closed'],
        ],
      };
    }
    if (has('search')) {
      const qps = Math.round(sim.rps * 0.3);
      nodes.search = { v: `${qps} qps`, s: 'ok', d: [['queries', `${qps}/s`]] };
    }
    if (has('analytics')) {
      const evs = Math.round(sim.rps * 4);
      nodes.analytics = { v: `${evs} ev/s`, s: 'ok', d: [['events', `${evs}/s`]] };
    }
    return nodes;
  }

  // ------------------------------------------------------------- tick

  // Retire players whose sockets have been gone for PLAYER_TTL_MS so they
  // don't linger in the roster as "offline" forever.
  sweepInactivePlayers() {
    const g = this.g!;
    const live = new Set(
      this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.pid),
    );
    for (const p of Object.values(g.players)) {
      if (p.connected && !live.has(p.id)) {
        // missed close event — start their inactivity clock now
        this.releasePlayer(p);
        this.persist();
        this.broadcast({ t: 'players', players: this.publicPlayers() });
      } else if (!p.connected && Date.now() - (p.lastSeenAt ?? 0) >= PLAYER_TTL_MS) {
        this.removePlayer(p, `${p.name} was inactive and left the team 💤`);
      }
    }
  }

  // Non-ticking rooms (lobby / ended) wake for whichever comes first: the
  // next disconnected player's TTL or the room idle sweep.
  armIdleAlarm() {
    const g = this.g!;
    const gone = Object.values(g.players).filter((p) => !p.connected);
    const next = gone.length
      ? Math.min(...gone.map((p) => (p.lastSeenAt ?? 0) + PLAYER_TTL_MS))
      : (g.lastActiveAt ?? Date.now()) + ROOM_TTL_MS;
    this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  async alarm() {
    const g = this.g!;
    if (!g) return;
    // idle sweep: sockets present keep the room alive; a room untouched for
    // ROOM_TTL_MS with nobody connected deletes itself
    if (this.ctx.getWebSockets().length > 0) {
      g.lastActiveAt = Date.now();
    } else if (Date.now() - (g.lastActiveAt ?? g.createdAt) >= ROOM_TTL_MS) {
      this.g = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    this.sweepInactivePlayers();
    if (g.phase === 'review') {
      if (Date.now() >= g.reviewEndsAt) { this.startSprint(g.sprint + 1); return; }
      this.ctx.storage.setAlarm(Date.now() + TICK_MS);
      return;
    }
    if (g.phase !== 'playing') {
      // lobby / ended rooms wake only for player TTLs and the idle re-check
      this.armIdleAlarm();
      return;
    }

    const now = Date.now();
    g.tickCount++;
    const logs: LogLine[] = [];

    this.simTick(now);

    // task deadlines
    for (const t of [...g.tasks]) {
      if (now >= t.deadlineAt) {
        this.finishTask(t, 'failed');
        g.health -= g.config.missPenalty;
        g.stats.missed++; g.sprintStats!.missed++;
        this.logEvent('missed', `Missed: ${t.title}`, { actor: t.ownerName });
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
    let trace: Trace | null = null;
    if (now >= g.nextTraceAt) {
      trace = this.makeTrace(now);
      if (trace) {
        g.traces.push(trace);
        if (g.traces.length > 20) g.traces.shift();
      }
      g.nextTraceAt = now + 3000 + rnd(3000);
    }
    g.nodes = this.nodeStats();

    g.health = clamp(g.health, 0, 100);
    if (g.health <= 0) {
      g.victory = false;
      // wind the sprint down properly: no live tasks/incidents on the retro
      // screen, and the fatal sprint still gets its stats row
      for (const t of [...g.tasks]) this.finishTask(t, 'cancelled');
      if (g.incident) this.clearIncident(false);
      if (g.sprintStats) {
        g.sprintStats!.scoreDelta = g.score - g.sprintStats!.scoreStart;
        g.stats.sprints.push({ sprint: g.sprint, ...g.sprintStats });
      }
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

  targetedControls(): Set<string> {
    const set = new Set<string>();
    for (const t of this.g!.tasks) if (isDialTask(t)) set.add(t.controlKey);
    return set;
  }

  pickBacklogItem(isBug: boolean): BacklogItem {
    const g = this.g!;
    if (isBug) return { title: pick(BUGS) };
    if (!g.backlog.length) g.backlog = shuffle(FEATURES).map((title) => ({ title }));
    return g.backlog.shift()!;
  }

  taskDeadline(mult = 1) {
    return (this.g!.config.taskDeadlineSec * 1000 * mult) / (1 + 0.15 * (this.g!.sprint - 1));
  }

  // spread work evenly: new tasks land on the least-loaded screen
  pickDisplay(displays: Player[]): Player {
    const load = (p: Player) => this.g!.tasks.filter((t) => t.displayPid === p.id).length;
    const min = Math.min(...displays.map(load));
    return pick(displays.filter((p) => load(p) === min));
  }

  spawnTask() {
    const g = this.g!;
    const players = this.activePlayers();
    if (!players.length) return;
    const displays = players.filter(
      (p) => g.tasks.filter((t) => t.displayPid === p.id).length < g.config.maxActivePerPlayer,
    );
    if (!displays.length) return;

    // one roll decides the task family: triage, code review, design review, or dial
    const roll = Math.random();
    let band = g.config.triageChance;
    if (roll < band && this.spawnTriageTask(displays)) return;
    band += g.config.codeChance;
    if (roll < band && this.spawnCodeTask(displays)) return;
    band += g.config.designChance ?? 0;
    if (roll < band && this.spawnDesignTask(displays)) return;

    // mega mode: dial missions demand a quorum of holders instead of one owner
    if (g.config.megaMode && this.spawnQuorumTask(displays)) return;

    // tasks only target mission dials (pool controls) — the ops console is
    // reserved for running the actual system
    const targeted = this.targetedControls();
    const eligible = (p: Player) => p.controls.filter((c) => !c.crit && !targeted.has(c.key));
    const owners = shuffle(players).filter((p) => eligible(p).length > 0);
    if (!owners.length) return;
    const owner = owners[0];
    const control = pick(eligible(owner));
    const target = this.rollTarget(control);
    const isBug = Math.random() < g.config.bugChance;
    const item = this.pickBacklogItem(isBug);
    const display = this.pickDisplay(displays);

    // tutorial nudge: everyone's first ticket or two says where the dial
    // actually lives — new players don't yet know what's on whose console
    let locHint: string | null = null;
    display.dialHints ??= 0;
    if (display.dialHints < 2) {
      display.dialHints++;
      locHint = owner.id === display.id ? 'you' : owner.name;
    }

    const task: DialTask = {
      id: uid(),
      kind: isBug ? 'bug' : 'feature',
      title: item.title,
      epicService: !isBug && item.service && !g.services.includes(item.service) ? item.service : null,
      instr: instructionFor(control, target),
      locHint,
      displayPid: display.id,
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

  // A new value for a dial that differs from its current one.
  rollTarget(control: ControlInstance): number {
    let target = 1;
    if (control.type === 'toggle') target = control.value ? 0 : 1;
    if (control.type === 'slider') {
      const min = control.min ?? 0;
      do { target = min + rnd(control.max! - min + 1); } while (target === control.value);
    }
    if (control.type === 'select') { do { target = rnd(control.options!.length); } while (target === control.value); }
    return target;
  }

  // Draw an unused item from a content pool, recycling the used-list when the
  // pool runs dry. Mutates usedList in place.
  drawFresh<T>(pool: readonly T[], usedList: string[], keyOf: (x: T) => string, inUseKeys: Set<string>): T | null {
    let avail = pool.filter((x) => !inUseKeys.has(keyOf(x)) && !usedList.includes(keyOf(x)));
    if (!avail.length) {
      usedList.length = 0;
      avail = pool.filter((x) => !inUseKeys.has(keyOf(x)));
    }
    if (!avail.length) return null;
    const item = pick(avail);
    usedList.push(keyOf(item));
    return item;
  }

  // Mega-mode dial mission: the same dial lives on several screens and the
  // mission only completes once enough holders perform the action.
  spawnQuorumTask(displays: Player[]): boolean {
    const g = this.g!;
    const players = this.activePlayers();
    const targeted = this.targetedControls();
    const holders: Record<string, { p: Player; c: ControlInstance }[]> = {};
    for (const p of players) {
      for (const c of p.controls) {
        if (!c.crit && !targeted.has(c.key)) (holders[c.key] ??= []).push({ p, c });
      }
    }
    const candidates = Object.entries(holders).filter(([, hs]) => hs.length >= 2);
    if (!candidates.length) return false;
    const [key, hs] = pick(candidates);
    const sample = hs[0].c;

    // aim at the least-held value so the mission is never pre-satisfied
    const countAt = (v: number) => hs.filter(({ c }) => c.value === v).length;
    let values = [0, 1];
    if (sample.type === 'slider') {
      const min = sample.min ?? 0;
      values = Array.from({ length: sample.max! - min + 1 }, (_, i) => min + i);
    }
    if (sample.type === 'select') values = sample.options!.map((_, i) => i);
    if (sample.type === 'button') values = [1];
    const order = shuffle(values);
    let target = order[0];
    for (const v of order) if (countAt(v) < countAt(target)) target = v;

    const required = Math.max(2, Math.ceil(hs.length * 0.6));
    const have = sample.type === 'button' ? 0 : hs.filter(({ c }) => c.value === target).length;
    const isBug = Math.random() < g.config.bugChance;
    const item = this.pickBacklogItem(isBug);
    const display = this.pickDisplay(displays);

    const task: DialTask = {
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
      ownerPid: null,
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

  // Code review missions: the snippet is drawn from the 1000-strong themed
  // pool for THIS task's title, so code and description always match. The
  // reviewer taps the broken line to patch it, then ships. Some builds arrive
  // already clean — shipping those untouched is the right call.
  spawnCodeTask(displays: Player[]): boolean {
    const g = this.g!;
    const isBug = Math.random() < g.config.bugChance;
    const item = this.pickBacklogItem(isBug);
    const pool = SNIPPETS_BY_TITLE[item.title] || CODE_SNIPPETS;
    const inUse = new Set(
      g.tasks.filter((t): t is CodeTask => t.kind === 'code').map((t) => t.snippetId),
    );
    const snippet = this.drawFresh(pool, g.usedSnippets, (s) => s.id, inUse);
    if (!snippet) return false;

    const codeKind = isBug ? 'bug' : item.service && !g.services.includes(item.service) ? 'service' : 'feature';
    const title = codeKind === 'bug' ? `Fix: ${item.title}`
      : codeKind === 'service' ? `Build service: ${item.title}`
      : `Build: ${item.title}`;
    // code review is engineering turf: reviews land on engineer screens first
    // (mirroring triage → ops and design QA → designers)
    const engDisplays = displays.filter((p) => p.role === 'engineer');
    const display = this.pickDisplay(engDisplays.length ? engDisplays : displays);

    // a quarter of feature/service builds are already correct — but bug-fix
    // missions always contain the bug you were sent to fix
    const clean = codeKind !== 'bug' && Math.random() < 0.25;
    const lines = [...snippet.lines];
    if (clean) lines[snippet.bug] = snippet.fix;

    const task: CodeTask = {
      id: uid(), kind: 'code', codeKind, title,
      epicService: codeKind === 'service' ? item.service : null,
      instr: 'Review it: tap anything broken, then ship',
      snippetId: snippet.id,
      snippet: { name: snippet.name, lines },
      bugLine: clean ? -1 : snippet.bug,
      fix: snippet.fix, patched: false,
      why: clean ? null : snippet.why, wrongGuesses: 0,
      displayPid: display.id, ownerPid: display.id, ownerName: display.name,
      createdAt: Date.now(), deadlineAt: Date.now() + this.taskDeadline(1.8),
      status: 'active', points: 150,
    };
    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    return true;
  }

  // Design review — visual QA missions. Design is designer turf: they land on
  // designer screens first, and designers get an instinct marker on the right
  // option. Variants: match the swatch, spot the centered dot, match a radius.
  spawnDesignTask(displays: Player[]): boolean {
    const g = this.g!;
    const dsgDisplays = displays.filter((p) => p.role === 'designer');
    const display = this.pickDisplay(dsgDisplays.length ? dsgDisplays : displays);
    const variant = pick(['shade', 'centered', 'radius'] as const);

    const base = {
      id: uid(), kind: 'design' as const, wrongGuesses: 0,
      displayPid: display.id, ownerPid: display.id, ownerName: display.name,
      createdAt: Date.now(), deadlineAt: Date.now() + this.taskDeadline(1.2),
      status: 'active' as const, points: 110,
    };

    let task: DesignTask;
    if (variant === 'shade') {
      const c = pick(DESIGN_COLORS);
      // one exact match among near-miss lightnesses
      const deltas = shuffle([0, ...shuffle([-14, -8, 8, 14]).slice(0, 3)]);
      task = {
        ...base, designKind: 'shade',
        title: `Design QA: ${c.name}`,
        instr: 'Tap the swatch that matches the brand color exactly',
        prompt: { swatch: `hsl(${c.h} ${c.s}% ${c.l}%)`, name: c.name },
        options: deltas.map((d) => `hsl(${c.h} ${c.s}% ${clamp(c.l + d, 8, 92)}%)`),
        answer: deltas.indexOf(0),
      };
    } else if (variant === 'centered') {
      const off = () => pick([-1, 1]) * (4 + rnd(4));
      const options: [number, number][] = shuffle([[0, 0], [off(), 0], [0, off()], [off(), off()]]);
      task = {
        ...base, designKind: 'centered',
        title: 'Design QA: alignment pass',
        instr: 'Tap the card whose dot is perfectly centered',
        prompt: null,
        options,
        answer: options.findIndex(([x, y]) => x === 0 && y === 0),
      };
    } else {
      const options = shuffle(DESIGN_RADII).slice(0, 4);
      const target = pick(options);
      task = {
        ...base, designKind: 'radius',
        title: 'Design QA: corner radius',
        instr: `Tap the div with border-radius: ${target}px`,
        prompt: { radius: target },
        options,
        answer: options.indexOf(target),
      };
    }

    g.tasks.push(task);
    this.broadcast({ t: 'task', task });
    return true;
  }

  // Ticket triage — route a customer request or bug report to the right
  // priority. Triage is ops turf: tickets land on ops screens first, and ops
  // gets an instinct marker on the correct option.
  spawnTriageTask(displays: Player[]): boolean {
    const g = this.g!;
    const inUse = new Set(
      g.tasks.filter((t): t is TriageTask => t.kind === 'triage').map((t) => t.ticketText),
    );
    const ticket = this.drawFresh(TRIAGE_TICKETS, g.usedTickets, (t) => t.text, inUse);
    if (!ticket) return false;
    const opsDisplays = displays.filter((p) => p.role === 'ops');
    const display = this.pickDisplay(opsDisplays.length ? opsDisplays : displays);

    const task: TriageTask = {
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

  finishTask(task: Task, status: TaskStatus) {
    const g = this.g!;
    task.status = status;
    g.tasks = g.tasks.filter((t) => t.id !== task.id);
    g.doneLog.push({ ...task, finishedAt: Date.now() });
    if (g.doneLog.length > 12) g.doneLog.shift();
    this.broadcast({ t: 'task', task });
  }

  completeTask(task: Task, by: Player | null = null) {
    const g = this.g!;
    const fast = Date.now() - task.createdAt < (task.deadlineAt - task.createdAt) / 2;
    g.score += task.points + (fast ? 25 : 0);
    g.health = clamp(g.health + g.config.healOnComplete, 0, 100);
    const asBug = task.kind === 'bug' || (task.kind === 'code' && task.codeKind === 'bug');
    const actor = by?.name ?? task.ownerName;
    let shipEventId: string | null = null;
    if (task.kind === 'triage') {
      g.stats.triaged = (g.stats.triaged ?? 0) + 1;
      g.sprintStats!.triaged = (g.sprintStats!.triaged ?? 0) + 1;
      this.logEvent('triage', `Triaged: ${task.ticketText?.slice(0, 60) ?? task.title}`, { actor });
    } else if (asBug) {
      g.stats.bugsFixed++; g.sprintStats!.bugsFixed++;
      this.logEvent('fix', task.title.startsWith('Fix') ? task.title : `Fixed: ${task.title}`, { actor });
    } else {
      g.stats.shipped++; g.sprintStats!.shipped++;
      shipEventId = this.logEvent('ship', task.title.startsWith('Build') ? task.title : `Shipped: ${task.title}`, { actor });
    }
    this.finishTask(task, 'done');
    if (task.epicService) this.unlockService(task.epicService, task.title, shipEventId);
    else if (task.why) this.botSay('system', `🧠 ${task.why}`);
    else if (task.kind === 'feature' && g.config.botChatter && Math.random() < 0.35) {
      this.botSay('system', `Shipped: "${task.title}" ${fast ? '⚡ speed bonus!' : '🎉'}`);
    }
  }

  unlockService(svc: string, featureTitle: string, causeId: string | null = null) {
    const g = this.g!;
    if (g.services.includes(svc)) return;
    g.services.push(svc);
    g.nodes = this.nodeStats();
    this.logEvent('deploy', `New service: ${SERVICES[svc].label}`, { cause: causeId });
    this.botSay('system', `Customers loved "${featureTitle}" — new service deployed: ${SERVICES[svc].icon} ${SERVICES[svc].label}. More infra, more ways to break! 📈`);
    this.broadcast({ t: 'services', services: g.services, nodes: g.nodes });
  }

  // ------------------------------------------------------------- incidents

  spawnIncident(now: number) {
    const g = this.g!;
    const cfg = g.config;
    // scenarios that hinge on a pool dial only fire if that dial was dealt
    const dealt = (key: string) => {
      const found = this.findControl(key);
      return !!found && found.p.connected && found.p.role !== 'spectator';
    };
    const enabled = (Object.keys(INCIDENTS) as IncidentKind[]).filter((k) => {
      if (!cfg.incidents[k]) return false;
      const def = INCIDENTS[k];
      if (def.requires && !g.services.includes(def.requires)) return false;
      if (def.requiresControl && !dealt(def.requiresControl)) return false;
      // don't spawn scenarios the team's current posture already defeats
      if (k === 'ddos' && this.ctlVal('firewall', 0) >= INCIDENT_TUNING.firewallShed) return false;
      if (k === 'integration' && this.ctlVal('circuit_breaker') === 1) return false;
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

    // what the players get told depends on the game mode: arcade & assisted
    // spell out goal AND fix immediately (free); realism gives only the pager
    // alert, with an optional paid runbook if the lobby enabled hints
    const mode = MODES[cfg.mode] ? cfg.mode : 'arcade';
    const base = {
      id: uid(), kind, startedAt: now,
      deadlineAt: now + cfg.incidentDeadlineSec * 1000,
      status: 'active' as const, goalDone: false,
    };
    if (mode === 'realism') {
      g.incident = {
        ...base, title: 'Alerts firing', desc: def.alert, goal: null, hint: null,
        hintAvailable: !!cfg.hintsEnabled,
      };
    } else {
      g.incident = { ...base, title: def.title, desc: def.desc, goal: def.goal, hint: def.hint };
    }
    g.openEv.incident = this.logEvent('incident', def.title, { kind });
    this.botSay('pager', `🚨 INCIDENT: ${mode === 'realism' ? def.alert : `${def.title} — ${def.desc}`}`);
    if (cfg.botChatter && Math.random() < 0.5) this.botSay('ceo', pick(CEO_INCIDENT_LINES));
    this.broadcast({ t: 'incident', incident: g.incident });
  }

  incidentGoalMet(): boolean {
    const g = this.g!;
    const sim = g.sim;
    switch (g.incident!.kind) {
      case 'outage': return sim.crashedPods === 0 && sim.util < 1;
      case 'spike': return sim.util < 0.9;
      case 'memleak': return sim.leakFixed && sim.util < 1;
      case 'bad_deploy': return !sim.badDeploy;
      case 'stampede': return sim.cacheWarmth >= 0.7;
      case 'integration': return this.ctlVal('circuit_breaker') === 1;
      case 'queue': return sim.queueDepth < 60;
      case 'ddos': return this.ctlVal('firewall', 0) >= INCIDENT_TUNING.firewallShed;
      case 'failover':
        // realistic DR: DNS must point at a healthy region AND TTL propagation
        // must have finished AND the (cold) standby must handle the load
        return REGIONS[this.ctlVal('dns_primary', 0)] !== sim.failedRegion
          && !!sim.dnsSwitchedAt && Date.now() - sim.dnsSwitchedAt >= INCIDENT_TUNING.dnsTtlMs
          && sim.util < 1;
      case 'data_loss': return !sim.dbCorrupt && sim.restoring === 0;
      default: return false;
    }
  }

  updateIncident(now: number, logs: LogLine[]) {
    const g = this.g!;
    const inc = g.incident!;
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
        g.stats.incidentsResolved++; g.sprintStats!.incidentsResolved++;
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

  clearIncident(resolved: boolean, silent = false) {
    const g = this.g!;
    if (!g.incident) return;
    const inc = g.incident;
    inc.status = resolved ? 'resolved' : 'failed';
    // reveal the real diagnosis post-mortem (realism mode redacts the title)
    inc.title = INCIDENTS[inc.kind]?.title || inc.title;
    g.doneLog.push({
      id: inc.id, kind: 'incident', title: inc.title,
      status: resolved ? 'done' : 'failed', finishedAt: Date.now(),
    });
    if (g.doneLog.length > 12) g.doneLog.shift();
    this.closeEvent(g.openEv.incident, { outcome: resolved ? 'resolved' : 'failed' });
    g.openEv.incident = null;
    // the world-heal below also wipes any shipped-bug damage
    this.closeEvent(g.openEv.crash); g.openEv.crash = null;
    this.closeEvent(g.openEv.badDeploy); g.openEv.badDeploy = null;
    g.incident = null;
    // the world heals: external causes end when the incident ends
    Object.assign(g.sim, INCIDENT_SIM_RESET);
    if (!resolved) g.sim.cacheWarmth = 1;
    g.sim.trafficMult = Math.min(g.sim.trafficMult, resolved ? g.sim.trafficMult : 1);
    g.nextIncidentAt = Date.now() + (g.config.incidentEverySec * 1000) / this.ramp();
    if (!silent) this.broadcast({ t: 'incident', incident: inc });
  }

  // ------------------------------------------------------------- control input

  handleControl(p: Player, key: string, value: number | undefined, press: boolean) {
    const g = this.g!;
    if (g.phase !== 'playing') return;
    const control = p.controls.find((c) => c.key === key);
    if (!control) return;

    if (control.type === 'button') {
      if (!press) return;
      if (key === 'restart_backend' && (g.sim.crashedPods > 0 || g.sim.leak > 0)) {
        g.sim.crashedPods = 0;
        if (g.incident?.kind === 'memleak') g.sim.leakFixed = true;
        g.sim.leak = 0;
        this.logEvent('action', `${p.name} restarted the backend pods`, { actor: p.name, cause: this.actionCause(key) });
        this.closeEvent(g.openEv.crash); g.openEv.crash = null;
        this.botSay('system', `${p.name} restarted the backend pods 🔄`);
      }
      if (key === 'hotfix' && g.sim.badDeploy) {
        g.sim.badDeploy = false;
        this.logEvent('action', `${p.name} pushed a hotfix`, { actor: p.name, cause: this.actionCause(key) });
        this.closeEvent(g.openEv.badDeploy); g.openEv.badDeploy = null;
        this.botSay('system', `${p.name} pushed a hotfix — rolling back the bad build 🚑`);
      }
      if (key === 'restore_backup') {
        if (g.sim.dbCorrupt && g.sim.restoring === 0) {
          g.sim.restoring = INCIDENT_TUNING.restoreSecs;
          this.logEvent('action', `${p.name} started a DB restore`, { actor: p.name, cause: this.actionCause(key) });
          this.botSay('system', `${p.name} kicked off a restore from backup — ETA ${INCIDENT_TUNING.restoreSecs}s ⏳`);
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
      if (control.type === 'slider') value = clamp(Math.round(value), control.min ?? 0, control.max!);
      if (control.type === 'select') value = clamp(Math.round(value), 0, control.options!.length - 1);
      control.value = value;
      this.broadcast({ t: 'control', pid: p.id, key, value });
      // sim-relevant dial moves while an incident is open join its causal chain
      if (this.g!.openEv.incident && CONTROL_SERVICE[key]) {
        const shown = control.type === 'select' ? control.options![value] : value;
        this.logEvent('action', `${p.name}: ${control.label} → ${shown}`, { actor: p.name, cause: this.g!.openEv.incident });
      }
    }

    // mega mode: quorum missions count actions from every holder of the dial
    for (const task of g.tasks.filter((t): t is DialTask => isDialTask(t) && !!t.quorum && t.controlKey === key)) {
      let have: number;
      if (control.type === 'button') {
        task.pressedBy ??= [];
        if (press && !task.pressedBy.includes(p.id)) task.pressedBy.push(p.id);
        have = task.pressedBy.length;
      } else {
        have = 0;
        for (const pl of this.activePlayers()) {
          const copy = pl.controls.find((c) => c.key === key);
          if (copy && copy.value === task.target) have++;
        }
      }
      if (have === task.quorum!.have) continue; // nothing moved — stay quiet
      task.quorum!.have = have;
      if (have >= task.quorum!.required) this.completeTask(task);
      else this.broadcast({ t: 'task', task });
    }

    const effective = control.type === 'button' ? 1 : control.value;
    const match = g.tasks
      .filter((t): t is DialTask =>
        isDialTask(t) && !t.quorum && t.ownerPid === p.id && t.controlKey === key && t.target === effective)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (match) this.completeTask(match);

    this.persist();
  }

  // ------------------------------------------------------------- telemetry

  makeLog([level, svc, tmpl]: LogTemplate): LogLine {
    return {
      ts: Date.now(), level, svc,
      text: tmpl.replaceAll('{n}', String(20 + rnd(480))),
    };
  }

  makeTrace(now: number): Trace | null {
    const g = this.g!;
    const route = pick(TRACE_ROUTES.filter((r) => r.spans.every((s) => g.services.includes(s) || s === 'dns')));
    if (!route) return null;
    const slowSvcs = new Set<string>();
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

  botSay(bot: string, text: string) {
    const b = BOTS[bot] || BOTS.system;
    const m = { id: uid(), from: b.name, bot: true, icon: b.icon, text, ts: Date.now() };
    this.g!.chat.push(m);
    if (this.g!.chat.length > 100) this.g!.chat.shift();
    this.broadcast({ t: 'chat', msg: m });
  }

  // ------------------------------------------------------------- wire

  publicPlayers(): Record<string, Player> {
    const out: Record<string, Player> = {};
    for (const [pid, p] of Object.entries(this.g!.players)) {
      out[pid] = {
        id: p.id, name: p.name, role: p.role, isHost: p.isHost,
        connected: p.connected, controls: p.controls, joinedAt: p.joinedAt,
      };
    }
    return out;
  }

  publicState(): ClientGame {
    const g = this.g!;
    return {
      code: g.code, phase: g.phase, config: g.config,
      name: g.name, hasPassword: !!g.password,
      players: this.publicPlayers(),
      services: g.services,
      sprint: g.sprint, sprintEndsAt: g.sprintEndsAt, reviewEndsAt: g.reviewEndsAt,
      score: g.score, health: g.health, victory: g.victory,
      tasks: g.tasks, doneLog: g.doneLog, incident: g.incident,
      backlog: g.backlog.slice(0, 6),
      chat: g.chat.slice(-50), logs: g.logs.slice(-60),
      traces: g.traces, metrics: g.metrics, nodes: g.nodes,
      stats: g.stats, sprintStats: g.sprintStats,
      events: g.events, analysis: g.analysis,
    };
  }

  broadcastPhase() {
    const g = this.g!;
    this.broadcast({
      t: 'phase', now: Date.now(), phase: g.phase, sprint: g.sprint,
      sprintEndsAt: g.sprintEndsAt, reviewEndsAt: g.reviewEndsAt,
      score: g.score, health: g.health, victory: g.victory,
      stats: g.stats, sprintStats: g.sprintStats,
      players: this.publicPlayers(), backlog: g.backlog.slice(0, 6),
      services: g.services, nodes: g.nodes,
      // the retro needs the full causal ledger — only ship it at game end
      ...(g.phase === 'ended' ? { events: g.events, analysis: g.analysis } : {}),
    });
  }

  send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }

  broadcast(msg: ServerMsg, except: WebSocket | null = null) {
    const raw = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(raw); } catch { /* socket gone */ }
    }
  }
}
