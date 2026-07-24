import { useState } from 'react';
import type { ReactNode } from 'react';
import { ROLE_META } from '../../shared/content.ts';
import type { Player, Task } from '../../shared/types.ts';
import { Badge, Avatar, Progress, SectionLabel, cx } from '../components/ui.tsx';
import { useNow } from '../lib/hooks.ts';
import { useStore } from '../lib/store.ts';
import { reassignTask } from '../lib/net.ts';

const KIND_ICON: Record<string, string> = { feature: '✨', bug: '🐛', incident: '🚨', code: '👨‍💻', triage: '📥', design: '🎨' };

// which role a task kind naturally belongs to — the reassign menu leads with them
const KIND_ROLE: Record<string, Player['role']> = { code: 'engineer', triage: 'ops', design: 'designer' };

// PM-only reassign menu: tap a teammate to move the task to their screen.
// Role-matched teammates are suggested first with a star.
function AssignMenu({ task, players, onDone }: {
  task: Task; players: Player[]; onDone: () => void;
}) {
  const suggested = KIND_ROLE[task.kind];
  const candidates = players
    .filter((p) => p.connected && p.role !== 'spectator' && p.id !== task.displayPid)
    .sort((a, b) => Number(b.role === suggested) - Number(a.role === suggested));
  if (!candidates.length) {
    return <div className="text-[10px] text-faint pt-1">no one else to hand this to</div>;
  }
  return (
    <div className="flex flex-wrap gap-1 pt-1 border-t border-line">
      {candidates.map((p) => (
        <button
          key={p.id}
          onClick={() => { reassignTask(task.id, p.id); onDone(); }}
          className={cx(
            'flex items-center gap-1 px-1.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer transition-colors',
            p.role === suggested
              ? 'border-accent/50 bg-accent-soft text-accent hover:border-accent'
              : 'border-line text-subtle hover:text-ink hover:bg-raised',
          )}
          title={`Hand to ${p.name} (${ROLE_META[p.role].label})`}
        >
          {ROLE_META[p.role].icon} {p.name}{p.role === suggested && ' ⭐'}
        </button>
      ))}
    </div>
  );
}

function BoardCard({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cx('bg-surface border border-line rounded-xl p-2.5 text-xs space-y-1.5', className)}>
      {children}
    </div>
  );
}

function Column({ title, count, children }: { title: ReactNode; count: number; children?: ReactNode }) {
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
  const g = s.g!;
  const players = g.players;
  const me = s.you ? players[s.you] : undefined;
  // the PM runs the board (host as fallback so someone always can)
  const canAssign = g.phase === 'playing' && !!me && me.role !== 'spectator' && (me.role === 'pm' || me.isHost);
  const [assigning, setAssigning] = useState<string | null>(null);

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

      <Column
        title={canAssign ? <>In progress <span className="normal-case font-normal text-faint">· tap a face to reassign</span></> : 'In progress'}
        count={active.length + (g.incident ? 1 : 0)}
      >
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
                {canAssign ? (
                  <button
                    onClick={() => setAssigning(assigning === t.id ? null : t.id)}
                    className={cx(
                      'shrink-0 rounded-full cursor-pointer transition-shadow hover:ring-2 ring-accent/60',
                      assigning === t.id && 'ring-2 ring-accent',
                    )}
                    title={`On ${display?.name ?? 'someone'}'s screen — tap to reassign`}
                  >
                    <Avatar name={display?.name} role={display?.role} size="sm" />
                  </button>
                ) : (
                  display && <Avatar name={display.name} role={display.role} size="sm" />
                )}
              </div>
              <Progress value={pct} tone={pct < 30 ? 'danger' : 'accent'} className="h-1" />
              {canAssign && assigning === t.id && (
                <AssignMenu task={t} players={Object.values(players)} onDone={() => setAssigning(null)} />
              )}
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
