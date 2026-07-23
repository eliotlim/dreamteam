import { Badge, Avatar, Progress, SectionLabel, cx } from '../components/ui.jsx';
import { useNow } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';

const KIND_ICON = { feature: '✨', bug: '🐛', incident: '🚨', code: '👨‍💻', triage: '📥', design: '🎨' };

function BoardCard({ children, className }) {
  return (
    <div className={cx('bg-surface border border-line rounded-xl p-2.5 text-xs space-y-1.5', className)}>
      {children}
    </div>
  );
}

function Column({ title, count, children }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2 px-1">
        <SectionLabel>{title}</SectionLabel>
        <span className="text-[10px] font-bold text-faint bg-raised rounded-full px-1.5 py-0.5 tabular-nums">{count}</span>
      </div>
      <div className="space-y-2 overflow-y-auto">{children}</div>
    </div>
  );
}

export default function Board() {
  const s = useStore();
  const now = useNow(500);
  const g = s.g;
  const players = g.players;

  // celebrating ghosts are already in doneLog — don't double-list them
  const active = g.tasks.filter((t) => !t.celebrate).sort((a, b) => a.deadlineAt - b.deadlineAt);
  const finished = [...g.doneLog].reverse();
  const done = finished.filter((t) => t.status === 'done').slice(0, 8);
  const failed = finished.filter((t) => t.status !== 'done').slice(0, 8);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 h-full content-start">
      <Column title="Backlog" count={g.backlog?.length ?? 0}>
        {(g.backlog || []).map((f) => (
          <BoardCard key={f.title} className="opacity-70">
            <span className="text-faint">{f.service ? '🧩' : '✨'}</span> {f.title}
            {f.service && <span className="block text-[10px] text-faint mt-0.5">unlocks a new service</span>}
          </BoardCard>
        ))}
      </Column>

      <Column title="In progress" count={active.length + (g.incident ? 1 : 0)}>
        {g.incident && (
          <BoardCard className="border-danger bg-danger-soft">
            <div className="font-semibold">🚨 {g.incident.title}</div>
            <div className="text-faint">
              {g.incident.goalDone ? 'stabilizing — confirming recovery' : g.incident.goal || 'root cause unknown — diagnose it'}
            </div>
          </BoardCard>
        )}
        {active.map((t) => {
          const pct = ((t.deadlineAt - now) / (t.deadlineAt - t.createdAt)) * 100;
          const display = players[t.displayPid];
          return (
            <BoardCard key={t.id}>
              <div className="flex items-start justify-between gap-1.5">
                <span className="font-medium leading-snug">{KIND_ICON[t.kind]} {t.title}</span>
                {display && <Avatar name={display.name} role={display.role} size="sm" />}
              </div>
              <Progress value={pct} tone={pct < 30 ? 'danger' : 'accent'} className="h-1" />
            </BoardCard>
          );
        })}
        {active.length === 0 && !g.incident && (
          <div className="text-xs text-faint px-1 py-2">the calm before the sprint…</div>
        )}
      </Column>

      <Column title="Done" count={done.length}>
        {done.map((t) => (
          <BoardCard key={t.id} className="border-ok/30">
            <span className="text-ok">✓</span> {KIND_ICON[t.kind]} {t.title}
          </BoardCard>
        ))}
      </Column>

      <Column title="Graveyard" count={failed.length}>
        {failed.map((t) => (
          <BoardCard key={t.id} className={cx(t.status === 'failed' ? 'border-danger/30' : 'opacity-60')}>
            <span className="text-danger">{t.status === 'failed' ? '✗' : '−'}</span> {KIND_ICON[t.kind]} {t.title}
            {t.status === 'cancelled' && <Badge className="ml-1">cancelled</Badge>}
          </BoardCard>
        ))}
      </Column>
    </div>
  );
}
