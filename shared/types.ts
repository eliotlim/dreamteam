// Shared domain types — the single source of truth for the game model on
// both sides of the wire. The server owns GameState; clients see ClientGame
// (the publicState() projection) kept in sync by ServerMsg deltas.

// ---------------------------------------------------------------- primitives

export type Role = 'pm' | 'designer' | 'engineer' | 'ops';
export type PlayerRole = Role | 'spectator';
export type Phase = 'lobby' | 'playing' | 'review' | 'ended';
export type ModeId = 'arcade' | 'assisted' | 'realism';
export type PresetId = 'chill' | 'standard' | 'chaos';
export type ControlType = 'toggle' | 'slider' | 'select' | 'button';
export type LogLevel = 'info' | 'warn' | 'error';
export type TaskStatus = 'active' | 'done' | 'failed' | 'cancelled';

export type IncidentKind =
  | 'outage' | 'spike' | 'memleak' | 'bad_deploy' | 'stampede'
  | 'integration' | 'queue' | 'ddos' | 'failover' | 'data_loss';

// ---------------------------------------------------------------- content defs

export interface ControlDef {
  key: string;
  label: string;
  type: ControlType;
  role: Role;
  min?: number;
  max?: number;
  options?: string[];
}

// a dealt control living on one player's console
export interface ControlInstance {
  key: string;
  label: string;
  type: ControlType;
  value: number;
  crit: boolean;
  min?: number;
  max?: number;
  options?: string[];
}

export type LogTemplate = readonly [LogLevel, string, string];

export interface IncidentDef {
  shortLabel: string;
  title: string;
  desc: string;
  goal: string;
  hint: string;
  alert: string;
  requires?: string;
  requiresControl?: string;
  logs: LogTemplate[];
}

export interface ModeDef {
  label: string;
  blurb: string;
  codeChance: number;
  triageChance: number;
  designChance: number;
  hintCost: number;
}

export interface TriageTicket {
  kind: 'bug' | 'request';
  from: string;
  text: string;
  answer: number;
  why: string;
}

export interface Snippet {
  id: string;
  title: string;
  name: string;
  lines: string[];
  bug: number;
  why: string;
  fix: string;
}

export interface DesignColor { name: string; h: number; s: number; l: number }

// ---------------------------------------------------------------- config

export interface GameConfig {
  preset: PresetId | 'custom';
  mode: ModeId;
  megaMode: boolean;
  botChatter: boolean;
  hintsEnabled: boolean;
  codeChance: number;
  triageChance: number;
  designChance: number;
  sprintCount: number;
  sprintSeconds: number;
  controlsPerPlayer: number;
  taskEverySec: number;
  taskDeadlineSec: number;
  incidentEverySec: number;
  incidentDeadlineSec: number;
  maxActivePerPlayer: number;
  bugChance: number;
  missPenalty: number;
  incidentDrainPerSec: number;
  healOnComplete: number;
  difficultyRamp: number;
  spikeMult: number;
  incidents: Record<IncidentKind, boolean>;
}

// numeric knobs applyConfig may clamp-assign from a lobby patch
export type NumericConfigKey = {
  [K in keyof GameConfig]: GameConfig[K] extends number ? K : never;
}[keyof GameConfig];

// ---------------------------------------------------------------- players

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  controls: ControlInstance[];
  /** server-only: how many dial-mission location hints this screen has seen */
  dialHints?: number;
}

// ---------------------------------------------------------------- tasks

export interface Quorum { required: number; have: number; holders: number }

interface TaskBase {
  id: string;
  title: string;
  instr: string;
  displayPid: string;
  ownerPid: string | null;
  ownerName: string;
  createdAt: number;
  deadlineAt: number;
  status: TaskStatus;
  points: number;
  epicService?: string | null;
  wrongGuesses?: number;
  why?: string | null;
  /** client-only: ghost of a completed task shown during the success linger */
  celebrate?: boolean;
}

export interface DialTask extends TaskBase {
  kind: 'feature' | 'bug';
  controlKey: string;
  target: number;
  locHint?: string | null;
  quorum?: Quorum;
  pressedBy?: string[];
}

export interface CodeTask extends TaskBase {
  kind: 'code';
  codeKind: 'feature' | 'service' | 'bug';
  snippetId: string;
  snippet: { name: string; lines: string[] };
  bugLine: number;
  fix: string;
  patched: boolean;
}

export interface TriageTask extends TaskBase {
  kind: 'triage';
  triageKind: 'bug' | 'request';
  ticketText: string;
  options: string[];
  answer: number;
}

export type DesignVariant =
  | { designKind: 'shade'; prompt: { swatch: string; name: string }; options: string[] }
  | { designKind: 'centered'; prompt: null; options: [number, number][] }
  | { designKind: 'radius'; prompt: { radius: number }; options: number[] };

export type DesignTask = TaskBase & { kind: 'design'; answer: number } & DesignVariant;

export type Task = DialTask | CodeTask | TriageTask | DesignTask;
export type TaskKind = Task['kind'];

// finished work + incident stubs shown on the kanban Done/Graveyard columns
export interface DoneEntry {
  id: string;
  kind: TaskKind | 'incident';
  title: string;
  status: TaskStatus;
  finishedAt: number;
}

// ---------------------------------------------------------------- incidents

export interface Incident {
  id: string;
  kind: IncidentKind;
  startedAt: number;
  deadlineAt: number;
  status: 'active' | 'resolved' | 'failed';
  goalDone: boolean;
  title: string;
  desc: string;
  goal: string | null;
  hint: string | null;
  hintAvailable?: boolean;
}

// ---------------------------------------------------------------- telemetry

export interface LogLine { ts: number; level: LogLevel; svc: string; text: string }
export interface TraceSpan { svc: string; ms: number }
export interface Trace { id: string; ts: number; name: string; total: number; spans: TraceSpan[]; error: boolean }
export interface MetricPoint { t: number; rps: number; err: number; p95: number; queue: number }

export type NodeStatus = 'ok' | 'degraded' | 'down';
export interface NodeStat {
  v: string;
  s: NodeStatus;
  d: [string, string | number][];
}

// ---------------------------------------------------------------- sim & stats

export interface Sim {
  rps: number; util: number; err: number; p95: number;
  queueDepth: number; dbIops: number;
  trafficMult: number; cacheWarmth: number; stableTicks: number;
  cacheHit?: number;
  crashedPods: number; paymentsUp: boolean; failedRegion: string | null;
  dnsSwitchedAt: number | null; leak: number; leakFixed: boolean;
  badDeploy: boolean; dbCorrupt: boolean; restoring: number;
}

export interface SprintStats {
  shipped: number; bugsFixed: number; incidentsResolved: number;
  triaged: number; missed: number; bugsShipped: number;
  scoreStart: number; scoreDelta?: number;
}

export interface GameStats {
  shipped: number; bugsFixed: number; incidentsResolved: number;
  triaged: number; missed: number; bugsShipped: number; wrongGuesses: number;
  sprints: ({ sprint: number } & SprintStats)[];
}

// ---------------------------------------------------------------- ledger & retro

export interface GameEvent {
  id: string;
  ts: number;
  type: string;
  label: string;
  end?: number;
  cause?: string | null;
  actor?: string;
  kind?: IncidentKind;
  outcome?: 'resolved' | 'failed';
}

export interface AnalysisItem { icon: string; title: string; detail: string }

export interface ChatMsg {
  id: string;
  from: string;
  text: string;
  ts: number;
  pid?: string;
  role?: PlayerRole;
  bot?: boolean;
  icon?: string;
}

export interface BacklogItem { title: string; service?: string }

// ---------------------------------------------------------------- game state

interface GameCore {
  code: string;
  phase: Phase;
  name: string;
  config: GameConfig;
  players: Record<string, Player>;
  services: string[];
  sprint: number;
  sprintEndsAt: number;
  reviewEndsAt: number;
  score: number;
  health: number;
  victory: boolean;
  tasks: Task[];
  doneLog: DoneEntry[];
  incident: Incident | null;
  backlog: BacklogItem[];
  chat: ChatMsg[];
  logs: LogLine[];
  traces: Trace[];
  metrics: MetricPoint[];
  nodes: Record<string, NodeStat>;
  stats: GameStats;
  sprintStats: SprintStats | null;
  events: GameEvent[];
  analysis: AnalysisItem[] | null;
}

/** full server-side state, persisted in the Durable Object */
export interface GameState extends GameCore {
  createdAt: number;
  lastActiveAt: number;
  password: string | null;
  creatorPid: string | null;
  sim: Sim;
  openEv: { sprint: string | null; incident: string | null; crash: string | null; badDeploy: string | null };
  usedSnippets: string[];
  usedTickets: string[];
  nextTaskAt: number;
  nextIncidentAt: number;
  nextTraceAt: number;
  tickCount: number;
}

/** the publicState() projection mirrored into every client's store */
export interface ClientGame extends GameCore {
  hasPassword: boolean;
}

// ---------------------------------------------------------------- wire: client → server

export type ClientMsg =
  | { t: 'set_role'; role: PlayerRole }
  | { t: 'rename'; name: string }
  | { t: 'set_name'; name: string }
  | { t: 'set_password'; password: string }
  | { t: 'make_host'; pid: string }
  | { t: 'config'; patch: Omit<Partial<GameConfig>, 'incidents'> & { incidents?: Partial<Record<IncidentKind, boolean>> } }
  | { t: 'start' }
  | { t: 'next_sprint' }
  | { t: 'restart' }
  | { t: 'control'; key: string; value?: number; press?: boolean }
  | { t: 'code_guess'; taskId: string; line: number }
  | { t: 'code_ship'; taskId: string }
  | { t: 'triage_pick'; taskId: string; choice: number }
  | { t: 'design_pick'; taskId: string; choice: number }
  | { t: 'hint' }
  | { t: 'chat'; text: string };

// ---------------------------------------------------------------- wire: server → client

export type ServerMsg =
  | { t: 'snapshot'; g: ClientGame; you?: string; now: number }
  | { t: 'players'; players: Record<string, Player> }
  | { t: 'config'; config: GameConfig }
  | { t: 'room'; name?: string; hasPassword?: boolean }
  | {
      t: 'phase'; now: number; phase: Phase; sprint: number;
      sprintEndsAt: number; reviewEndsAt: number;
      score: number; health: number; victory: boolean;
      stats: GameStats; sprintStats: SprintStats | null;
      players: Record<string, Player>; backlog: BacklogItem[];
      services?: string[]; nodes?: Record<string, NodeStat>;
      events?: GameEvent[]; analysis?: AnalysisItem[] | null;
    }
  | { t: 'task'; task: Task }
  | { t: 'incident'; incident: Incident }
  | { t: 'control'; pid: string; key: string; value: number }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'services'; services: string[]; nodes: Record<string, NodeStat> }
  | {
      t: 'tick'; now: number; score: number; health: number;
      sprint: number; sprintEndsAt: number;
      m: MetricPoint; logs: LogLine[]; trace: Trace | null;
      nodes: Record<string, NodeStat>; incident: Incident | null;
    };
