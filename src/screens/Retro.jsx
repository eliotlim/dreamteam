import { useEffect, useState } from 'react';
import { Card, Button, Stat, ThemeToggle, SectionLabel, cx } from '../components/ui.jsx';
import { restartGame } from '../lib/net.js';
import { useStore } from '../lib/store.js';

// the little end-of-game moment: the score ticks up while sections rise in
function useCountUp(target, { duration = 1200, delay = 400 } = {}) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf;
    const t0 = performance.now() + delay;
    const step = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / duration));
      setV(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);
  return v;
}

// staggered entrance wrapper — everything stays scrollable underneath
function Rise({ delay, children }) {
  return <div className="animate-rise" style={{ animationDelay: `${delay}s` }}>{children}</div>;
}

const EV_META = {
  sprint:      { icon: '🏁', bar: 'bg-line-strong' },
  ship:        { icon: '🚀', bar: 'bg-accent' },
  deploy:      { icon: '🧩', bar: 'bg-accent/70' },
  fix:         { icon: '🐛', bar: 'bg-ok' },
  triage:      { icon: '📥', bar: 'bg-info' },
  missed:      { icon: '⏰', bar: 'bg-danger/40' },
  bug_shipped: { icon: '💥', bar: 'bg-danger' },
  crash:       { icon: '🔥', bar: 'bg-danger' },
  bad_deploy:  { icon: '🔥', bar: 'bg-danger' },
  incident:    { icon: '🚨', bar: 'bg-warn' },
  action:      { icon: '🛠️', bar: 'bg-ok/70' },
};

// The whole game as a Gantt: every notable event is a bar on a shared time
// axis, and events that caused other events nest under them (↳). Sprints
// render as section breaks.
function Gantt({ events }) {
  if (!events?.length) return null;
  const t0 = Math.min(...events.map((e) => e.ts));
  const t1 = Math.max(...events.map((e) => e.end ?? e.ts));
  const span = Math.max(1, t1 - t0);

  // roots in time order, each followed by its consequences (depth-first)
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const kids = {};
  const roots = [];
  for (const e of events) {
    if (e.cause && byId[e.cause]) (kids[e.cause] ??= []).push(e);
    else roots.push(e);
  }
  const rows = [];
  const walk = (e, depth) => {
    rows.push({ e, depth });
    for (const k of (kids[e.id] || []).sort((a, b) => a.ts - b.ts)) walk(k, depth + 1);
  };
  for (const r of roots.sort((a, b) => a.ts - b.ts)) walk(r, 0);

  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <SectionLabel>Cause &amp; effect — the whole game on one timeline</SectionLabel>
      <div className="space-y-0.5 max-h-[420px] overflow-y-auto pr-1">
        {rows.map(({ e, depth }) => {
          const m = EV_META[e.type] || { icon: '·', bar: 'bg-line-strong' };
          if (e.type === 'sprint') {
            return (
              <div key={e.id} className="flex items-center gap-2 pt-3 pb-1 first:pt-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-faint whitespace-nowrap">
                  {m.icon} {e.label}
                </span>
                <span className="flex-1 h-px bg-line" />
              </div>
            );
          }
          const left = ((e.ts - t0) / span) * 100;
          const width = Math.max((((e.end ?? e.ts) - e.ts) / span) * 100, 0.8);
          const dur = e.end ? Math.round((e.end - e.ts) / 1000) : null;
          // incidents that burned out get the angrier bar
          const bar = e.type === 'incident' && e.outcome === 'failed' ? 'bg-danger' : m.bar;
          return (
            <div key={e.id} className="flex items-center gap-2 text-[11px] leading-tight py-px">
              <span
                className={cx('w-40 sm:w-60 truncate shrink-0', depth > 0 && 'text-subtle')}
                style={{ paddingLeft: depth * 12 }}
                title={`${e.label}${e.actor ? ` — ${e.actor}` : ''}`}
              >
                {depth > 0 && <span className="text-faint">↳ </span>}
                {m.icon} {e.label}
              </span>
              <span className="relative flex-1 h-3.5 rounded bg-raised overflow-hidden">
                <span
                  className={cx('absolute top-0.5 bottom-0.5 rounded-sm', bar)}
                  style={{ left: `${Math.min(left, 99)}%`, width: `${Math.min(width, 100 - Math.min(left, 99))}%` }}
                />
              </span>
              <span className="w-8 text-right text-faint tabular-nums shrink-0">
                {dur != null ? `${dur}s` : ''}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-faint">
        ↳ nested rows were caused by the row above them — shipped bugs breed crashes, incidents breed heroics.
      </p>
    </Card>
  );
}

function Analysis({ items }) {
  if (!items?.length) return null;
  return (
    <Card className="p-4 sm:p-5 space-y-4">
      <SectionLabel>The engine read your game — failure-mode analysis</SectionLabel>
      {items.map((a, i) => (
        <div key={i} className="flex gap-3">
          <span className="text-xl leading-none pt-0.5">{a.icon}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-snug">{a.title}</div>
            <div className="text-xs text-subtle mt-0.5 leading-relaxed">{a.detail}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

export default function Retro() {
  const s = useStore();
  const g = s.g;
  const me = g.players[s.you];
  const st = g.stats;
  const score = useCountUp(g.score);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex justify-end p-4"><ThemeToggle /></header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl space-y-6">
          <Rise delay={0}>
          <div className="text-center space-y-2">
            <div className="text-6xl animate-pop">{g.victory ? '🏆' : '🪦'}</div>
            <h1 className="text-3xl font-bold">
              {g.victory ? 'You shipped it!' : 'The startup ran out of runway'}
            </h1>
            <p className="text-subtle">
              {g.victory
                ? `${g.config.sprintCount} sprint${g.config.sprintCount === 1 ? '' : 's'} survived. The roadmap is a smoking crater of success.`
                : 'Team health hit zero. The post-mortem will be blameless. Mostly.'}
            </p>
            <div className="text-5xl font-bold text-accent tabular-nums pt-2">{score}</div>
            <SectionLabel>final score</SectionLabel>
          </div>
          </Rise>

          <Rise delay={0.5}>
          <Card className="p-6 space-y-5">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-center">
              <Stat label="Shipped" value={st.shipped} tone="accent" />
              <Stat label="Bugs fixed" value={st.bugsFixed} tone="ok" />
              <Stat label="Triaged" value={st.triaged ?? 0} tone="info" />
              <Stat label="Incidents" value={st.incidentsResolved} tone="warn" />
              <Stat label="Bugs to prod" value={st.bugsShipped ?? 0} tone="danger" />
              <Stat label="Missed" value={st.missed} tone="danger" />
            </div>

            {st.sprints?.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-faint text-[11px] uppercase tracking-wider">
                    <th className="text-left font-semibold py-1">Sprint</th>
                    <th className="text-right font-semibold">Shipped</th>
                    <th className="text-right font-semibold">Bugs</th>
                    <th className="text-right font-semibold">Triaged</th>
                    <th className="text-right font-semibold">Incidents</th>
                    <th className="text-right font-semibold">Points</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {st.sprints.map((sp) => (
                    <tr key={sp.sprint} className="border-t border-line">
                      <td className="py-1.5">Sprint {sp.sprint}</td>
                      <td className="text-right">{sp.shipped}</td>
                      <td className="text-right">{sp.bugsFixed}</td>
                      <td className="text-right">{sp.triaged ?? 0}</td>
                      <td className="text-right">{sp.incidentsResolved}</td>
                      <td className="text-right font-semibold text-accent">+{sp.scoreDelta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          </Rise>

          <Rise delay={1.0}><Analysis items={g.analysis} /></Rise>
          <Rise delay={1.4}><Gantt events={g.events} /></Rise>

          <Rise delay={1.7}>
          {me?.isHost ? (
            <Button size="lg" className="w-full" onClick={restartGame}>
              Back to lobby — run it back
            </Button>
          ) : (
            <p className="text-center text-subtle text-sm">Waiting for the host to restart…</p>
          )}
          </Rise>
        </div>
      </main>
    </div>
  );
}
