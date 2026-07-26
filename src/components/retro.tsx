import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AnalysisItem, GameEvent, SprintStats } from '../../shared/types.ts';
import { Card, SectionLabel, cx } from './ui.tsx';

// Shared retro building blocks — used by the between-sprint retro overlay
// (Game.tsx) and the end-of-game retro screen (Retro.tsx).

// the little end-of-game moment: the score ticks up while sections rise in
export function useCountUp(target: number, { duration = 1200, delay = 400 } = {}) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf: number;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
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
export function Rise({ delay, children }: { delay: number; children?: ReactNode }) {
  return <div className="animate-rise" style={{ animationDelay: `${delay}s` }}>{children}</div>;
}

export const EV_META: Record<string, { icon: string; bar: string }> = {
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
  wrong:       { icon: '❌', bar: 'bg-danger/40' },
  escalation:  { icon: '📟', bar: 'bg-warn' },
  fester:      { icon: '🦠', bar: 'bg-danger/70' },
};

// The game as a Gantt: every notable event is a bar on a shared time axis,
// and events that caused other events nest under them (↳). Sprints render
// as section breaks.
export function Gantt({ events, title }: { events: GameEvent[] | null; title?: string }) {
  if (!events?.length) return null;
  const t0 = Math.min(...events.map((e) => e.ts));
  const t1 = Math.max(...events.map((e) => e.end ?? e.ts));
  const span = Math.max(1, t1 - t0);

  // roots in time order, each followed by its consequences (depth-first)
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const kids: Record<string, GameEvent[]> = {};
  const roots: GameEvent[] = [];
  for (const e of events) {
    if (e.cause && byId[e.cause]) (kids[e.cause] ??= []).push(e);
    else roots.push(e);
  }
  const rows: { e: GameEvent; depth: number }[] = [];
  const walk = (e: GameEvent, depth: number) => {
    // lone wrong-taps are noise — they only earn a row when they caused
    // something (the analysis section carries the aggregate count)
    if (e.type === 'wrong' && !kids[e.id]?.length) return;
    rows.push({ e, depth });
    for (const k of (kids[e.id] || []).sort((a, b) => a.ts - b.ts)) walk(k, depth + 1);
  };
  for (const r of roots.sort((a, b) => a.ts - b.ts)) walk(r, 0);

  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <SectionLabel>{title ?? 'Cause & effect — the whole game on one timeline'}</SectionLabel>
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
        ↳ nested rows were caused by the row above them — shipped bugs breed crashes, missed fixes fester, mis-routed P0s summon incidents.
      </p>
    </Card>
  );
}

export function Analysis({ items }: { items: AnalysisItem[] | null }) {
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

// ---------------------------------------------------------------- grades

export interface Grade { grade: string; tone: string; quip: string }

// A sprint report card: wins vs self-inflicted wounds. Purely cosmetic —
// but an S makes a team scream, and that's the point.
export function sprintGrade(st: Partial<SprintStats>): Grade {
  const good = (st.shipped ?? 0) + (st.bugsFixed ?? 0) + (st.triaged ?? 0) + (st.incidentsResolved ?? 0);
  const bad = (st.missed ?? 0) + (st.bugsShipped ?? 0) * 2 + (st.wrongGuesses ?? 0) * 0.5;
  const ratio = good + bad > 0 ? good / (good + bad) : 1;
  if (bad === 0 && good >= 5) return { grade: 'S', tone: 'text-accent', quip: 'Flawless. Frame this sprint.' };
  if (ratio >= 0.85) return { grade: 'A', tone: 'text-ok', quip: 'Sharp. The board is thrilled.' };
  if (ratio >= 0.65) return { grade: 'B', tone: 'text-info', quip: 'Solid — a few scars, all survivable.' };
  if (ratio >= 0.45) return { grade: 'C', tone: 'text-warn', quip: 'Shipped, barely. Read the timeline below.' };
  return { grade: 'D', tone: 'text-danger', quip: 'The retro will not be blameless.' };
}

// ---------------------------------------------------------------- confetti

const CONFETTI_EMOJI = ['🎉', '✨', '🎊', '⭐', '💜', '🚀'];

export function Confetti({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () => Array.from({ length: count }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.9,
      dur: 2.4 + Math.random() * 1.8,
      size: 12 + Math.random() * 12,
      drift: Math.round(-50 + Math.random() * 100),
      emoji: CONFETTI_EMOJI[Math.floor(Math.random() * CONFETTI_EMOJI.length)],
    })),
    [count],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute -top-6 animate-confetti"
          style={{
            left: `${p.left}%`,
            fontSize: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            '--drift': `${p.drift}px`,
          } as CSSProperties}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
