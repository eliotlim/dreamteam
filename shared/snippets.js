// 1000 pre-computed find-the-bug code snippets, themed per mission title so
// the code on the card always matches the task description ("Fix: Invoice
// totals off by one cent" shows invoice code, not somebody's cart loop).
//
// Snippets are expanded deterministically at module load from
// (theme × pattern × variant) combos — same order every boot, so persisted
// `usedSnippets` ids stay valid across restarts. Each snippet carries `fix`,
// the corrected line, so the server can render the patch (or pre-apply it to
// deal a clean snippet).

// ---------------------------------------------------------------------------
// Themes — one per mission title in FEATURES / BUGS / epic unlock features.
// Vocab: noun/nouns are prose, item/arr/field are identifiers.
// ---------------------------------------------------------------------------

const THEMES = [
  // features
  { title: 'AI-powered onboarding',            file: 'onboarding.js',     noun: 'onboarding step',   nouns: 'onboarding steps',   item: 'step',         arr: 'steps',         field: 'duration' },
  { title: 'Dark mode for the dark mode',      file: 'theme.js',          noun: 'theme token',       nouns: 'theme tokens',       item: 'token',        arr: 'tokens',        field: 'contrast' },
  { title: 'Collaborative cursors',            file: 'cursors.js',        noun: 'cursor',            nouns: 'cursors',            item: 'cursor',       arr: 'cursors',       field: 'lag' },
  { title: 'Emoji reactions everywhere',       file: 'reactions.js',      noun: 'reaction',          nouns: 'reactions',          item: 'reaction',     arr: 'reactions',     field: 'count' },
  { title: 'Infinite scroll settings page',    file: 'settings-scroll.js', noun: 'settings row',     nouns: 'settings rows',      item: 'row',          arr: 'rows',          field: 'height' },
  { title: 'Voice-controlled invoices',        file: 'voice-invoices.js', noun: 'voice command',     nouns: 'voice commands',     item: 'command',      arr: 'commands',      field: 'confidence' },
  { title: 'Personalized 404 pages',           file: 'not-found.js',      noun: 'page suggestion',   nouns: 'page suggestions',   item: 'suggestion',   arr: 'suggestions',   field: 'score' },
  { title: 'Gamified standups',                file: 'standups.js',       noun: 'standup entry',     nouns: 'standup entries',    item: 'entry',        arr: 'entries',       field: 'streak' },
  { title: 'Export to PDF (again)',            file: 'pdf-export.js',     noun: 'export page',       nouns: 'export pages',       item: 'page',         arr: 'pages',         field: 'sizeKb' },
  { title: 'Undo for sent emails',             file: 'undo-email.js',     noun: 'queued email',      nouns: 'queued emails',      item: 'email',        arr: 'outbox',        field: 'delay' },
  { title: 'Self-serve enterprise tier',       file: 'enterprise.js',     noun: 'seat',              nouns: 'seats',              item: 'seat',         arr: 'seats',         field: 'price' },
  { title: 'Confetti on deploy',               file: 'confetti.js',       noun: 'confetti burst',    nouns: 'confetti bursts',    item: 'burst',        arr: 'bursts',        field: 'particles' },
  { title: 'Keyboard shortcuts overlay',       file: 'shortcuts.js',      noun: 'shortcut',          nouns: 'shortcuts',          item: 'shortcut',     arr: 'shortcuts',     field: 'uses' },
  { title: 'Multi-region avatars',             file: 'avatars.js',        noun: 'avatar',            nouns: 'avatars',            item: 'avatar',       arr: 'avatars',       field: 'sizeKb' },
  { title: 'Social login with MySpace',        file: 'myspace-auth.js',   noun: 'login attempt',     nouns: 'login attempts',     item: 'attempt',      arr: 'attempts',      field: 'age' },
  { title: 'Auto-generated release notes',     file: 'release-notes.js',  noun: 'commit',            nouns: 'commits',            item: 'commit',       arr: 'commits',       field: 'additions' },
  { title: 'Customer health score',            file: 'health-score.js',   noun: 'usage signal',      nouns: 'usage signals',      item: 'signal',       arr: 'signals',       field: 'weight' },
  { title: 'Dashboard for dashboards',         file: 'meta-dashboard.js', noun: 'dashboard',         nouns: 'dashboards',         item: 'dashboard',    arr: 'dashboards',    field: 'views' },
  // bugs
  { title: 'Checkout button invisible in Safari', file: 'checkout-ui.js', noun: 'style rule',        nouns: 'style rules',        item: 'rule',         arr: 'rules',         field: 'opacity' },
  { title: 'Emoji picker crashes on ferret emoji', file: 'emoji-picker.js', noun: 'emoji',           nouns: 'emojis',             item: 'emoji',        arr: 'emojis',        field: 'codepoint' },
  { title: 'Login loops forever on Tuesdays',  file: 'login.js',          noun: 'session',           nouns: 'sessions',           item: 'session',      arr: 'sessions',      field: 'ttl' },
  { title: 'Dark mode turns everything beige', file: 'palette.js',        noun: 'color token',       nouns: 'color tokens',       item: 'color',        arr: 'colors',        field: 'lightness' },
  { title: 'Invoice totals off by one cent',   file: 'invoice.js',        noun: 'line item',         nouns: 'line items',         item: 'line',         arr: 'lineItems',     field: 'cents' },
  { title: 'Search returns results from staging', file: 'search-env.js',  noun: 'search result',     nouns: 'search results',     item: 'result',       arr: 'results',       field: 'rank' },
  { title: 'Avatars replaced with CEO photo',  file: 'avatar-cache.js',   noun: 'cached avatar',     nouns: 'cached avatars',     item: 'avatar',       arr: 'avatars',       field: 'hits' },
  { title: 'Notifications fire at 3am local time', file: 'notify-schedule.js', noun: 'notification', nouns: 'notifications',      item: 'notification', arr: 'notifications', field: 'hour' },
  { title: 'Scrollbar scrolls the wrong page', file: 'scroll-sync.js',    noun: 'scroll pane',       nouns: 'scroll panes',       item: 'pane',         arr: 'panes',         field: 'offset' },
  { title: 'Timezone bug: meetings in 1970',   file: 'meeting-times.js',  noun: 'meeting',           nouns: 'meetings',           item: 'meeting',      arr: 'meetings',      field: 'minutes' },
  { title: 'Password reset emails in Latin',   file: 'reset-locale.js',   noun: 'translation',       nouns: 'translations',       item: 'translation',  arr: 'translations',  field: 'coverage' },
  { title: 'Cart empties when you sneeze',     file: 'cart-persist.js',   noun: 'cart item',         nouns: 'cart items',         item: 'item',         arr: 'items',         field: 'qty' },
  { title: 'Tooltip covers the entire screen', file: 'tooltip.js',        noun: 'tooltip',           nouns: 'tooltips',           item: 'tip',          arr: 'tips',          field: 'width' },
  { title: 'Undo button redoes instead',       file: 'undo-stack.js',     noun: 'history entry',     nouns: 'history entries',    item: 'entry',        arr: 'history',       field: 'changes' },
  { title: 'Profile page renders in Comic Sans', file: 'font-loader.js',  noun: 'font',              nouns: 'fonts',              item: 'font',         arr: 'fonts',         field: 'weight' },
  { title: 'Export to PDF exports a JPEG',     file: 'export-format.js',  noun: 'export job',        nouns: 'export jobs',        item: 'job',          arr: 'jobs',          field: 'dpi' },
  // epic features (unlock services)
  { title: 'Offline mode',                     file: 'offline-cache.js',  noun: 'cached asset',      nouns: 'cached assets',      item: 'asset',        arr: 'assets',        field: 'bytes' },
  { title: 'Blazing-fast dashboards',          file: 'dash-cache.js',     noun: 'cache entry',       nouns: 'cache entries',      item: 'entry',        arr: 'entries',       field: 'ttl' },
  { title: 'Smart notifications v3',           file: 'notify-queue.js',   noun: 'notification job',  nouns: 'notification jobs',  item: 'job',          arr: 'jobs',          field: 'attempts' },
  { title: 'One-click checkout',               file: 'checkout.js',       noun: 'charge',            nouns: 'charges',            item: 'charge',       arr: 'charges',       field: 'amount' },
  { title: 'Quantum search bar',               file: 'search-index.js',   noun: 'document',          nouns: 'documents',          item: 'doc',          arr: 'docs',          field: 'score' },
  { title: 'Realtime vibe dashboard',          file: 'vibe-events.js',    noun: 'vibe event',        nouns: 'vibe events',        item: 'event',        arr: 'events',        field: 'intensity' },
];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Patterns — classic real-world bug shapes, parameterized by theme vocab.
// Each returns { lines, bug, why, fix } (bug = 0-based index, fix = the
// corrected line). Two variants per pattern.
// ---------------------------------------------------------------------------

const PATTERNS = [
  {
    id: 'sum',
    vs: [{ skip: 'last' }, { skip: 'first' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: total ${t.field} across all ${t.nouns}`,
        `function total${cap(t.field)}(${t.arr}) {`,
        '  let total = 0;',
        v.skip === 'last'
          ? `  for (let i = 0; i < ${t.arr}.length - 1; i++) {`
          : `  for (let i = 1; i < ${t.arr}.length; i++) {`,
        `    total += ${t.arr}[i].${t.field};`,
        '  }',
        '  return total;',
        '}',
      ],
      bug: 3,
      why: v.skip === 'last'
        ? `The loop stops one early — the last ${t.noun} is never counted.`
        : `The loop starts at 1 — the first ${t.noun} is never counted.`,
      fix: `  for (let i = 0; i < ${t.arr}.length; i++) {`,
    }),
  },
  {
    id: 'sort',
    vs: [{ by: 'newest' }, { by: 'top' }],
    gen: (t, v) => {
      const field = v.by === 'newest' ? 'ts' : t.field;
      return {
        lines: [
          v.by === 'newest'
            ? `// ${t.title}: newest ${t.nouns} first`
            : `// ${t.title}: highest-${t.field} ${t.nouns} first`,
          `function top${cap(t.arr)}(${t.arr}, n) {`,
          `  return ${t.arr}`,
          `    .sort((a, b) => a.${field} - b.${field})`,
          '    .slice(0, n);',
          '}',
        ],
        bug: 3,
        why: `a.${field} - b.${field} sorts ascending — this returns the ${v.by === 'newest' ? 'oldest' : 'lowest'} ${t.nouns} instead.`,
        fix: `    .sort((a, b) => b.${field} - a.${field})`,
      };
    },
  },
  {
    id: 'limit',
    vs: [{ scope: 'user', n: 5 }, { scope: 'minute', n: 3 }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: allow at most ${v.n} ${t.nouns} per ${v.scope}`,
        'function allow(bucket) {',
        '  bucket.count += 1;',
        `  return bucket.count < ${v.n};`,
        '}',
      ],
      bug: 3,
      why: `< rejects the ${v.n}th ${t.noun} — "at most ${v.n}" needs <=.`,
      fix: `  return bucket.count <= ${v.n};`,
    }),
  },
  {
    id: 'await',
    vs: [{ n: 3 }, { n: 5 }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: fetch ${t.nouns} with up to ${v.n} retries`,
        `async function load${cap(t.arr)}() {`,
        `  for (let i = 0; i < ${v.n}; i++) {`,
        `    const res = fetch('/api/${t.arr}');`,
        '    if (res.ok) return res.json();',
        '  }',
        `  throw new Error('${t.arr} unavailable');`,
        '}',
      ],
      bug: 3,
      why: 'Missing await — res is a Promise, so res.ok is always undefined and every attempt "fails".',
      fix: `    const res = await fetch('/api/${t.arr}');`,
    }),
  },
  {
    id: 'ms',
    vs: [{ n: 5 }, { n: 30 }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: dismiss the ${t.noun} after ${v.n} seconds`,
        `function show(${t.item}) {`,
        `  ${t.item}.visible = true;`,
        `  setTimeout(() => hide(${t.item}), ${v.n});`,
        '}',
      ],
      bug: 3,
      why: `setTimeout takes milliseconds — ${v.n} hides it after ${v.n}ms, not ${v.n}s.`,
      fix: `  setTimeout(() => hide(${t.item}), ${v.n} * 1000);`,
    }),
  },
  {
    id: 'null',
    vs: [{ style: 'ret' }, { style: 'if' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: look up a ${t.noun} by id`,
        `function get${cap(t.item)}(${t.arr}, id) {`,
        `  const found = ${t.arr}.find((e) => e.id === id);`,
        v.style === 'ret'
          ? `  return found.${t.field};`
          : `  if (found.${t.field} > 0) return found;`,
        v.style === 'ret' ? '}' : '  return null;',
        ...(v.style === 'ret' ? [] : ['}']),
      ],
      bug: 3,
      why: `find() returns undefined for unknown ids — reading .${t.field} then crashes.`,
      fix: v.style === 'ret'
        ? `  return found ? found.${t.field} : null;`
        : `  if (found && found.${t.field} > 0) return found;`,
    }),
  },
  {
    id: 'page',
    vs: [{ size: 20 }, { size: 50 }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: page p (1-based) of ${v.size} ${t.nouns}`,
        `function page(${t.arr}, p) {`,
        `  const start = p * ${v.size};`,
        `  return ${t.arr}.slice(start, start + ${v.size});`,
        '}',
      ],
      bug: 2,
      why: `Page 1 should start at 0 — this skips the first ${v.size} ${t.nouns}.`,
      fix: `  const start = (p - 1) * ${v.size};`,
    }),
  },
  {
    id: 'prefix',
    vs: [{ store: 'cache' }, { store: 'store' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: clear one user's ${t.nouns}`,
        `function evict(${v.store}, userId) {`,
        `  for (const key of ${v.store}.keys()) {`,
        `    if (key.startsWith('${t.item}:')) ${v.store}.delete(key);`,
        '  }',
        '}',
      ],
      bug: 3,
      why: `That prefix matches EVERY user's ${t.nouns} — the userId never makes it into the key.`,
      fix: '    if (key.startsWith(`' + t.item + ':${userId}:`)) ' + v.store + '.delete(key);',
    }),
  },
  {
    id: 'rollout',
    vs: [{ pct: 10 }, { pct: 20 }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: roll out to ${v.pct}% of users`,
        'function inRollout(userId) {',
        `  return hash(userId) % 100 <= ${v.pct};`,
        '}',
      ],
      bug: 2,
      why: `<= ${v.pct} matches ${v.pct + 1} buckets (0–${v.pct}) — that's a ${v.pct + 1}% rollout.`,
      fix: `  return hash(userId) % 100 < ${v.pct};`,
    }),
  },
  {
    id: 'and',
    vs: [{ a: 'reviewed', b: 'approved' }, { a: 'saved', b: 'synced' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: a ${t.noun} ships only if ${v.a} AND ${v.b}`,
        `function ready(${t.item}) {`,
        `  return ${t.item}.${v.a} || ${t.item}.${v.b};`,
        '}',
      ],
      bug: 2,
      why: `|| lets a ${t.noun} through with only one of the two checks — needs &&.`,
      fix: `  return ${t.item}.${v.a} && ${t.item}.${v.b};`,
    }),
  },
  {
    id: 'reset',
    vs: [{ wrong: 'value' }, { wrong: 'interval' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: reset the ${t.noun} counter every minute`,
        'function trackRate(state) {',
        '  state.count = 0;',
        '  setInterval(() => {',
        v.wrong === 'value' ? '    state.count = 1;' : '    state.count = 0;',
        v.wrong === 'interval' ? '  }, 600000);' : '  }, 60000);',
        '}',
      ],
      bug: v.wrong === 'value' ? 4 : 5,
      why: v.wrong === 'value'
        ? `The window resets the counter to 1, not 0 — every ${t.noun} is overcounted.`
        : 'That interval is 600000ms — the "minute" window actually lasts ten minutes.',
      fix: v.wrong === 'value' ? '    state.count = 0;' : '  }, 60000);',
    }),
  },
  {
    id: 'slice',
    vs: [{ n: 5 }, { n: 10 }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: keep only the last ${v.n} ${t.nouns}`,
        `function recent(${t.arr}) {`,
        `  return ${t.arr}.slice(-${v.n + 1});`,
        '}',
      ],
      bug: 2,
      why: `slice(-${v.n + 1}) keeps ${v.n + 1} ${t.nouns}, not ${v.n}.`,
      fix: `  return ${t.arr}.slice(-${v.n});`,
    }),
  },
  {
    id: 'fifo',
    vs: [{ q: 'queue' }, { q: 'backlog' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: process ${t.nouns} first-in, first-out`,
        `function next${cap(t.item)}(${v.q}) {`,
        `  return ${v.q}.pop();`,
        '}',
      ],
      bug: 2,
      why: `pop() takes the newest ${t.noun} (LIFO) — FIFO needs shift().`,
      fix: `  return ${v.q}.shift();`,
    }),
  },
  {
    id: 'epoch',
    vs: [{ fn: 'toDate' }, { fn: 'parseWhen' }],
    gen: (t, v) => ({
      lines: [
        `// ${t.title}: the API sends ${t.noun} timestamps in seconds`,
        `function ${v.fn}(secs) {`,
        '  return new Date(secs);',
        '}',
      ],
      bug: 2,
      why: 'Date() wants milliseconds — seconds land you in January 1970.',
      fix: '  return new Date(secs * 1000);',
    }),
  },
];

// ---------------------------------------------------------------------------
// Expansion: per theme, rotate the (pattern × variant) deck by theme index and
// deal PER_THEME snippets → exactly THEMES.length × PER_THEME snippets.
// ---------------------------------------------------------------------------

const PER_THEME = 25;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function build() {
  const all = [];
  const byTitle = {};
  const combos = PATTERNS.flatMap((p) => p.vs.map((v, vi) => ({ p, v, vi })));
  THEMES.forEach((t, ti) => {
    const deck = combos.map((_, i) => combos[(i + ti) % combos.length]).slice(0, PER_THEME);
    const mine = deck.map(({ p, v, vi }) => {
      const s = p.gen(t, v);
      return { id: `${slug(t.title)}~${p.id}${vi}`, title: t.title, name: t.file, ...s };
    });
    byTitle[t.title] = mine;
    all.push(...mine);
  });
  return { all, byTitle };
}

const { all: CODE_SNIPPETS, byTitle: SNIPPETS_BY_TITLE } = build();

export { CODE_SNIPPETS, SNIPPETS_BY_TITLE };
