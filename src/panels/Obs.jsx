import { useState } from 'react';
import { Card, Seg, Badge, SectionLabel, cx } from '../components/ui.jsx';
import { useAutoScroll } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';

// ------------------------------------------------------------- sparkline

export function Sparkline({ data, className, height = 40 }) {
  const W = 200, H = 40;
  if (!data.length) return <div style={{ height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * W;
    const y = H - 3 - ((v - min) / span) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cx('w-full', className)} style={{ height }}>
      <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="currentColor" opacity="0.12" />
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricCard({ label, unit, values, format = (v) => v, toneFor }) {
  const latest = values.at(-1) ?? 0;
  const tone = toneFor ? toneFor(latest) : 'text-info';
  return (
    <Card className="p-3 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        <span className={cx('font-bold tabular-nums text-lg leading-none', tone)}>
          {format(latest)}<span className="text-[10px] text-faint font-medium ml-0.5">{unit}</span>
        </span>
      </div>
      <Sparkline data={values} className={tone} />
    </Card>
  );
}

export function MetricsGrid({ compact = false }) {
  const { g } = useStore();
  const m = g.metrics;
  const series = (k) => m.map((p) => p[k]);
  return (
    <div className={cx('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2')}>
      <MetricCard label="Requests" unit="rps" values={series('rps')}
        toneFor={(v) => (v > 350 ? 'text-warn' : 'text-info')} />
      <MetricCard label="Error rate" unit="%" values={series('err')} format={(v) => v.toFixed(1)}
        toneFor={(v) => (v > 10 ? 'text-danger' : v > 3 ? 'text-warn' : 'text-ok')} />
      <MetricCard label="p95 latency" unit="ms" values={series('p95')}
        toneFor={(v) => (v > 400 ? 'text-danger' : v > 250 ? 'text-warn' : 'text-info')} />
      <MetricCard label="Queue depth" unit="jobs" values={series('queue')}
        toneFor={(v) => (v > 100 ? 'text-danger' : v > 40 ? 'text-warn' : 'text-ok')} />
    </div>
  );
}

// ------------------------------------------------------------- logs

const LEVEL_STYLE = {
  info: 'text-subtle', warn: 'text-warn', error: 'text-danger font-semibold',
};

function Logs() {
  const { g } = useStore();
  const [filter, setFilter] = useState('all');
  const lines = g.logs.filter((l) => filter === 'all' || l.level === filter);
  const ref = useAutoScroll(g.logs.length);
  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <Seg size="sm" value={filter} onChange={setFilter}
        options={[{ value: 'all', label: 'All' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Warn' }, { value: 'error', label: 'Error' }]} />
      <div ref={ref} className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed bg-surface border border-line rounded-xl p-3 min-h-0">
        {lines.map((l, i) => (
          <div key={i} className="whitespace-nowrap">
            <span className="text-faint">{new Date(l.ts).toLocaleTimeString('en-GB')}</span>{' '}
            <span className={cx('uppercase', LEVEL_STYLE[l.level])}>{l.level.padEnd(5)}</span>{' '}
            <span className="text-accent">[{l.svc}]</span>{' '}
            <span className={l.level === 'error' ? 'text-ink' : 'text-subtle'}>{l.text}</span>
          </div>
        ))}
        {lines.length === 0 && <div className="text-faint">no logs yet — suspiciously healthy</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- traces

const SVC_COLORS = {
  cdn: 'bg-sky-400', lb: 'bg-indigo-400', frontend: 'bg-purple-400',
  backend: 'bg-blue-500', db: 'bg-emerald-500', cache: 'bg-teal-400',
  queue: 'bg-amber-400', payments: 'bg-pink-400',
};

function Traces() {
  const { g } = useStore();
  const traces = [...g.traces].reverse();
  return (
    <div className="space-y-2 overflow-y-auto h-full min-h-0 pr-1">
      {traces.map((tr) => (
        <Card key={tr.id} className="p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono font-semibold">{tr.name}</span>
            <span className="flex items-center gap-2">
              {tr.error && <Badge tone="danger">error</Badge>}
              <span className={cx('font-bold tabular-nums', tr.total > 500 ? 'text-danger' : 'text-subtle')}>
                {tr.total}ms
              </span>
            </span>
          </div>
          <div className="flex h-3 rounded overflow-hidden bg-raised">
            {tr.spans.map((sp, i) => (
              <div key={i} title={`${sp.svc}: ${sp.ms}ms`}
                className={cx(SVC_COLORS[sp.svc] || 'bg-zinc-400', 'min-w-[2px]')}
                style={{ width: `${(sp.ms / tr.total) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-faint font-mono">
            {tr.spans.map((sp, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <span className={cx('size-1.5 rounded-full', SVC_COLORS[sp.svc])} />
                {sp.svc} {sp.ms}ms
              </span>
            ))}
          </div>
        </Card>
      ))}
      {traces.length === 0 && <div className="text-faint text-xs text-center py-6">no traces sampled yet</div>}
    </div>
  );
}

// ------------------------------------------------------------- panel

export default function Obs() {
  const [tab, setTab] = useState('metrics');
  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <Seg value={tab} onChange={setTab} size="sm"
        options={[
          { value: 'metrics', label: '📈 Metrics' },
          { value: 'logs', label: '📜 Logs' },
          { value: 'traces', label: '🧵 Traces' },
        ]} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'metrics' && <MetricsGrid />}
        {tab === 'logs' && <Logs />}
        {tab === 'traces' && <Traces />}
      </div>
    </div>
  );
}
