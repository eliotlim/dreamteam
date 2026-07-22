// Game content: control definitions, task flavor, incidents, infra topology, bots.

export const ROLES = ['pm', 'designer', 'engineer', 'ops'];

export const ROLE_META = {
  pm:        { label: 'Product Manager', icon: '📋', color: '#c084fc' },
  designer:  { label: 'Designer',        icon: '🎨', color: '#f472b6' },
  engineer:  { label: 'Engineer',        icon: '⚙️', color: '#60a5fa' },
  ops:       { label: 'Ops / SRE',       icon: '🛰️', color: '#34d399' },
  spectator: { label: 'Spectator',       icon: '📺', color: '#94a3b8' },
};

// ---------------------------------------------------------------------------
// Controls
// type: toggle (OFF/ON) | slider (0..max) | select (options) | button (press)
// Critical controls are always dealt into the game because incidents need them.
// ---------------------------------------------------------------------------

export const CRITICAL_CONTROLS = [
  { key: 'autoscaler',      label: 'Autoscaler',           type: 'toggle', role: 'ops' },
  { key: 'circuit_breaker', label: 'Payments Circuit Breaker', type: 'toggle', role: 'ops' },
  { key: 'region',          label: 'Primary Region',       type: 'select', role: 'ops', options: ['us-east', 'eu-west', 'ap-south'] },
  { key: 'queue_drain',     label: 'Queue Drain Rate',     type: 'slider', role: 'ops', max: 8 },
  { key: 'restart_backend', label: 'Restart Backend Pods', type: 'button', role: 'ops' },
  { key: 'replicas',        label: 'Backend Replicas',     type: 'slider', role: 'engineer', max: 8 },
  { key: 'cache_ttl',       label: 'CDN Cache TTL',        type: 'slider', role: 'engineer', max: 8 },
];

export const CONTROL_POOL = [
  // PM
  { key: 'scope_creep',     label: 'Scope Creep Valve',      type: 'slider', role: 'pm', max: 8 },
  { key: 'stakeholders',    label: 'Stakeholder Alignment',  type: 'toggle', role: 'pm' },
  { key: 'okr_multiplier',  label: 'OKR Multiplier',         type: 'slider', role: 'pm', max: 8 },
  { key: 'roadmap',         label: 'Roadmap Horizon',        type: 'select', role: 'pm', options: ['this week', 'Q3', 'someday'] },
  { key: 'meeting_load',    label: 'Meeting Load',           type: 'slider', role: 'pm', max: 8 },
  { key: 'launch_hype',     label: 'Launch Hype Machine',    type: 'toggle', role: 'pm' },
  { key: 'sync_meeting',    label: 'Call a Sync Meeting',    type: 'button', role: 'pm' },
  { key: 'priority',        label: 'Priority Dial',          type: 'select', role: 'pm', options: ['P0', 'P1', 'P2', 'backlog'] },
  // Designer
  { key: 'border_radius',   label: 'Border Radius',          type: 'slider', role: 'designer', max: 8 },
  { key: 'dark_mode',       label: 'Dark Mode',              type: 'toggle', role: 'designer' },
  { key: 'hero_gradient',   label: 'Hero Gradient',          type: 'select', role: 'designer', options: ['sunset', 'ocean', 'cyberpunk', 'beige'] },
  { key: 'whitespace',      label: 'Whitespace Density',     type: 'slider', role: 'designer', max: 8 },
  { key: 'figma_sync',      label: 'Figma Sync',             type: 'toggle', role: 'designer' },
  { key: 'font_size',       label: 'Font Size',              type: 'slider', role: 'designer', max: 8 },
  { key: 'ship_redesign',   label: 'Ship the Redesign',      type: 'button', role: 'designer' },
  { key: 'brand_color',     label: 'Brand Color',            type: 'select', role: 'designer', options: ['coral', 'teal', 'slate', 'hotdog'] },
  // Engineer
  { key: 'flag_checkout',   label: 'Flag: checkout_v2',      type: 'toggle', role: 'engineer' },
  { key: 'flag_ai',         label: 'Flag: ai_assistant',     type: 'toggle', role: 'engineer' },
  { key: 'retry_backoff',   label: 'Retry Backoff',          type: 'slider', role: 'engineer', max: 8 },
  { key: 'deploy_target',   label: 'Deploy Target',          type: 'select', role: 'engineer', options: ['dev', 'staging', 'prod', 'yolo'] },
  { key: 'tech_debt',       label: 'Tech Debt Compactor',    type: 'button', role: 'engineer' },
  { key: 'log_level',       label: 'Log Verbosity',          type: 'select', role: 'engineer', options: ['error', 'warn', 'info', 'debug'] },
  { key: 'unit_tests',      label: 'Unit Tests',             type: 'toggle', role: 'engineer' },
  { key: 'hotfix',          label: 'Push a Hotfix',          type: 'button', role: 'engineer' },
  // Ops
  { key: 'chaos_monkey',    label: 'Chaos Monkey',           type: 'toggle', role: 'ops' },
  { key: 'backup_freq',     label: 'Backup Frequency',       type: 'slider', role: 'ops', max: 8 },
  { key: 'firewall',        label: 'Firewall Strictness',    type: 'slider', role: 'ops', max: 8 },
  { key: 'oncall',          label: 'On-call Rotation',       type: 'select', role: 'ops', options: ['alice', 'bob', 'the intern', 'nobody'] },
  { key: 'clear_cache',     label: 'Flush the Cache',        type: 'button', role: 'ops' },
  { key: 'vpn',             label: 'Office VPN',             type: 'toggle', role: 'ops' },
];

// ---------------------------------------------------------------------------
// Task flavor
// ---------------------------------------------------------------------------

export const FEATURES = [
  'AI-powered onboarding', 'Dark mode for the dark mode', 'One-click checkout',
  'Collaborative cursors', 'Emoji reactions everywhere', 'Blockchain loyalty points',
  'Infinite scroll settings page', 'Voice-controlled invoices', 'Personalized 404 pages',
  'Gamified standups', 'Export to PDF (again)', 'Realtime vibe dashboard',
  'Undo for sent emails', 'Smart notifications v3', 'Self-serve enterprise tier',
  'Confetti on deploy', 'Keyboard shortcuts overlay', 'Offline mode',
  'Multi-region avatars', 'Quantum search bar', 'Social login with MySpace',
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

// verb phrasing per control type
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
// Infrastructure topology (client draws this; server tracks status)
// ---------------------------------------------------------------------------

export const INFRA_NODES = [
  { id: 'cdn',      label: 'CDN' },
  { id: 'lb',       label: 'Load Balancer' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend',  label: 'Backend' },
  { id: 'db',       label: 'Database' },
  { id: 'cache',    label: 'Cache' },
  { id: 'queue',    label: 'Queue' },
  { id: 'payments', label: 'PaymentCo API' },
  { id: 'region',   label: 'Region' },
];

// ---------------------------------------------------------------------------
// Incidents. `needs` lists control requirements; resolved when all are met.
// `affects` marks infra nodes degraded/down. `metrics` applied per tick.
// ---------------------------------------------------------------------------

export const INCIDENTS = {
  outage: {
    title: 'Backend pods crash-looping',
    desc: 'OOMKilled. Again. Someone shipped a memory leak.',
    affects: { backend: 'down', lb: 'degraded' },
    needs: [
      { key: 'restart_backend', target: 1 },
      { key: 'replicas', target: 6 },
    ],
    metrics: { err: 28, p95: 320, rps: -30 },
    logs: [
      ['error', 'backend', 'pod backend-7f9c crashed: OOMKilled (exit 137)'],
      ['error', 'lb', 'upstream connect error: 503 no healthy endpoints'],
      ['warn', 'backend', 'container restart count: {n}'],
    ],
  },
  spike: {
    title: 'Traffic spike — we hit the front page',
    desc: 'A celebrity posted our 404 page. Traffic is 6x baseline.',
    affects: { lb: 'degraded', frontend: 'degraded', cache: 'degraded' },
    needs: [
      { key: 'autoscaler', target: 1 },
      { key: 'cache_ttl', target: 8 },
    ],
    metrics: { rps: 400, p95: 260, err: 6 },
    logs: [
      ['warn', 'lb', 'connection pool saturated ({n}% utilization)'],
      ['info', 'cdn', 'cache MISS ratio climbing: {n}%'],
      ['warn', 'frontend', 'render queue depth {n}'],
    ],
  },
  integration: {
    title: 'PaymentCo API is down',
    desc: 'Their status page says "operational". It is lying.',
    affects: { payments: 'down', backend: 'degraded' },
    needs: [
      { key: 'circuit_breaker', target: 1 },
    ],
    metrics: { err: 18, p95: 180 },
    logs: [
      ['error', 'payments', 'POST /v2/charge timeout after 30000ms'],
      ['error', 'backend', 'PaymentGatewayError: ECONNRESET'],
      ['warn', 'backend', 'payment retry queue growing: {n} pending'],
    ],
  },
  queue: {
    title: 'Queue backlog exploding',
    desc: 'The email worker died on Friday. It is now very much Monday.',
    affects: { queue: 'down', backend: 'degraded' },
    needs: [
      { key: 'queue_drain', target: 8 },
    ],
    metrics: { queue: 60, p95: 90 },
    logs: [
      ['warn', 'queue', 'backlog depth {n} (threshold: 1000)'],
      ['error', 'queue', 'consumer group rebalancing failed'],
      ['warn', 'backend', 'enqueue latency {n}ms'],
    ],
  },
  failover: {
    title: 'us-east region degraded',
    desc: 'The cloud provider tweeted an apology. Fail over. Now.',
    affects: { region: 'down', db: 'degraded' },
    needs: [
      { key: 'region', target: 1 }, // eu-west
    ],
    metrics: { err: 32, p95: 400 },
    logs: [
      ['error', 'region', 'us-east-1: elevated error rates (provider incident)'],
      ['error', 'db', 'replica lag {n}s and climbing'],
      ['warn', 'lb', 'health checks failing in us-east: {n}%'],
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
  ['info', 'cdn', 'cache HIT /assets/app.js'],
  ['info', 'db', 'checkpoint complete ({n} pages)'],
  ['info', 'queue', 'processed batch of {n} jobs'],
  ['warn', 'backend', 'deprecated endpoint /v1/users called'],
  ['info', 'backend', 'GET /api/me 200 {n}ms'],
  ['info', 'payments', 'webhook delivered ({n}ms)'],
];

export const TRACE_ROUTES = [
  { name: 'GET /checkout', spans: ['cdn', 'lb', 'frontend', 'backend', 'payments', 'db'] },
  { name: 'GET /dashboard', spans: ['cdn', 'lb', 'frontend', 'backend', 'db'] },
  { name: 'POST /api/cart', spans: ['lb', 'backend', 'cache', 'db'] },
  { name: 'POST /api/signup', spans: ['lb', 'backend', 'db', 'queue'] },
  { name: 'GET /api/search', spans: ['lb', 'backend', 'cache'] },
];

// ---------------------------------------------------------------------------
// Chat bots
// ---------------------------------------------------------------------------

export const BOTS = {
  ceo:     { name: 'ceo-dave',        icon: '💼' },
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
