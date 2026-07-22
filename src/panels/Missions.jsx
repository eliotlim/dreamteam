import { Card, Badge, Progress, cx } from '../components/ui.jsx';
import { useNow } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';

const KIND_META = {
  feature: { label: 'FEATURE', tone: 'accent', icon: '✨' },
  bug: { label: 'BUG', tone: 'warn', icon: '🐛' },
};

function MissionCard({ task, now }) {
  const total = task.deadlineAt - task.createdAt;
  const left = task.deadlineAt - now;
  const pct = (left / total) * 100;
  const meta = KIND_META[task.kind];
  const urgent = left < total * 0.3;

  return (
    <Card className={cx('p-4 space-y-2.5 animate-pop', urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={meta.tone}>{meta.icon} {meta.label}</Badge>
        <span className={cx('text-xs font-bold tabular-nums', urgent ? 'text-danger' : 'text-faint')}>
          {Math.max(0, Math.ceil(left / 1000))}s
        </span>
      </div>
      <div className="text-xs text-subtle truncate" title={task.title}>{task.title}</div>
      <div className="text-[15px] font-semibold leading-snug">{task.instr}</div>
      <Progress value={pct} tone={urgent ? 'danger' : meta.tone} />
    </Card>
  );
}

export function IncidentBanner({ incident, now, mePid }) {
  const total = incident.deadlineAt - incident.startedAt;
  const left = incident.deadlineAt - now;
  return (
    <Card className="p-4 space-y-3 border-danger bg-danger-soft animate-pulse-danger">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="danger" className="animate-blink">🚨 INCIDENT</Badge>
        <span className="text-xs font-bold tabular-nums text-danger">
          {Math.max(0, Math.ceil(left / 1000))}s
        </span>
      </div>
      <div>
        <div className="font-bold text-[15px]">{incident.title}</div>
        <div className="text-xs text-subtle mt-0.5">{incident.desc}</div>
      </div>
      <ul className="space-y-1.5">
        {incident.needs.map((n, i) => (
          <li key={i} className={cx('flex items-center gap-2 text-sm', n.done ? 'text-ok line-through opacity-70' : 'text-ink')}>
            <span>{n.done ? '✅' : '⬜'}</span>
            <span className="font-medium">{n.label}</span>
            <span className="text-xs text-faint">
              — {n.pid === mePid ? 'your panel!' : `${n.ownerName}'s panel`}
            </span>
          </li>
        ))}
      </ul>
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

  return (
    <div className="space-y-3">
      {g.incident && <IncidentBanner incident={g.incident} now={now} mePid={s.you} />}
      {mine.map((t) => <MissionCard key={t.id} task={t} now={now} />)}
      {mine.length === 0 && !g.incident && (
        <Card className="p-6 text-center text-subtle text-sm">
          <div className="text-2xl mb-1.5">☕</div>
          Nothing on your plate. Help your teammates — read their instructions out loud!
        </Card>
      )}
    </div>
  );
}
