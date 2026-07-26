import { useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { SprintStats } from '../../shared/types.ts';
import { Card, Badge, Progress, ThemeToggle, Avatar, Button, Overlay, Stat, CountPill, cx } from '../components/ui.tsx';
import { Analysis, Confetti, Gantt, Rise, sprintGrade, useCountUp } from '../components/retro.tsx';
import { useNow, fmtClock } from '../lib/hooks.ts';
import { useStore } from '../lib/store.ts';
import { nextSprint } from '../lib/net.ts';
import Missions, { IncidentCard } from '../panels/Missions.tsx';
import Controls from '../panels/Controls.tsx';
import Board from '../panels/Board.tsx';
import Chat from '../panels/Chat.tsx';
import Obs, { MetricsGrid } from '../panels/Obs.tsx';
import Infra from '../panels/Infra.tsx';

// When the tab is backgrounded, surface pending work in the title bar so
// cross-play players flipping between apps see they're needed.
function useAttentionTitle(count: number) {
  useEffect(() => {
    const update = () => {
      document.title = document.hidden && count > 0 ? `(${count}) 🚨 DreamTeam` : 'DreamTeam';
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      document.title = 'DreamTeam';
    };
  }, [count]);
}

function useIsDesktop() {
  const [is, setIs] = useState(() => matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 1024px)');
    const fn = (e: MediaQueryListEvent) => setIs(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return is;
}

function HealthBar({ health }: { health: number }) {
  const tone = health > 60 ? 'ok' : health > 30 ? 'warn' : 'danger';
  return (
    <div className="flex items-center gap-2 w-20 sm:w-32 shrink-0">
      <span className="text-xs">{health > 60 ? '💚' : health > 30 ? '💛' : '💔'}</span>
      <Progress value={health} tone={tone} className="flex-1 h-2" />
      <span className="text-xs font-bold tabular-nums w-6 text-right">{Math.round(health)}</span>
    </div>
  );
}

function Header() {
  const s = useStore();
  const now = useNow(250);
  const g = s.g!;
  const left = g.sprintEndsAt - now;
  const urgent = g.phase === 'playing' && left < 15000;

  return (
    <header className="h-12 sm:h-14 shrink-0 border-b border-line bg-surface/80 backdrop-blur flex items-center gap-2 sm:gap-4 px-3 sm:px-4">
      <span className="font-bold whitespace-nowrap">🚀 <span className="hidden md:inline">{g.name || 'DreamTeam'}</span></span>
      <Badge className="font-mono tracking-widest max-sm:hidden">{g.code}</Badge>
      {g.tutorial
        ? <Badge tone="info">🎓 TRIAL</Badge>
        : <Badge tone="accent">S{g.sprint}/{g.config.sprintCount}</Badge>}
      <span className={cx(
        'text-lg sm:text-2xl font-bold tabular-nums ml-auto w-12 sm:w-16 text-right',
        urgent ? 'text-danger animate-blink' : 'text-ink',
      )}>
        {fmtClock(left)}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-faint font-medium hidden sm:inline">SCORE</span>
        <span className="text-base sm:text-lg font-bold tabular-nums text-accent w-10 sm:w-14 text-right">{g.score}</span>
      </div>
      <HealthBar health={g.health} />
      {s.status === 'reconnecting' && <Badge tone="warn">⚡</Badge>}
      <ThemeToggle className="hidden sm:inline-flex" />
    </header>
  );
}

function TeamStrip() {
  const s = useStore();
  const g = s.g!;
  const players = Object.values(g.players).filter((p) => p.role !== 'spectator');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 shrink-0">
      {players.map((p) => {
        const count = g.tasks.filter((t) => t.displayPid === p.id).length;
        return (
          <span key={p.id} className={cx('flex items-center gap-1.5 text-xs', !p.connected && 'opacity-40')}>
            <Avatar name={p.name} role={p.role} size="sm" />
            <span className="font-medium">{p.name}</span>
            <Badge tone={count > 0 ? 'warn' : 'neutral'} className="w-6 justify-center">{count}</Badge>
          </span>
        );
      })}
    </div>
  );
}

// The between-sprint retro: grade stamp, count-up points, this sprint's
// cause-and-effect timeline and failure analysis — enough to actually
// examine the strategy before the host fires the next sprint.
function SprintRetro() {
  const s = useStore();
  const now = useNow(500);
  const g = s.g!;
  const me = s.you ? g.players[s.you] : undefined;
  const st: Partial<SprintStats> = g.sprintStats || {};
  const left = Math.max(0, Math.ceil((g.reviewEndsAt - now) / 1000));
  const gr = sprintGrade(st);
  const delta = useCountUp(st.scoreDelta ?? (g.score - (st.scoreStart ?? 0)), { duration: 900, delay: 350 });

  // this sprint's slice of the causal ledger (from the last sprint marker on)
  const events = g.events || [];
  let start = events.length - 1;
  while (start > 0 && events[start].type !== 'sprint') start--;
  const sprintEvents = events.length ? events.slice(start) : null;

  return (
    <Overlay wide>
      {(gr.grade === 'S' || gr.grade === 'A') && <Confetti />}
      <div className="space-y-4 py-2">
        <Card className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Sprint {g.sprint} retro</h2>
              <p className="text-subtle text-sm mt-1">{gr.quip}</p>
              <div className="text-3xl font-bold text-accent tabular-nums mt-3">+{delta} <span className="text-sm font-semibold text-subtle">points · health {Math.round(g.health)}</span></div>
            </div>
            <div className={cx(
              'size-20 sm:size-24 shrink-0 rounded-2xl border-4 border-current flex items-center justify-center',
              'text-5xl sm:text-6xl font-black animate-stamp select-none', gr.tone,
            )}>
              {gr.grade}
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
            <Stat label="Shipped" value={st.shipped ?? 0} tone="accent" />
            <Stat label="Bugs fixed" value={st.bugsFixed ?? 0} tone="ok" />
            <Stat label="Triaged" value={st.triaged ?? 0} tone="info" />
            <Stat label="Incidents" value={st.incidentsResolved ?? 0} tone="warn" />
            <Stat label="Role synergy" value={`×${st.roleMatches ?? 0}`} tone="accent" />
            <Stat label="Missed" value={st.missed ?? 0} tone="danger" />
          </div>
        </Card>

        <Rise delay={0.35}><Analysis items={g.analysis} /></Rise>
        <Rise delay={0.6}><Gantt events={sprintEvents} title={`Cause & effect — sprint ${g.sprint} timeline`} /></Rise>

        <Rise delay={0.8}>
        <Card className="p-4 sm:p-5">
          {me?.isHost ? (
            <div className="space-y-2">
              <Button size="lg" className="w-full" onClick={nextSprint}>
                Start sprint {g.sprint + 1} →
              </Button>
              <p className="text-center text-xs text-faint">
                take your time — auto-starts in {left}s. Talk strategy: who owns what next sprint?
              </p>
            </div>
          ) : (
            <p className="text-center text-subtle text-sm">
              The host starts sprint {g.sprint + 1} (auto in {left}s). Use the time — trace what caused what above.
            </p>
          )}
        </Card>
        </Rise>
      </div>
    </Overlay>
  );
}

function ResizeH() {
  return (
    <PanelResizeHandle className="w-2 group flex items-center justify-center">
      <div className="w-px h-full bg-line group-hover:bg-accent group-data-[resize-handle-active]:bg-accent transition-colors" />
    </PanelResizeHandle>
  );
}

function ResizeV() {
  return (
    <PanelResizeHandle className="h-2 group flex items-center justify-center">
      <div className="h-px w-full bg-line group-hover:bg-accent group-data-[resize-handle-active]:bg-accent transition-colors" />
    </PanelResizeHandle>
  );
}

// --------------------------------------------------------------- player views

// Desktop: a left navbar switches between the "apps" of the company —
// console, board, observability, infra and chat.
const APP_VIEWS = [
  { id: 'console', label: 'Console', icon: '🎛️' },
  { id: 'board', label: 'Board', icon: '📌' },
  { id: 'obs', label: 'Observe', icon: '🔭' },
  { id: 'infra', label: 'Infra', icon: '🏗️' },
  { id: 'chat', label: 'Chat', icon: '💬' },
];

function NavRail({ view, setView, badges, needy }: {
  view: string; setView: (v: string) => void; badges: Record<string, number>;
  needy?: string | null;
}) {
  return (
    <nav className="w-[72px] shrink-0 border-r border-line bg-surface/60 flex flex-col items-center gap-1 py-3">
      {APP_VIEWS.map((v) => {
        const sense = needy === v.id && view !== v.id;
        return (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            title={sense ? '📡 your pager sense: this tab needs help' : undefined}
            className={cx(
              'w-16 py-2 rounded-xl flex flex-col items-center gap-1 cursor-pointer transition-colors',
              view === v.id ? 'bg-accent-soft text-accent' : 'text-subtle hover:text-ink hover:bg-raised',
              sense && 'ring-2 ring-warn animate-pulse-warn',
            )}
          >
            <span className="text-xl leading-none relative">
              {v.icon}
              <CountPill count={badges[v.id]} className="absolute -top-1.5 -right-3" />
            </span>
            <span className="text-[10px] font-semibold">{sense ? '📡 ' : ''}{v.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// Ops pager sense: which tab most needs a human right now? Incidents beat
// dying services beat teammates drowning in near-deadline work.
function useOpsSense(isOps: boolean, you: string | null) {
  const s = useStore();
  const now = useNow(1000);
  const g = s.g!;
  if (!isOps) return { needy: null as string | null, urgentElsewhere: 0 };
  const urgentElsewhere = g.tasks.filter((t) =>
    !t.celebrate && t.displayPid !== you && (t.deadlineAt - now) < (t.deadlineAt - t.createdAt) * 0.35,
  ).length;
  const downNodes = Object.values(g.nodes || {}).some((n) => n.s !== 'ok');
  const needy = g.incident ? 'console' : downNodes ? 'infra' : urgentElsewhere > 0 ? 'board' : null;
  return { needy, urgentElsewhere };
}

function PlayerDesktop() {
  const s = useStore();
  const [view, setView] = useState('console');
  const g = s.g!;
  const me = s.you ? g.players[s.you] : undefined;
  const arcade = g.config.mode === 'arcade';
  const myTasks = g.tasks.filter((t) => t.displayPid === s.you).length;
  const badNodes = Object.values(g.nodes || {}).filter((n) => n.s !== 'ok').length;
  const { needy, urgentElsewhere } = useOpsSense(me?.role === 'ops', s.you);
  const lastChatTs = g.chat.at(-1)?.ts ?? 0;
  const chatSeenTs = useRef(lastChatTs);
  useEffect(() => {
    if (view === 'chat') chatSeenTs.current = lastChatTs;
  }, [view, lastChatTs]);
  const badges: Record<string, number> = {
    console: myTasks + (g.incident ? 1 : 0),
    board: urgentElsewhere,
    infra: badNodes,
    chat: view === 'chat' ? 0 : g.chat.filter((m) => m.ts > chatSeenTs.current).length,
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <NavRail view={view} setView={setView} badges={badges} needy={needy} />
      <div className="flex-1 min-w-0 min-h-0">
        {view === 'console' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-5xl mx-auto space-y-3">
              <TeamStrip />
              <div className="grid lg:grid-cols-[minmax(320px,420px)_1fr] gap-4 items-start">
                <Missions />
                <div className="space-y-3">
                  <Controls />
                  <MetricsGrid compact />
                </div>
              </div>
              {/* arcade: the whole company runs from this one dashboard */}
              {arcade && <Infra />}
            </div>
          </div>
        )}
        {view === 'board' && <div className="h-full overflow-y-auto p-4"><Board /></div>}
        {view === 'obs' && <div className="h-full p-4"><Obs /></div>}
        {view === 'infra' && <div className="h-full p-4"><Infra full /></div>}
        {view === 'chat' && (
          <div className="h-full p-4">
            <Card className="h-full max-w-3xl mx-auto overflow-hidden"><Chat /></Card>
          </div>
        )}
      </div>
    </div>
  );
}

const MOBILE_TABS = [
  { id: 'console', label: 'Console', icon: '🎛️' },
  { id: 'board', label: 'Board', icon: '📌' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'obs', label: 'Metrics', icon: '🔭' },
  { id: 'infra', label: 'Infra', icon: '🏗️' },
];

function PlayerMobile() {
  const s = useStore();
  const [tab, setTab] = useState('console');
  const g = s.g!;
  const me = s.you ? g.players[s.you] : undefined;
  const arcade = g.config.mode === 'arcade';
  const myTasks = g.tasks.filter((t) => t.displayPid === s.you).length;
  const badNodes = Object.values(g.nodes || {}).filter((n) => n.s !== 'ok').length;
  const { needy, urgentElsewhere } = useOpsSense(me?.role === 'ops', s.you);
  const badge: Record<string, number> = {
    console: myTasks + (g.incident ? 1 : 0), board: urgentElsewhere, infra: badNodes,
  };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-1">
        {tab === 'console' && <div className="space-y-3"><Missions /><Controls flat />{arcade && <Infra />}</div>}
        {tab === 'board' && <Board />}
        {tab === 'chat' && <Card className="h-[72vh] overflow-hidden flex flex-col"><Chat /></Card>}
        {tab === 'obs' && <Obs />}
        {tab === 'infra' && <Infra />}
      </div>
      <nav className="shrink-0 border-t border-line bg-surface/90 backdrop-blur flex pb-[env(safe-area-inset-bottom)]">
        {MOBILE_TABS.map((t) => {
          const sense = needy === t.id && tab !== t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cx(
                'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium cursor-pointer relative',
                tab === t.id ? 'text-accent' : sense ? 'text-warn' : 'text-subtle',
              )}>
              <span className={cx('text-lg leading-none relative', sense && 'rounded-full animate-pulse-warn')}>
                {t.icon}
                <CountPill count={badge[t.id]} className="absolute -top-1 -right-2.5" />
              </span>
              {sense ? `📡 ${t.label}` : t.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}

// --------------------------------------------------------------- spectator

function SpectatorDesktop() {
  const s = useStore();
  const g = s.g!;
  const now = useNow(250);
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-4">
        <TeamStrip />
        <div className="w-96 shrink-0"><IncidentCard incident={g.incident} now={now} compact /></div>
      </div>
      <PanelGroup direction="horizontal" autoSaveId="dt-spectator" className="flex-1 min-h-0">
        <Panel defaultSize={55} minSize={35} className="min-w-0">
          <PanelGroup direction="vertical">
            <Panel defaultSize={65} minSize={40}>
              <Card className="h-full overflow-y-auto p-3"><Board /></Card>
            </Panel>
            <ResizeV />
            <Panel defaultSize={35} minSize={20}>
              <div className="h-full overflow-y-auto"><MetricsGrid compact /></div>
            </Panel>
          </PanelGroup>
        </Panel>
        <ResizeH />
        <Panel defaultSize={45} minSize={30} className="min-w-0">
          <PanelGroup direction="vertical">
            <Panel defaultSize={62} minSize={35}>
              <div className="h-full overflow-y-auto"><Infra full /></div>
            </Panel>
            <ResizeV />
            <Panel defaultSize={38} minSize={20}>
              <Card className="h-full overflow-hidden"><Chat readOnly /></Card>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    </div>
  );
}

function SpectatorMobile() {
  const s = useStore();
  const g = s.g!;
  const now = useNow(250);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <TeamStrip />
      <IncidentCard incident={g.incident} now={now} compact />
      <Infra />
      <MetricsGrid compact />
      <Card className="p-3"><Board /></Card>
      <Card className="h-[50vh] overflow-hidden flex flex-col"><Chat readOnly /></Card>
    </div>
  );
}

export default function Game() {
  const s = useStore();
  const g = s.g!;
  const desktop = useIsDesktop();
  const me = s.you ? g.players[s.you] : undefined;
  const spectator = !me || me.role === 'spectator';
  const myWork = g.tasks.filter((t) => t.displayPid === s.you).length + (g.incident ? 1 : 0);
  useAttentionTitle(spectator ? 0 : myWork);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Header />
      {spectator
        ? (desktop ? <SpectatorDesktop /> : <SpectatorMobile />)
        : (desktop ? <PlayerDesktop /> : <PlayerMobile />)}
      {g.phase === 'review' && <SprintRetro />}
    </div>
  );
}
