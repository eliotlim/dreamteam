import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { GUESS_PENALTY, MODES } from '../../shared/content.ts';
import type {
  CodeTask, DesignTask, DialTask, Incident, Quorum, TriageTask,
} from '../../shared/types.ts';
import { Card, Badge, Progress, Skeleton, Button, cx } from '../components/ui.tsx';
import type { Tone } from '../components/ui.tsx';
import { useNow } from '../lib/hooks.ts';
import { useStore } from '../lib/store.ts';
import { guessCodeLine, shipCode, pickTriage, pickDesign, requestHint } from '../lib/net.ts';

const KIND_META: Record<'feature' | 'bug', { label: string; tone: Tone; icon: string }> = {
  feature: { label: 'FEATURE', tone: 'accent', icon: '✨' },
  bug: { label: 'BUG', tone: 'warn', icon: '🐛' },
};

const CODE_META: Record<CodeTask['codeKind'], { label: string; icon: string }> = {
  feature: { label: 'CODE · SHIP', icon: '✨' },
  service: { label: 'CODE · NEW SERVICE', icon: '🧩' },
  bug: { label: 'CODE · FIX', icon: '🐛' },
};

const SLOT_H = 'h-[128px]';

interface TimeInfo { left: number; pct: number; urgent: boolean }

function timeInfo(start: number, end: number, now: number): TimeInfo {
  const total = end - start;
  const left = end - now;
  return { left, pct: (left / total) * 100, urgent: left < total * 0.3 };
}

function TimeLeft({ left, urgent }: { left: number; urgent: boolean }) {
  return (
    <span className={cx('text-xs font-bold tabular-nums w-8 text-right', urgent ? 'text-danger' : 'text-faint')}>
      {Math.max(0, Math.ceil(left / 1000))}s
    </span>
  );
}

// wrong-pick feedback: briefly flags the tapped option so it can shake red
function useWrongFlash() {
  const [wrong, setWrong] = useState<number | null>(null);
  const flash = (i: number) => {
    setWrong(i);
    setTimeout(() => setWrong(null), 450);
  };
  return [wrong, flash] as const;
}

function PenaltyFooter({ t, tone, wrongGuesses }: { t: TimeInfo; tone: Tone; wrongGuesses?: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Progress value={t.pct} tone={t.urgent ? 'danger' : tone} className="flex-1" />
      {(wrongGuesses ?? 0) > 0 && (
        <span className="text-[10px] font-semibold text-danger whitespace-nowrap">
          {wrongGuesses}✗ · −{GUESS_PENALTY.secs}s each
        </span>
      )}
    </div>
  );
}

function QuorumDots({ quorum }: { quorum: Quorum }) {
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

function MissionCard({ task, now }: { task: DialTask; now: number }) {
  const meta = KIND_META[task.kind];
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  if (task.celebrate) {
    return (
      <Card className={cx(SLOT_H, 'p-3.5 flex flex-col justify-between border-ok bg-ok-soft/50')}>
        <div className="flex items-center justify-between gap-2">
          <Badge tone="ok">✓ {task.kind === 'bug' ? 'FIXED' : 'SHIPPED'}</Badge>
          <span className="text-xs font-bold text-ok">+{task.points}</span>
        </div>
        <div className="min-h-0">
          <div className="text-xs text-subtle truncate" title={task.title}>{task.title}</div>
          <div className="text-[15px] font-semibold leading-snug line-clamp-2 text-ok">{task.instr}</div>
        </div>
        <Progress value={100} tone="ok" animate={false} />
      </Card>
    );
  }

  return (
    <Card className={cx(SLOT_H, 'p-3.5 flex flex-col justify-between animate-pop', t.urgent && 'border-danger/50')}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={meta.tone}>{meta.icon} {meta.label}{task.epicService ? ' · EPIC' : ''}</Badge>
        <TimeLeft {...t} />
      </div>
      <div className="min-h-0">
        {task.locHint ? (
          <div className="text-[11px] font-medium text-accent truncate">
            {task.locHint === 'you'
              ? '🎛️ psst — this dial is on YOUR console'
              : `📣 ${task.locHint} has this dial — say it out loud`}
          </div>
        ) : (
          <div className="text-xs text-subtle truncate" title={task.title}>{task.title}</div>
        )}
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
function CodeMissionCard({ task, now, isEngineer }: { task: CodeTask; now: number; isEngineer: boolean }) {
  const [wrong, flash] = useWrongFlash();
  const meta = CODE_META[task.codeKind] || CODE_META.feature;
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  const tap = (i: number) => {
    if (task.patched || task.celebrate) return;
    guessCodeLine(task.id, i);
    if (i !== task.bugLine) flash(i);
  };

  return (
    <Card className={cx(
      'p-3.5 space-y-2',
      task.celebrate ? 'border-ok bg-ok-soft/50' : 'animate-pop',
      t.urgent && !task.celebrate && 'border-danger/50',
    )}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={task.celebrate ? 'ok' : 'info'}>
          {task.celebrate ? `✓ SHIPPED · +${task.points}` : <>👨‍💻 {meta.label}{task.epicService ? ' · EPIC' : ''}</>}
        </Badge>
        {!task.celebrate && <TimeLeft {...t} />}
      </div>
      <div>
        <div className="text-[15px] font-semibold leading-snug">{meta.icon} {task.title}</div>
        <div className="text-xs text-subtle mt-0.5">
          {task.celebrate
            ? <span className="text-ok font-medium">Clean build in prod ✓</span>
            : task.patched
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
      {task.celebrate ? (
        <div className="h-10 sm:h-8 rounded-xl bg-ok text-white text-sm font-semibold flex items-center justify-center gap-2">
          🚀 Shipped!
        </div>
      ) : (
        <Button size="sm" className="w-full font-semibold h-10 sm:h-8" onClick={() => shipCode(task.id)}>
          🚀 Ship it
        </Button>
      )}
      {!task.celebrate && <PenaltyFooter t={t} tone="info" wrongGuesses={task.wrongGuesses} />}
    </Card>
  );
}

// Ticket triage — route it to the right priority. Triage is ops turf: ops
// gets an instinct marker on the right call.
function TriageMissionCard({ task, now, isOps }: { task: TriageTask; now: number; isOps: boolean }) {
  const [wrong, flash] = useWrongFlash();
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  const tap = (i: number) => {
    if (task.celebrate) return;
    pickTriage(task.id, i);
    if (i !== task.answer) flash(i);
  };

  return (
    <Card className={cx(
      'p-3.5 space-y-2',
      task.celebrate ? 'border-ok bg-ok-soft/50' : 'animate-pop',
      t.urgent && !task.celebrate && 'border-danger/50',
    )}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={task.celebrate ? 'ok' : task.triageKind === 'bug' ? 'warn' : 'accent'}>
          {task.celebrate ? `✓ ROUTED · +${task.points}` : <>📥 {task.triageKind === 'bug' ? 'TRIAGE · BUG REPORT' : 'TRIAGE · REQUEST'}</>}
        </Badge>
        {!task.celebrate && <TimeLeft {...t} />}
      </div>
      <div className="text-sm leading-snug bg-raised border border-line rounded-lg px-2.5 py-2">
        <span className="text-faint">🎧 </span>“{task.ticketText}”
      </div>
      <div className="text-xs text-subtle">
        {task.celebrate
          ? <span className="text-ok font-medium">Nice call ✓</span>
          : <>Route it{isOps && <span className="text-accent font-medium"> — your ⭐ ops instinct marks the call</span>}</>}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {task.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => tap(i)}
            className={cx(
              'px-2 py-2.5 sm:py-1.5 rounded-lg border text-xs font-medium text-left transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              task.celebrate
                ? i === task.answer
                  ? 'bg-ok-soft border-ok text-ok font-semibold'
                  : 'border-line opacity-50'
                : 'border-line hover:bg-accent-soft hover:border-accent/40 cursor-pointer',
              wrong === i && 'bg-danger-soft border-danger animate-shake',
            )}
          >
            {opt}
            {task.celebrate && i === task.answer && <span className="ml-1">✓</span>}
            {!task.celebrate && isOps && i === task.answer && <span className="ml-1 text-[10px] opacity-70" title="ops instinct">⭐</span>}
          </button>
        ))}
      </div>
      {!task.celebrate && <PenaltyFooter t={t} tone="accent" wrongGuesses={task.wrongGuesses} />}
    </Card>
  );
}

const DESIGN_META: Record<DesignTask['designKind'], { label: string }> = {
  shade: { label: 'DESIGN · COLOR' },
  centered: { label: 'DESIGN · ALIGNMENT' },
  radius: { label: 'DESIGN · RADIUS' },
};

// Design review: visual QA — match the brand swatch, spot the dead-centered
// dot, or match the border radius. Designers get an eye marker on the answer.
function DesignMissionCard({ task, now, isDesigner }: { task: DesignTask; now: number; isDesigner: boolean }) {
  const [wrong, flash] = useWrongFlash();
  const meta = DESIGN_META[task.designKind] || DESIGN_META.shade;
  const t = timeInfo(task.createdAt, task.deadlineAt, now);

  const tap = (i: number) => {
    if (task.celebrate) return;
    pickDesign(task.id, i);
    if (i !== task.answer) flash(i);
  };

  const optionBox = (i: number, inner: ReactNode, style?: CSSProperties) => (
    <button
      key={i}
      onClick={() => tap(i)}
      style={style}
      className={cx(
        'relative h-14 rounded-lg border transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        task.celebrate
          ? i === task.answer ? 'ring-2 ring-ok border-ok' : 'opacity-40 border-line'
          : 'cursor-pointer border-line-strong hover:border-accent',
        wrong === i && 'animate-shake ring-2 ring-danger',
      )}
    >
      {inner}
      {task.celebrate && i === task.answer && (
        <span className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-ok text-white text-[11px] flex items-center justify-center">✓</span>
      )}
      {!task.celebrate && isDesigner && i === task.answer && (
        <span className="absolute top-0.5 right-1 text-[10px] opacity-70 select-none" title="designer eye">🎨</span>
      )}
    </button>
  );

  return (
    <Card className={cx(
      'p-3.5 space-y-2',
      task.celebrate ? 'border-ok bg-ok-soft/50' : 'animate-pop',
      t.urgent && !task.celebrate && 'border-danger/50',
    )}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={task.celebrate ? 'ok' : 'accent'}>
          {task.celebrate ? `✓ APPROVED · +${task.points}` : <>🎨 {meta.label}</>}
        </Badge>
        {!task.celebrate && <TimeLeft {...t} />}
      </div>
      <div className="text-xs text-subtle">
        {task.celebrate
          ? <span className="text-ok font-medium">Pixel perfect ✓</span>
          : <>{task.instr}{isDesigner && <span className="text-accent font-medium"> — your 🎨 eye marks it</span>}</>}
      </div>
      {task.designKind === 'shade' && (
        <div className="flex items-center gap-2">
          <span className="size-8 rounded-lg border border-line shrink-0" style={{ background: task.prompt.swatch }} />
          <span className="text-xs text-subtle">brand swatch — <span className="font-semibold text-ink">{task.prompt.name}</span></span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {task.designKind === 'shade' && task.options.map((opt, i) => optionBox(i, null, { background: opt }))}
        {task.designKind === 'centered' && task.options.map(([x, y], i) => optionBox(i, (
          <span
            className="absolute size-2.5 rounded-full bg-accent"
            style={{ left: `calc(50% + ${x}px)`, top: `calc(50% + ${y}px)`, transform: 'translate(-50%, -50%)' }}
          />
        ), { background: 'var(--dt-raised)' }))}
        {task.designKind === 'radius' && task.options.map((opt, i) =>
          optionBox(i, null, { background: 'var(--dt-raised)', borderRadius: opt }))}
      </div>
      {!task.celebrate && <PenaltyFooter t={t} tone="accent" wrongGuesses={task.wrongGuesses} />}
    </Card>
  );
}

export function IncidentCard({ incident, now, compact = false }: {
  incident: Incident | null; now: number; compact?: boolean;
}) {
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
  const g = s.g!;
  const me = s.you ? g.players[s.you] : undefined;
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
        if (t.kind === 'design') return <DesignMissionCard key={t.id} task={t} now={now} isDesigner={me?.role === 'designer'} />;
        return <MissionCard key={t.id} task={t} now={now} />;
      })}
    </div>
  );
}
