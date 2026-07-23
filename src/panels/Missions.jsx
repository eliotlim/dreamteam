import { useState } from 'react';
import { GUESS_PENALTY, MODES } from '../../shared/content.js';
import { Card, Badge, Progress, Skeleton, Button, cx } from '../components/ui.jsx';
import { useNow } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { guessCodeLine, shipCode, pickTriage, requestHint } from '../lib/net.js';

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

function timeInfo(start, end, now) {
  const total = end - start;
  const left = end - now;
  return { left, pct: (left / total) * 100, urgent: left < total * 0.3 };
}

function TimeLeft({ left, urgent }) {
  return (
    <span className={cx('text-xs font-bold tabular-nums w-8 text-right', urgent ? 'text-danger' : 'text-faint')}>
      {Math.max(0, Math.ceil(left / 1000))}s
    </span>
  );
}

// wrong-pick feedback: briefly flags the tapped option so it can shake red
function useWrongFlash() {
  const [wrong, setWrong] = useState(null);
  const flash = (i) => {
    setWrong(i);
    setTimeout(() => setWrong(null), 450);
  };
  return [wrong, flash];
}

function PenaltyFooter({ t, tone, wrongGuesses }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Progress value={t.pct} tone={t.urgent ? 'danger' : tone} className="flex-1" />
      {wrongGuesses > 0 && (
        <span className="text-[10px] font-semibold text-danger whitespace-nowrap">
          {wrongGuesses}✗ · −{GUESS_PENALTY.secs}s each
        </span>
      )}
    </div>
  );
}

function QuorumDots({ quorum }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${quorum.have}/${quorum.required} teammates`}>
      <span className="text-[10px] font-bold text-accent">👥 {quorum.have}/{quorum.required}</span>
      <span className="inline-flex gap-0.5">
        {Array.from({ length: quorum.required }, (_, i) => (
          <span key={i} className={cx('size-1.5 rounded-full', i < quorum.have ? 'bg-accent' : 'bg-line-strong')} />
        ))}
      </span>
    </span>
  );
}

function MissionCard({ task, now }) {
  const meta = KIND_META[task.kind];
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  return (
    <Card className={cx(SLOT_H, 'p-3.5 flex flex-col justify-between animate-pop', t.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={meta.tone}>{meta.icon} {meta.label}{task.epicService ? ' · EPIC' : ''}</Badge>
        <TimeLeft {...t} />
      </div>
      <div className="min-h-0">
        <div className="text-xs text-subtle truncate" title={task.title}>{task.title}</div>
        <div className="text-[15px] font-semibold leading-snug line-clamp-2">{task.instr}</div>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={t.pct} tone={t.urgent ? 'danger' : meta.tone} className="flex-1" />
        {task.quorum && <QuorumDots quorum={task.quorum} />}
      </div>
    </Card>
  );
}

// Code review: tap away the bug (the line patches in place), then SHIP.
// Shipping with the bug still in there crashes prod — engineers get a lens
// that marks it, and a clean build should just be shipped as-is.
function CodeMissionCard({ task, now, isEngineer }) {
  const [wrong, flash] = useWrongFlash();
  const meta = CODE_META[task.codeKind] || CODE_META.feature;
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  const tap = (i) => {
    if (task.patched) return;
    guessCodeLine(task.id, i);
    if (i !== task.bugLine) flash(i);
  };

  return (
    <Card className={cx('p-3.5 space-y-2 animate-pop', t.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone="info">👨‍💻 {meta.label}{task.epicService ? ' · EPIC' : ''}</Badge>
        <TimeLeft {...t} />
      </div>
      <div>
        <div className="text-[15px] font-semibold leading-snug">{meta.icon} {task.title}</div>
        <div className="text-xs text-subtle mt-0.5">
          {task.patched
            ? <span className="text-ok font-medium">Patched ✓ — ship it!</span>
            : isEngineer && task.bugLine < 0
              ? <span className="text-ok font-medium">Your 🔍 lens sees nothing wrong — ship it as-is</span>
              : <>Tap anything broken, then ship{isEngineer && <span className="text-accent font-medium"> — your 🔍 lens marks bugs</span>}</>}
        </div>
      </div>
      <div className="rounded-lg bg-raised border border-line overflow-x-auto">
        <div className="font-mono text-[11px] leading-relaxed py-1 min-w-fit">
          <div className="px-2.5 pb-1 text-[10px] text-faint border-b border-line/60 mb-1">{task.snippet.name}</div>
          {task.snippet.lines.map((ln, i) => {
            const fixed = task.patched && i === task.bugLine;
            return (
              <button
                key={i}
                onClick={() => tap(i)}
                className={cx(
                  'w-full text-left px-2.5 py-1 sm:py-px flex items-center gap-2 whitespace-pre',
                  'transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  task.patched ? 'cursor-default' : 'cursor-pointer hover:bg-accent-soft',
                  wrong === i && 'bg-danger-soft animate-shake',
                  fixed && 'bg-ok-soft',
                )}
              >
                <span className="text-faint w-4 text-right shrink-0 select-none">{i + 1}</span>
                <span className={cx('text-ink', fixed && 'text-ok')}>{ln}</span>
                {fixed && <span className="ml-auto pl-2 text-[10px] select-none">✅</span>}
                {isEngineer && !task.patched && i === task.bugLine && (
                  <span className="ml-auto pl-2 text-[10px] opacity-70 select-none" title="engineer lens">🐛</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <Button
        size="sm"
        className={cx('w-full font-semibold h-10 sm:h-8', !task.patched && task.bugLine >= 0 && 'opacity-90')}
        onClick={() => shipCode(task.id)}
      >
        🚀 Ship it
      </Button>
      <PenaltyFooter t={t} tone="info" wrongGuesses={task.wrongGuesses} />
    </Card>
  );
}

// Ticket triage — route it to the right priority. Triage is ops turf: ops
// gets an instinct marker on the right call.
function TriageMissionCard({ task, now, isOps }) {
  const [wrong, flash] = useWrongFlash();
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  const tap = (i) => {
    pickTriage(task.id, i);
    if (i !== task.answer) flash(i);
  };

  return (
    <Card className={cx('p-3.5 space-y-2 animate-pop', t.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={task.triageKind === 'bug' ? 'warn' : 'accent'}>
          📥 {task.triageKind === 'bug' ? 'TRIAGE · BUG REPORT' : 'TRIAGE · REQUEST'}
        </Badge>
        <TimeLeft {...t} />
      </div>
      <div className="text-sm leading-snug bg-raised border border-line rounded-lg px-2.5 py-2">
        <span className="text-faint">🎧 </span>“{task.ticketText}”
      </div>
      <div className="text-xs text-subtle">
        Route it{isOps && <span className="text-accent font-medium"> — your ⭐ ops instinct marks the call</span>}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {task.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => tap(i)}
            className={cx(
              'px-2 py-2.5 sm:py-1.5 rounded-lg border text-xs font-medium text-left cursor-pointer transition-colors',
              'border-line hover:bg-accent-soft hover:border-accent/40',
              'outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              wrong === i && 'bg-danger-soft border-danger animate-shake',
            )}
          >
            {opt}
            {isOps && i === task.answer && <span className="ml-1 text-[10px] opacity-70" title="ops instinct">⭐</span>}
          </button>
        ))}
      </div>
      <PenaltyFooter t={t} tone="accent" wrongGuesses={task.wrongGuesses} />
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
  const t = timeInfo(incident.startedAt, incident.deadlineAt, now);
  const realism = !incident.goal;
  return (
    <Card className="p-3.5 space-y-2 border-danger bg-danger-soft animate-pulse-danger">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="danger" className="animate-blink">🚨 {realism ? 'PAGER' : 'INCIDENT'}</Badge>
        <span className="text-xs font-bold tabular-nums text-danger">
          {Math.max(0, Math.ceil(t.left / 1000))}s
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
          💡 Pull up the runbook (−{MODES.realism.hintCost} pts)
        </Button>
      )}
      <Progress value={t.pct} tone="danger" />
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
        if (t.kind === 'triage') return <TriageMissionCard key={t.id} task={t} now={now} isOps={me?.role === 'ops'} />;
        return <MissionCard key={t.id} task={t} now={now} />;
      })}
    </div>
  );
}
