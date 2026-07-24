// Game content: services, controls, task flavor, incident scenarios, bots.

import type {
  ControlDef, ControlType, DesignColor, IncidentDef, IncidentKind,
  LogTemplate, ModeDef, ModeId, PlayerRole, Role, TriageTicket,
} from './types.ts';

export const ROLES: Role[] = ['pm', 'designer', 'engineer', 'ops'];

export const ROLE_META: Record<PlayerRole, { label: string; icon: string; color: string }> = {
  pm:        { label: 'Product Manager', icon: '📋', color: '#c084fc' },
  designer:  { label: 'Designer',        icon: '🎨', color: '#f472b6' },
  engineer:  { label: 'Engineer',        icon: '⚙️', color: '#60a5fa' },
  ops:       { label: 'Ops / SRE',       icon: '🛰️', color: '#34d399' },
  spectator: { label: 'Spectator',       icon: '📺', color: '#94a3b8' },
};

export const REGIONS = ['us-east', 'eu-west', 'ap-south'];

// ---------------------------------------------------------------------------
// Game modes. Arcade is dial-turning; realism strips away the answers and
// makes the team read dashboards; assisted sits in between with paid hints.
// ---------------------------------------------------------------------------

// Penalty for a wrong pick on code-review / triage missions. The server
// applies it; mission cards render it — keep the two honest via this table.
export const GUESS_PENALTY = { secs: 4, points: 10 };

// Numeric incident tuning the sim enforces. The goal/hint prose below states
// the same numbers — update both together.
export const INCIDENT_TUNING = { firewallShed: 6, dnsTtlMs: 8000, restoreSecs: 10 };

export const MODES: Record<ModeId, ModeDef> = {
  arcade: {
    label: '🕹️ Arcade',
    blurb: 'Incidents tell you exactly which dials to turn, and everything is runnable from the dashboard. Pure party.',
    codeChance: 0.12, triageChance: 0.12, designChance: 0.12, hintCost: 0,
  },
  assisted: {
    label: '🧭 Assisted',
    blurb: 'Incidents show the goal and point you at the fix right away — free. Infra is operated from the infra map.',
    codeChance: 0.2, triageChance: 0.18, designChance: 0.15, hintCost: 0,
  },
  realism: {
    label: '🧠 Realism',
    blurb: 'Only pager alerts. Read the graphs, find the failing component, fix it yourselves. Optional runbook hints cost 25 points.',
    codeChance: 0.25, triageChance: 0.2, designChance: 0.15, hintCost: 25,
  },
};

// ---------------------------------------------------------------------------
// Services. `core` services always exist; others start per difficulty or get
// unlocked when the matching epic feature ships ("customer feature requests").
// `tier` drives the diagram layout (left → right).
// ---------------------------------------------------------------------------

export interface ServiceDef {
  label: string;
  icon: string;
  tier: number;
  core?: boolean;
  unlockFeature?: string;
}

export const SERVICES: Record<string, ServiceDef> = {
  dns:       { label: 'DNS',           icon: '🌐', tier: 0, core: true },
  lb:        { label: 'Load Balancer', icon: '⚖️', tier: 1, core: true },
  frontend:  { label: 'Frontend',      icon: '🖥️', tier: 2, core: true },
  backend:   { label: 'Backend',       icon: '⚙️', tier: 2, core: true },
  db:        { label: 'Database',      icon: '🗄️', tier: 3, core: true },
  cdn:       { label: 'CDN',           icon: '📦', tier: 1, unlockFeature: 'Offline mode' },
  cache:     { label: 'Cache',         icon: '⚡', tier: 3, unlockFeature: 'Blazing-fast dashboards' },
  queue:     { label: 'Job Queue',     icon: '📬', tier: 3, unlockFeature: 'Smart notifications v3' },
  payments:  { label: 'PaymentCo API', icon: '💳', tier: 3, unlockFeature: 'One-click checkout' },
  search:    { label: 'Search',        icon: '🔍', tier: 3, unlockFeature: 'Quantum search bar' },
  analytics: { label: 'Analytics',     icon: '📊', tier: 3, unlockFeature: 'Realtime vibe dashboard' },
};

export const SERVICE_EDGES: [string, string][] = [
  ['dns', 'lb'], ['dns', 'cdn'], ['cdn', 'frontend'], ['lb', 'frontend'],
  ['lb', 'backend'], ['backend', 'db'], ['backend', 'cache'],
  ['backend', 'queue'], ['backend', 'payments'], ['backend', 'search'],
  ['backend', 'analytics'],
];

export const CORE_SERVICES = Object.keys(SERVICES).filter((k) => SERVICES[k].core);

// ---------------------------------------------------------------------------
// Controls
// type: toggle (OFF/ON) | slider (min..max) | select (options) | button
// Critical controls are always dealt because the simulation needs them.
// Engineers own the infra/SRE consoles (ops owns ticket triage instead).
// Backend replicas can never go to zero — min is 1.
// ---------------------------------------------------------------------------

export const CRITICAL_CONTROLS: ControlDef[] = [
  { key: 'autoscaler',      label: 'Autoscaler',               type: 'toggle', role: 'engineer' },
  { key: 'circuit_breaker', label: 'Payments Circuit Breaker', type: 'toggle', role: 'engineer' },
  { key: 'dns_primary',     label: 'DNS Primary Record',       type: 'select', role: 'engineer', options: REGIONS },
  { key: 'queue_drain',     label: 'Queue Drain Rate',         type: 'slider', role: 'engineer', min: 0, max: 8 },
  { key: 'restart_backend', label: 'Restart Backend Pods',     type: 'button', role: 'engineer' },
  { key: 'restore_backup',  label: 'Restore DB from Backup',   type: 'button', role: 'engineer' },
  { key: 'replicas',        label: 'Backend Replicas',         type: 'slider', role: 'engineer', min: 1, max: 8 },
  { key: 'cache_ttl',       label: 'Cache TTL',                type: 'slider', role: 'engineer', min: 0, max: 8 },
];

// Which service on the infra map each sim-relevant control operates. Drives
// the node inspector (trigger actions from inside the diagram) and, in
// assisted/realism mode, moves these controls off the flat console and onto
// the map. Controls not listed here are pure mission dials.
export const CONTROL_SERVICE: Record<string, string> = {
  dns_primary: 'dns',
  firewall: 'lb',
  autoscaler: 'backend',
  replicas: 'backend',
  restart_backend: 'backend',
  hotfix: 'backend',
  backup_freq: 'db',
  restore_backup: 'db',
  cache_ttl: 'cache',
  clear_cache: 'cache',
  queue_drain: 'queue',
  circuit_breaker: 'payments',
};

export const SERVICE_CONTROLS = Object.entries(CONTROL_SERVICE).reduce<Record<string, string[]>>(
  (acc, [key, svc]) => (((acc[svc] ??= []).push(key)), acc), {},
);

export const CONTROL_POOL: ControlDef[] = [
  // PM
  { key: 'scope_creep',     label: 'Scope Creep Valve',      type: 'slider', role: 'pm', min: 0, max: 8 },
  { key: 'stakeholders',    label: 'Stakeholder Alignment',  type: 'toggle', role: 'pm' },
  { key: 'okr_multiplier',  label: 'OKR Multiplier',         type: 'slider', role: 'pm', min: 0, max: 8 },
  { key: 'roadmap',         label: 'Roadmap Horizon',        type: 'select', role: 'pm', options: ['this week', 'Q3', 'someday'] },
  { key: 'meeting_load',    label: 'Meeting Load',           type: 'slider', role: 'pm', min: 0, max: 8 },
  { key: 'launch_hype',     label: 'Launch Hype Machine',    type: 'toggle', role: 'pm' },
  { key: 'sync_meeting',    label: 'Call a Sync Meeting',    type: 'button', role: 'pm' },
  { key: 'priority',        label: 'Priority Dial',          type: 'select', role: 'pm', options: ['P0', 'P1', 'P2', 'backlog'] },
  // Designer
  { key: 'border_radius',   label: 'Border Radius',          type: 'slider', role: 'designer', min: 0, max: 8 },
  { key: 'dark_mode',       label: 'Dark Mode',              type: 'toggle', role: 'designer' },
  { key: 'hero_gradient',   label: 'Hero Gradient',          type: 'select', role: 'designer', options: ['sunset', 'ocean', 'cyberpunk', 'beige'] },
  { key: 'whitespace',      label: 'Whitespace Density',     type: 'slider', role: 'designer', min: 0, max: 8 },
  { key: 'figma_sync',      label: 'Figma Sync',             type: 'toggle', role: 'designer' },
  { key: 'font_size',       label: 'Font Size',              type: 'slider', role: 'designer', min: 0, max: 8 },
  { key: 'ship_redesign',   label: 'Ship the Redesign',      type: 'button', role: 'designer' },
  { key: 'brand_color',     label: 'Brand Color',            type: 'select', role: 'designer', options: ['coral', 'teal', 'slate', 'hotdog'] },
  // Engineer
  { key: 'flag_checkout',   label: 'Flag: checkout_v2',      type: 'toggle', role: 'engineer' },
  { key: 'flag_ai',         label: 'Flag: ai_assistant',     type: 'toggle', role: 'engineer' },
  { key: 'retry_backoff',   label: 'Retry Backoff',          type: 'slider', role: 'engineer', min: 0, max: 8 },
  { key: 'deploy_target',   label: 'Deploy Target',          type: 'select', role: 'engineer', options: ['dev', 'staging', 'prod', 'yolo'] },
  { key: 'tech_debt',       label: 'Tech Debt Compactor',    type: 'button', role: 'engineer' },
  { key: 'log_level',       label: 'Log Verbosity',          type: 'select', role: 'engineer', options: ['error', 'warn', 'info', 'debug'] },
  { key: 'unit_tests',      label: 'Unit Tests',             type: 'toggle', role: 'engineer' },
  { key: 'hotfix',          label: 'Push a Hotfix',          type: 'button', role: 'engineer' },
  // Ops
  { key: 'chaos_monkey',    label: 'Chaos Monkey',           type: 'toggle', role: 'ops' },
  { key: 'backup_freq',     label: 'Backup Frequency',       type: 'slider', role: 'ops', min: 0, max: 8 },
  { key: 'firewall',        label: 'Firewall Strictness',    type: 'slider', role: 'ops', min: 0, max: 8 },
  { key: 'oncall',          label: 'On-call Rotation',       type: 'select', role: 'ops', options: ['alice', 'bob', 'the intern', 'nobody'] },
  { key: 'clear_cache',     label: 'Flush the Cache',        type: 'button', role: 'ops' },
  { key: 'vpn',             label: 'Office VPN',             type: 'toggle', role: 'ops' },
];

// ---------------------------------------------------------------------------
// Task flavor. Epic features unlock services when shipped.
// ---------------------------------------------------------------------------

export const EPIC_FEATURES = Object.entries(SERVICES)
  .filter(([, s]) => !!s.unlockFeature)
  .map(([id, s]) => ({ title: s.unlockFeature!, service: id }));

export const FEATURES = [
  'AI-powered onboarding', 'Dark mode for the dark mode', 'Collaborative cursors',
  'Emoji reactions everywhere', 'Infinite scroll settings page', 'Voice-controlled invoices',
  'Personalized 404 pages', 'Gamified standups', 'Export to PDF (again)',
  'Undo for sent emails', 'Self-serve enterprise tier', 'Confetti on deploy',
  'Keyboard shortcuts overlay', 'Multi-region avatars', 'Social login with MySpace',
  'Auto-generated release notes', 'Customer health score', 'Dashboard for dashboards',
];

export const BUGS = [
  'Checkout button invisible in Safari', 'Emoji picker crashes on ferret emoji',
  'Login loops forever on Tuesdays', 'Dark mode turns everything beige',
  'Invoice totals off by one cent', 'Search returns results from staging',
  'Avatars replaced with CEO photo', 'Notifications fire at 3am local time',
  'Scrollbar scrolls the wrong page', 'Timezone bug: meetings in 1970',
  'Password reset emails in Latin', 'Cart empties when you sneeze',
  'Tooltip covers the entire screen', 'Undo button redoes instead',
  'Profile page renders in Comic Sans', 'Export to PDF exports a JPEG',
];

export function instructionFor(
  control: { type: ControlType; label: string; options?: string[] },
  target: number,
): string {
  switch (control.type) {
    case 'toggle': return `Set ${control.label} to ${target === 1 ? 'ON' : 'OFF'}`;
    case 'slider': return `Set ${control.label} to ${target}`;
    case 'select': return `Switch ${control.label} to "${control.options![target]}"`;
    case 'button': return `Press ${control.label}`;
    default: return control.label;
  }
}

// Code review snippets live in shared/snippets.js — 1000 pre-computed,
// theme-matched to mission titles so the code always fits the task.


// ---------------------------------------------------------------------------
// Triage tickets — customer requests & bug reports that must be routed to the
// right priority. PMs get an instinct marker on the correct option.
// `answer` indexes TRIAGE_OPTIONS.
// ---------------------------------------------------------------------------

export const TRIAGE_OPTIONS = ['P0 · page on-call', 'P1 · this sprint', 'P2 · backlog', 'Close · not a bug'];

export const TRIAGE_TICKETS: TriageTicket[] = [
  { kind: 'bug', from: 'support', text: 'Checkout returns 500 for every user since the last deploy.', answer: 0, why: 'Full outage on the revenue path — that is a page.' },
  { kind: 'bug', from: 'support', text: 'Login button misaligned by 2px in Safari 16.', answer: 2, why: 'Cosmetic, one browser — backlog it.' },
  { kind: 'bug', from: 'support', text: "I can see another company's invoices in my dashboard.", answer: 0, why: 'Cross-tenant data leak is a security incident — page immediately.' },
  { kind: 'bug', from: 'support', text: 'Password reset email arrives after 15 minutes.', answer: 1, why: 'Blocks users but has a workaround (waiting) — fix this sprint.' },
  { kind: 'bug', from: 'support', text: 'Any file upload over 10MB crashes the app. Several customers blocked.', answer: 1, why: 'Real breakage for a common flow, but the app is otherwise up.' },
  { kind: 'bug', from: 'support', text: "Dark mode looks 'too dark' at night, says one user.", answer: 3, why: 'Working as designed — politely close it.' },
  { kind: 'bug', from: 'support', text: 'Site is slow from my hotel wifi. Everything else loads fine.', answer: 3, why: 'Environment issue on their side, not a product bug.' },
  { kind: 'bug', from: 'support', text: 'Invoice totals off by $0.01 on about 3% of invoices.', answer: 1, why: 'Money correctness matters — but it is not an outage.' },
  { kind: 'request', from: 'support', text: 'Enterprise customer (40% of revenue) blocked: SSO login broken since this morning.', answer: 0, why: 'Your biggest customer cannot log in at all — page it.' },
  { kind: 'request', from: 'support', text: 'Two users ask for CSV export of reports.', answer: 2, why: 'Nice-to-have with low demand — backlog.' },
  { kind: 'request', from: 'support', text: 'A customer demands we support Internet Explorer 11.', answer: 3, why: 'IE11 is dead. Close with kindness.' },
  { kind: 'request', from: 'support', text: "Trial user: 'the onboarding tour never finishes, I can't use the product at all.'", answer: 1, why: 'Blocks new-user activation — high priority, not a page.' },
  { kind: 'request', from: 'support', text: "Biggest customer's renewal is blocked on the audit-log feature promised last quarter.", answer: 1, why: 'Revenue-critical commitment — schedule it now; nothing is down.' },
  { kind: 'request', from: 'support', text: "Anonymous email: 'your API keys are visible in the page source.'", answer: 0, why: 'Credible security report — treat as an incident and page.' },
  { kind: 'bug', from: 'support', text: 'Two customers confirmed they were double-charged when a payment retried.', answer: 0, why: 'Actively taking people\'s money twice — page it now.' },
  { kind: 'bug', from: 'support', text: 'Exports time out for accounts with more than 10k rows. Three enterprise customers hit it daily.', answer: 1, why: 'Painful and recurring for paying customers — but nothing is down.' },
  { kind: 'request', from: 'support', text: 'One free-tier user wants Comic Sans as a font option.', answer: 3, why: 'No. (Politely.)' },
  { kind: 'request', from: 'support', text: 'Sales: tomorrow\'s demo for our biggest prospect needs the SSO flag enabled — it\'s built and tested.', answer: 1, why: 'Time-boxed revenue opportunity, zero outage — schedule it immediately.' },
];

// ---------------------------------------------------------------------------
// Design review missions — visual QA for the designer's eye. Three variants:
// shade (match the brand swatch exactly), centered (spot the dead-centered
// dot), radius (match a border radius). Options are generated server-side
// from these bases; designers get an instinct marker on the right one.
// ---------------------------------------------------------------------------

export const DESIGN_COLORS: DesignColor[] = [
  { name: 'brand indigo', h: 243, s: 75, l: 59 },
  { name: 'coral',        h: 9,   s: 85, l: 62 },
  { name: 'teal',         h: 172, s: 66, l: 40 },
  { name: 'amber',        h: 38,  s: 92, l: 50 },
  { name: 'rose',         h: 336, s: 78, l: 58 },
  { name: 'sky',          h: 199, s: 89, l: 48 },
  { name: 'lime',         h: 84,  s: 70, l: 45 },
  { name: 'violet',       h: 262, s: 72, l: 60 },
];

export const DESIGN_RADII = [2, 6, 10, 16, 24];

// ---------------------------------------------------------------------------
// Incident scenarios. These are *situations* the simulation creates; each has
// a recovery goal evaluated against live sim state, not a magic dial combo.
// `requires` gates on a service existing; `requiresControl` gates on a dial
// having been dealt to the team. `alert` is the vague pager line shown in
// realism mode instead of the diagnosis.
// ---------------------------------------------------------------------------

export const INCIDENTS: Record<IncidentKind, IncidentDef> = {
  outage: {
    shortLabel: 'Crash-loop outages',
    title: 'Backend pods crash-looping',
    desc: 'Pods are OOMKilled seconds after start. Healthy capacity just fell off a cliff.',
    goal: 'Restart the crashed pods and recover from the overload',
    hint: 'Press "Restart Backend Pods" — add replicas if you\'re still saturated.',
    alert: '5xx rate above SLO — no healthy backend endpoints behind the LB.',
    logs: [
      ['error', 'backend', 'pod backend-7f9c crashed: OOMKilled (exit 137)'],
      ['error', 'lb', 'upstream connect error: 503 no healthy endpoints'],
      ['warn', 'backend', 'container restart count: {n}'],
    ],
  },
  spike: {
    shortLabel: 'Traffic spikes',
    title: 'Traffic spike — we hit the front page',
    desc: 'A celebrity posted our 404 page. Traffic is 4x baseline and climbing.',
    goal: 'Get backend utilization back under 90%',
    hint: 'Scale Backend Replicas, flip the Autoscaler ON, or raise Cache TTL to shed load.',
    alert: 'Request rate 4× forecast — latency SLO at risk.',
    logs: [
      ['warn', 'lb', 'connection pool saturated ({n}% utilization)'],
      ['warn', 'backend', 'request queue depth {n}, shedding load'],
      ['info', 'cdn', 'cache MISS ratio climbing: {n}%'],
    ],
  },
  memleak: {
    shortLabel: 'Memory leaks',
    title: 'Memory leak after the last deploy',
    desc: 'RSS climbs every minute. GC pauses lengthen, throughput slowly decays.',
    goal: 'Restart the backend pods to reclaim memory',
    hint: 'Press "Restart Backend Pods" — a fresh boot resets the leak.',
    alert: 'p95 latency creeping upward — memory pressure warnings on backend.',
    logs: [
      ['warn', 'backend', 'heap RSS {n}MB and climbing'],
      ['warn', 'backend', 'GC major pause {n}ms'],
      ['error', 'backend', 'allocation failure — heap near limit'],
    ],
  },
  bad_deploy: {
    shortLabel: 'Bad deploys',
    title: 'Bad deploy in the canary',
    desc: 'Error rate doubled minutes after the 14:02 deploy. Stack traces point at the new build.',
    goal: 'Push a hotfix to roll back the bad build',
    hint: 'Press "Push a Hotfix" on the engineer console.',
    alert: 'Error budget burning 12× — errors correlate with the latest deploy.',
    requiresControl: 'hotfix',
    logs: [
      ['error', 'backend', "TypeError: cannot read properties of undefined (build 14.2.0)"],
      ['error', 'backend', '5xx on /api/checkout — release r{n}'],
      ['warn', 'lb', 'canary error rate {n}% vs 1% baseline'],
    ],
  },
  stampede: {
    shortLabel: 'Cache stampedes',
    title: 'Cache stampede',
    desc: 'A mass eviction sent every request straight to the database. Read latency is soaring.',
    goal: 'Rebuild cache warmth above 70%',
    hint: 'Raise Cache TTL so entries live long enough to rebuild the hit ratio. Do NOT flush.',
    alert: 'Database IOPS 3× baseline — cache hit ratio collapsed.',
    requires: 'cache',
    logs: [
      ['warn', 'cache', 'mass eviction: {n} keys expired simultaneously'],
      ['error', 'db', 'connection pool exhausted ({n} waiting)'],
      ['warn', 'db', 'read latency {n}ms — IOPS saturated'],
    ],
  },
  integration: {
    shortLabel: 'Integration failures',
    title: 'PaymentCo API is down',
    desc: 'Their status page says "operational". It is lying. Retries are piling up.',
    goal: 'Flip the circuit breaker to stop the retry storm',
    hint: 'Set Payments Circuit Breaker to ON — fail fast instead of queueing retries.',
    alert: 'Checkout conversion collapsed — third-party call timeouts spiking.',
    requires: 'payments',
    logs: [
      ['error', 'payments', 'POST /v2/charge timeout after 30000ms'],
      ['error', 'backend', 'PaymentGatewayError: ECONNRESET'],
      ['warn', 'backend', 'payment retry backlog: {n} pending'],
    ],
  },
  queue: {
    shortLabel: 'Queue backlogs',
    title: 'Queue backlog exploding',
    desc: 'A batch import dumped a mountain of jobs. Consumers are drowning.',
    goal: 'Drain the queue below 60 jobs',
    hint: 'Max out Queue Drain Rate. If payments are flaky too, the circuit breaker helps.',
    alert: 'Job queue oldest-message age above 10 minutes and rising.',
    requires: 'queue',
    logs: [
      ['warn', 'queue', 'backlog depth {n} (threshold: 200)'],
      ['error', 'queue', 'consumer group rebalancing failed'],
      ['warn', 'backend', 'enqueue latency {n}ms'],
    ],
  },
  ddos: {
    shortLabel: 'Bot floods',
    title: 'Bot flood at the edge',
    desc: 'A botnet is hammering the login endpoint with junk traffic from thousands of IPs.',
    goal: 'Raise Firewall Strictness to 6+ to shed the bot traffic',
    hint: 'Crank Firewall Strictness — real users can live with a captcha for a while.',
    alert: 'Request rate anomaly — 80% of traffic from unrecognized ASNs.',
    requiresControl: 'firewall',
    logs: [
      ['warn', 'lb', '{n} rps from ASN 64496 — traffic pattern anomaly'],
      ['error', 'backend', 'auth failures spiking: {n}/min'],
      ['warn', 'lb', 'connection table {n}% full'],
    ],
  },
  failover: {
    shortLabel: 'Regional failovers',
    title: 'Region outage',
    desc: 'The cloud provider tweeted an apology. Your primary region is gone.',
    goal: 'Fail DNS over to a healthy region, then ride out propagation',
    hint: 'Switch DNS Primary Record — expect ~8s of TTL propagation, and add replicas: the standby region is cold.',
    alert: 'Health checks failing region-wide — packet loss on primary.',
    logs: [
      ['error', 'dns', 'health check failing for primary record ({n}% packet loss)'],
      ['error', 'db', 'replica lag {n}s and climbing'],
      ['warn', 'lb', 'health checks failing in primary region: {n}%'],
    ],
  },
  data_loss: {
    shortLabel: 'DB corruption (DR drill)',
    title: 'Database corruption',
    desc: 'A bad migration tore through the orders table. Writes are failing integrity checks.',
    goal: 'Restore the database from backup (restore takes ~10s)',
    hint: 'Press "Restore DB from Backup". Your Backup Frequency dial decides how much data you lose.',
    alert: 'Write errors storming — database integrity checks failing.',
    logs: [
      ['error', 'db', 'integrity check failed: {n} pages corrupt'],
      ['error', 'backend', 'write failed: constraint violation storm'],
      ['warn', 'db', 'replica diverged — halting replication'],
    ],
  },
};

export const INCIDENT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(INCIDENTS).map(([k, def]) => [k, def.shortLabel]),
);

// ---------------------------------------------------------------------------
// Ambient logs / traces
// ---------------------------------------------------------------------------

export const AMBIENT_LOGS: LogTemplate[] = [
  ['info', 'backend', 'GET /api/products 200 {n}ms'],
  ['info', 'backend', 'POST /api/cart 201 {n}ms'],
  ['info', 'frontend', 'hydration complete in {n}ms'],
  ['info', 'db', 'checkpoint complete ({n} pages)'],
  ['info', 'backend', 'GET /api/me 200 {n}ms'],
  ['warn', 'backend', 'deprecated endpoint /v1/users called'],
  ['info', 'dns', 'zone transfer complete ({n} records)'],
];

export const SERVICE_LOGS: Record<string, LogTemplate[]> = {
  cdn: [['info', 'cdn', 'cache HIT /assets/app.js']],
  cache: [['info', 'cache', 'GET user:{n} hit (0.4ms)']],
  queue: [['info', 'queue', 'processed batch of {n} jobs']],
  payments: [['info', 'payments', 'webhook delivered ({n}ms)']],
  search: [['info', 'search', 'reindexed {n} documents']],
  analytics: [['info', 'analytics', 'flushed {n} events to warehouse']],
};

export const TRACE_ROUTES: { name: string; spans: string[] }[] = [
  { name: 'GET /checkout', spans: ['dns', 'lb', 'frontend', 'backend', 'payments', 'db'] },
  { name: 'GET /dashboard', spans: ['dns', 'lb', 'frontend', 'backend', 'db'] },
  { name: 'POST /api/cart', spans: ['lb', 'backend', 'cache', 'db'] },
  { name: 'POST /api/signup', spans: ['lb', 'backend', 'db', 'queue'] },
  { name: 'GET /api/search', spans: ['lb', 'backend', 'search'] },
];

// ---------------------------------------------------------------------------
// Chat bots
// ---------------------------------------------------------------------------

export const BOTS: Record<string, { name: string; icon: string }> = {
  ceo:     { name: 'ceo-dave',         icon: '💼' },
  support: { name: 'customer-support', icon: '🎧' },
  pager:   { name: 'pagerbot',         icon: '🚨' },
  system:  { name: 'dreambot',         icon: '🤖' },
};

export const CEO_SPRINT_LINES = [
  'New sprint! The board wants to see velocity. Whatever that is.',
  'Great news team — I promised this sprint\'s features to a journalist.',
  'I just read a blog post about 10x teams. You\'re at least a 4x. Prove me wrong!',
  'Competitor shipped something shiny. We ship shinier. Go.',
  'This sprint is make-or-break. Like the last one. And the next.',
];

export const CEO_INCIDENT_LINES = [
  'Why is the site down? I\'m in a board meeting. Asking for me.',
  'My mother-in-law says the site is broken. She is never wrong.',
  'Is this affecting revenue? Blink twice if yes.',
];

export const NAME_ADJECTIVES = [
  'agile', 'async', 'brave', 'caffeinated', 'cosmic', 'crunchy', 'deft',
  'dynamic', 'epic', 'fearless', 'gritty', 'heroic', 'hyper', 'legendary',
  'lucky', 'mighty', 'nimble', 'plucky', 'quantum', 'rapid', 'scrappy',
  'stellar', 'swift', 'turbo', 'vivid', 'zesty',
];

export const NAME_NOUNS = [
  'badger', 'comet', 'falcon', 'gecko', 'kraken', 'lemur', 'mantis',
  'narwhal', 'ocelot', 'otter', 'panda', 'phoenix', 'pixel', 'quokka',
  'raptor', 'rocket', 'sloth', 'sprocket', 'tapir', 'vector', 'walrus',
  'wombat', 'yak', 'zeppelin',
];
