import { Card, Badge, Progress, Skeleton, cx } from '../components/ui.jsx';
import { useNow } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';

const KIND_META = {
  feature: { label: 'FEATURE', tone: 'accent', icon: '✨' },
  bug: { label: 'BUG', tone: 'warn', icon: '🐛' },
};

const SLOT_H = 'h-[128px]';

function MissionCard({ task, now }) {
  const total = task.deadlineAt - task.createdAt;
  const left = task.deadlineAt - now;
  const pct = (left / total) * 100;
  const meta = KIND_META[task.kind];
  const urgent = left < total * 0.3;

  return (
    <Card className={cx(SLOT_H, 'p-3.5 flex flex-col justify-between animate-pop', urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={meta.tone}>{meta.icon} {meta.label}{task.epicService ? ' · EPIC' : ''}</Badge>
        <span className={cx('text-xs font-bold tabular-nums w-8 text-right', urgent ? 'text-danger' : 'text-faint')}>
          {Math.max(0, Math.ceil(left / 1000))}s
        </span>
      </div>
      <div className="min-h-0">
        <div className="text-xs text-subtle truncate" title={task.title}>{task.title}</div>
        <div className="text-[15px] font-semibold leading-snug line-clamp-2">{task.instr}</div>
      </div>
      <Progress value={pct} tone={urgent ? 'danger' : meta.tone} />
    </Card>
  );
}

export function IncidentCard({ incident, now, compact = false }) {
  if (!incident) {
    return (
      <Card className={cx('px-3.5 flex items-center gap-2 text-sm text-subtle', compact ? 'h-11' : 'h-14')}>
        <span className="size-2 rounded-full bg-ok shrink-0" />
        No active incidents. Suspicious.
      </Card>
    );
  }
  const total = incident.deadlineAt - incident.startedAt;
  const left = incident.deadlineAt - now;
  return (
    <Card className="p-3.5 space-y-2 border-danger bg-danger-soft animate-pulse-danger">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="danger" className="animate-blink">🚨 INCIDENT</Badge>
        <span className="text-xs font-bold tabular-nums text-danger">
          {Math.max(0, Math.ceil(left / 1000))}s
        </span>
      </div>
      <div>
        <div className="font-bold text-[15px] leading-snug">{incident.title}</div>
        {!compact && <div className="text-xs text-subtle mt-0.5">{incident.desc}</div>}
      </div>
      <div className={cx(
        'flex items-start gap-2 text-sm rounded-lg px-2.5 py-2',
        incident.goalDone ? 'bg-ok-soft text-ok' : 'bg-surface/60',
      )}>
        <span className="mt-px">{incident.goalDone ? '✅' : '🎯'}</span>
        <div className="min-w-0">
          <div className="font-medium leading-snug">{incident.goal}</div>
          {incident.goalDone && <div className="text-xs mt-0.5">holding… confirming recovery</div>}
        </div>
      </div>
      {incident.hint && !compact && (
        <div className="text-xs text-subtle flex gap-1.5">
          <span>💡</span><span>{incident.hint}</span>
        </div>
      )}
      <Progress value={(left / total) * 100} tone="danger" />
    </Card>
  );
}

export default function Missions() {
  const s = useStore();
  const now = useNow(250);
  const g = s.g;
  const mine = g.tasks
    .filter((t) => t.displayPid === s.you)
    .sort((a, b) => a.deadlineAt - b.deadlineAt);
  const slots = Math.max(g.config.maxActivePerPlayer, mine.length);

  return (
    <div className="space-y-3">
      <IncidentCard incident={g.incident} now={now} />
      {Array.from({ length: slots }, (_, i) =>
        mine[i]
          ? <MissionCard key={mine[i].id} task={mine[i]} now={now} />
          : <Skeleton key={`slot-${i}`} className={SLOT_H} label="waiting for work…" />,
      )}
    </div>
  );
}
