// Game content: services, controls, task flavor, incident scenarios, bots.

export const ROLES = ['pm', 'designer', 'engineer', 'ops'];

export const ROLE_META = {
  pm:        { label: 'Product Manager', icon: '📋', color: '#c084fc' },
  designer:  { label: 'Designer',        icon: '🎨', color: '#f472b6' },
  engineer:  { label: 'Engineer',        icon: '⚙️', color: '#60a5fa' },
  ops:       { label: 'Ops / SRE',       icon: '🛰️', color: '#34d399' },
  spectator: { label: 'Spectator',       icon: '📺', color: '#94a3b8' },
};

export const REGIONS = ['us-east', 'eu-west', 'ap-south'];

// ---------------------------------------------------------------------------
// Services. `core` services always exist; others start per difficulty or get
// unlocked when the matching epic feature ships ("customer feature requests").
// `tier` drives the diagram layout (left → right).
// ---------------------------------------------------------------------------

export const SERVICES = {
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

export const SERVICE_EDGES = [
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
// Backend replicas can never go to zero — min is 1.
// ---------------------------------------------------------------------------

export const CRITICAL_CONTROLS = [
  { key: 'autoscaler',      label: 'Autoscaler',               type: 'toggle', role: 'ops' },
  { key: 'circuit_breaker', label: 'Payments Circuit Breaker', type: 'toggle', role: 'ops' },
  { key: 'dns_primary',     label: 'DNS Primary Record',       type: 'select', role: 'ops', options: REGIONS },
  { key: 'queue_drain',     label: 'Queue Drain Rate',         type: 'slider', role: 'ops', min: 0, max: 8 },
  { key: 'restart_backend', label: 'Restart Backend Pods',     type: 'button', role: 'ops' },
  { key: 'replicas',        label: 'Backend Replicas',         type: 'slider', role: 'engineer', min: 1, max: 8 },
  { key: 'cache_ttl',       label: 'Cache TTL',                type: 'slider', role: 'engineer', min: 0, max: 8 },
];

export const CONTROL_POOL = [
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
  .filter(([, s]) => s.unlockFeature)
  .map(([id, s]) => ({ title: s.unlockFeature, service: id }));

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

export function instructionFor(control, target) {
  switch (control.type) {
    case 'toggle': return `Set ${control.label} to ${target === 1 ? 'ON' : 'OFF'}`;
    case 'slider': return `Set ${control.label} to ${target}`;
    case 'select': return `Switch ${control.label} to "${control.options[target]}"`;
    case 'button': return `Press ${control.label}`;
    default: return control.label;
  }
}

// ---------------------------------------------------------------------------
// Incident scenarios. These are *situations* the simulation creates; each has
// a recovery goal evaluated against live sim state, not a magic dial combo.
// `requires` gates the scenario on a service existing.
// ---------------------------------------------------------------------------

export const INCIDENTS = {
  outage: {
    title: 'Backend pods crash-looping',
    desc: 'OOMKilled. Again. Capacity just fell off a cliff.',
    goal: 'Restart the crashed pods and recover from the overload',
    hint: 'Press "Restart Backend Pods" — add replicas if you\'re still saturated.',
    logs: [
      ['error', 'backend', 'pod backend-7f9c crashed: OOMKilled (exit 137)'],
      ['error', 'lb', 'upstream connect error: 503 no healthy endpoints'],
      ['warn', 'backend', 'container restart count: {n}'],
    ],
  },
  spike: {
    title: 'Traffic spike — we hit the front page',
    desc: 'A celebrity posted our 404 page. Traffic is 4x baseline and climbing.',
    goal: 'Get backend utilization back under 90%',
    hint: 'Scale Backend Replicas, flip the Autoscaler ON, or raise Cache TTL to shed load.',
    logs: [
      ['warn', 'lb', 'connection pool saturated ({n}% utilization)'],
      ['warn', 'backend', 'request queue depth {n}, shedding load'],
      ['info', 'cdn', 'cache MISS ratio climbing: {n}%'],
    ],
  },
  integration: {
    title: 'PaymentCo API is down',
    desc: 'Their status page says "operational". It is lying. Retries are piling up.',
    goal: 'Flip the circuit breaker to stop the retry storm',
    hint: 'Set Payments Circuit Breaker to ON — fail fast instead of queueing retries.',
    requires: 'payments',
    logs: [
      ['error', 'payments', 'POST /v2/charge timeout after 30000ms'],
      ['error', 'backend', 'PaymentGatewayError: ECONNRESET'],
      ['warn', 'backend', 'payment retry backlog: {n} pending'],
    ],
  },
  queue: {
    title: 'Queue backlog exploding',
    desc: 'A batch import dumped a mountain of jobs. Consumers are drowning.',
    goal: 'Drain the queue below 60 jobs',
    hint: 'Max out Queue Drain Rate. If payments are flaky too, the circuit breaker helps.',
    requires: 'queue',
    logs: [
      ['warn', 'queue', 'backlog depth {n} (threshold: 200)'],
      ['error', 'queue', 'consumer group rebalancing failed'],
      ['warn', 'backend', 'enqueue latency {n}ms'],
    ],
  },
  failover: {
    title: 'Region outage',
    desc: 'The cloud provider tweeted an apology. Your primary region is gone.',
    goal: 'Update the DNS records to point at a healthy region',
    hint: 'Switch DNS Primary Record to any other region.',
    logs: [
      ['error', 'dns', 'health check failing for primary record ({n}% packet loss)'],
      ['error', 'db', 'replica lag {n}s and climbing'],
      ['warn', 'lb', 'health checks failing in primary region: {n}%'],
    ],
  },
};

// ---------------------------------------------------------------------------
// Ambient logs / traces
// ---------------------------------------------------------------------------

export const AMBIENT_LOGS = [
  ['info', 'backend', 'GET /api/products 200 {n}ms'],
  ['info', 'backend', 'POST /api/cart 201 {n}ms'],
  ['info', 'frontend', 'hydration complete in {n}ms'],
  ['info', 'db', 'checkpoint complete ({n} pages)'],
  ['info', 'backend', 'GET /api/me 200 {n}ms'],
  ['warn', 'backend', 'deprecated endpoint /v1/users called'],
  ['info', 'dns', 'zone transfer complete ({n} records)'],
];

export const SERVICE_LOGS = {
  cdn: [['info', 'cdn', 'cache HIT /assets/app.js']],
  cache: [['info', 'cache', 'GET user:{n} hit (0.4ms)']],
  queue: [['info', 'queue', 'processed batch of {n} jobs']],
  payments: [['info', 'payments', 'webhook delivered ({n}ms)']],
  search: [['info', 'search', 'reindexed {n} documents']],
  analytics: [['info', 'analytics', 'flushed {n} events to warehouse']],
};

export const TRACE_ROUTES = [
  { name: 'GET /checkout', spans: ['dns', 'lb', 'frontend', 'backend', 'payments', 'db'] },
  { name: 'GET /dashboard', spans: ['dns', 'lb', 'frontend', 'backend', 'db'] },
  { name: 'POST /api/cart', spans: ['lb', 'backend', 'cache', 'db'] },
  { name: 'POST /api/signup', spans: ['lb', 'backend', 'db', 'queue'] },
  { name: 'GET /api/search', spans: ['lb', 'backend', 'search'] },
];

// ---------------------------------------------------------------------------
// Chat bots
// ---------------------------------------------------------------------------

export const BOTS = {
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
