import { useState } from 'react';
import { Card, Badge, Progress, Skeleton, Button, cx } from '../components/ui.jsx';
import { useNow } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { guessCodeLine, pickTriage, requestHint } from '../lib/net.js';

const KIND_META = {
  feature: { label: 'FEATURE', tone: 'accent', icon: '✨' },
  bug: { label: 'BUG', tone: 'warn', icon: '🐛' },
};

const CODE_META = {
  feature: { label: 'CODE · SHIP', icon: '✨' },
  service: { label: 'CODE · NEW SERVICE', icon: '🧩' },
  bug: { label: 'CODE · FIX', icon: '🐛' },
};

const SLOT_H = 'h-[128px]';

function Deadline({ task, now }) {
  const total = task.deadlineAt - task.createdAt;
  const left = task.deadlineAt - now;
  const urgent = left < total * 0.3;
  return {
    left, urgent, pct: (left / total) * 100,
    node: (
      <span className={cx('text-xs font-bold tabular-nums w-8 text-right', urgent ? 'text-danger' : 'text-faint')}>
        {Math.max(0, Math.ceil(left / 1000))}s
      </span>
    ),
  };
}

function MissionCard({ task, now }) {
  const meta = KIND_META[task.kind];
  const d = Deadline({ task, now });

  return (
    <Card className={cx(SLOT_H, 'p-3.5 flex flex-col justify-between animate-pop', d.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={meta.tone}>{meta.icon} {meta.label}{task.epicService ? ' · EPIC' : ''}</Badge>
        {d.node}
      </div>
      <div className="min-h-0">
        <div className="text-xs text-subtle truncate" title={task.title}>{task.title}</div>
        <div className="text-[15px] font-semibold leading-snug line-clamp-2">{task.instr}</div>
      </div>
      <Progress value={d.pct} tone={d.urgent ? 'danger' : meta.tone} />
    </Card>
  );
}

// Find-the-bug code review. Engineers get a lens that marks the buggy line.
function CodeMissionCard({ task, now, isEngineer }) {
  const [wrong, setWrong] = useState(null);
  const meta = CODE_META[task.codeKind] || CODE_META.feature;
  const d = Deadline({ task, now });

  const tap = (i) => {
    guessCodeLine(task.id, i);
    if (i !== task.bugLine) {
      setWrong(i);
      setTimeout(() => setWrong(null), 450);
    }
  };

  return (
    <Card className={cx('p-3.5 space-y-2 animate-pop', d.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone="info">👨‍💻 {meta.label}{task.epicService ? ' · EPIC' : ''}</Badge>
        {d.node}
      </div>
      <div>
        <div className="text-[15px] font-semibold leading-snug">{meta.icon} {task.title}</div>
        <div className="text-xs text-subtle mt-0.5">
          Tap the broken line{isEngineer && <span className="text-accent font-medium"> — your 🔍 lens marks it</span>}
        </div>
      </div>
      <div className="rounded-lg bg-raised border border-line overflow-x-auto">
        <div className="font-mono text-[11px] leading-relaxed py-1 min-w-fit">
          <div className="px-2.5 pb-1 text-[10px] text-faint border-b border-line/60 mb-1">{task.snippet.name}</div>
          {task.snippet.lines.map((ln, i) => (
            <button
              key={i}
              onClick={() => tap(i)}
              className={cx(
                'w-full text-left px-2.5 py-px flex items-center gap-2 cursor-pointer whitespace-pre',
                'hover:bg-accent-soft transition-colors',
                wrong === i && 'bg-danger-soft animate-shake',
              )}
            >
              <span className="text-faint w-4 text-right shrink-0 select-none">{i + 1}</span>
              <span className="text-ink">{ln}</span>
              {isEngineer && i === task.bugLine && (
                <span className="ml-auto pl-2 text-[10px] opacity-70 select-none" title="engineer lens">🐛</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Progress value={d.pct} tone={d.urgent ? 'danger' : 'info'} className="flex-1" />
        {task.wrongGuesses > 0 && (
          <span className="text-[10px] font-semibold text-danger whitespace-nowrap">
            {task.wrongGuesses}✗ · −4s each
          </span>
        )}
      </div>
    </Card>
  );
}

// Ticket triage — route it to the right priority. PMs get an instinct marker.
function TriageMissionCard({ task, now, isPm }) {
  const [wrong, setWrong] = useState(null);
  const d = Deadline({ task, now });

  const tap = (i) => {
    pickTriage(task.id, i);
    if (i !== task.answer) {
      setWrong(i);
      setTimeout(() => setWrong(null), 450);
    }
  };

  return (
    <Card className={cx('p-3.5 space-y-2 animate-pop', d.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={task.triageKind === 'bug' ? 'warn' : 'accent'}>
          📥 {task.triageKind === 'bug' ? 'TRIAGE · BUG REPORT' : 'TRIAGE · REQUEST'}
        </Badge>
        {d.node}
      </div>
      <div className="text-sm leading-snug bg-raised border border-line rounded-lg px-2.5 py-2">
        <span className="text-faint">🎧 </span>“{task.ticketText}”
      </div>
      <div className="text-xs text-subtle">
        Route it{isPm && <span className="text-accent font-medium"> — your ⭐ instinct marks the call</span>}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {task.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => tap(i)}
            className={cx(
              'px-2 py-1.5 rounded-lg border text-xs font-medium text-left cursor-pointer transition-colors',
              'border-line hover:bg-accent-soft hover:border-accent/40',
              wrong === i && 'bg-danger-soft border-danger animate-shake',
            )}
          >
            {opt}
            {isPm && i === task.answer && <span className="ml-1 text-[10px] opacity-70" title="PM instinct">⭐</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Progress value={d.pct} tone={d.urgent ? 'danger' : 'accent'} className="flex-1" />
        {task.wrongGuesses > 0 && (
          <span className="text-[10px] font-semibold text-danger whitespace-nowrap">
            {task.wrongGuesses}✗ · −4s each
          </span>
        )}
      </div>
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
  const realism = !incident.goal;
  return (
    <Card className="p-3.5 space-y-2 border-danger bg-danger-soft animate-pulse-danger">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="danger" className="animate-blink">🚨 {realism ? 'PAGER' : 'INCIDENT'}</Badge>
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
        <span className="mt-px">{incident.goalDone ? '✅' : realism ? '🩺' : '🎯'}</span>
        <div className="min-w-0">
          <div className="font-medium leading-snug">
            {incident.goal || 'Diagnose it: check metrics, logs and the infra map — then fix the failing component.'}
          </div>
          {incident.goalDone && <div className="text-xs mt-0.5">systems stabilizing… confirming recovery</div>}
        </div>
      </div>
      {incident.hint && !compact && (
        <div className="text-xs text-subtle flex gap-1.5">
          <span>💡</span><span>{incident.hint}</span>
        </div>
      )}
      {incident.hintAvailable && !incident.hint && !compact && (
        <Button size="sm" variant="outline" className="w-full" onClick={requestHint}>
          💡 Pull up the runbook (−25 pts)
        </Button>
      )}
      <Progress value={(left / total) * 100} tone="danger" />
    </Card>
  );
}

export default function Missions() {
  const s = useStore();
  const now = useNow(250);
  const g = s.g;
  const me = g.players[s.you];
  const mine = g.tasks
    .filter((t) => t.displayPid === s.you)
    .sort((a, b) => a.deadlineAt - b.deadlineAt);
  const slots = Math.max(g.config.maxActivePerPlayer, mine.length);

  return (
    <div className="space-y-3">
      <IncidentCard incident={g.incident} now={now} />
      {Array.from({ length: slots }, (_, i) => {
        const t = mine[i];
        if (!t) return <Skeleton key={`slot-${i}`} className={SLOT_H} label="waiting for work…" />;
        if (t.kind === 'code') return <CodeMissionCard key={t.id} task={t} now={now} isEngineer={me?.role === 'engineer'} />;
        if (t.kind === 'triage') return <TriageMissionCard key={t.id} task={t} now={now} isPm={me?.role === 'pm'} />;
        return <MissionCard key={t.id} task={t} now={now} />;
      })}
    </div>
  );
}
