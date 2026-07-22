import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Card, Badge, Progress, ThemeToggle, Avatar, Button, Overlay, Stat, cx } from '../components/ui.jsx';
import { useNow, fmtClock } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { nextSprint } from '../lib/net.js';
import Missions, { IncidentCard } from '../panels/Missions.jsx';
import Controls from '../panels/Controls.jsx';
import Board from '../panels/Board.jsx';
import Chat from '../panels/Chat.jsx';
import Obs, { MetricsGrid } from '../panels/Obs.jsx';
import Infra from '../panels/Infra.jsx';

function useIsDesktop() {
  const [is, setIs] = useState(() => matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 1024px)');
    const fn = (e) => setIs(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return is;
}

function HealthBar({ health }) {
  const tone = health > 60 ? 'ok' : health > 30 ? 'warn' : 'danger';
  return (
    <div className="flex items-center gap-2 w-24 sm:w-32 shrink-0">
      <span className="text-xs">{health > 60 ? '💚' : health > 30 ? '💛' : '💔'}</span>
      <Progress value={health} tone={tone} className="flex-1 h-2" />
      <span className="text-xs font-bold tabular-nums w-6 text-right">{Math.round(health)}</span>
    </div>
  );
}

function Header() {
  const s = useStore();
  const now = useNow(250);
  const g = s.g;
  const left = g.sprintEndsAt - now;
  const urgent = g.phase === 'playing' && left < 15000;

  return (
    <header className="h-12 sm:h-14 shrink-0 border-b border-line bg-surface/80 backdrop-blur flex items-center gap-2 sm:gap-4 px-3 sm:px-4">
      <span className="font-bold whitespace-nowrap">🚀 <span className="hidden md:inline">DreamTeam</span></span>
      <Badge className="font-mono tracking-widest hidden sm:inline-flex">{g.code}</Badge>
      <Badge tone="accent">S{g.sprint}/{g.config.sprintCount}</Badge>
      <span className={cx(
        'text-xl sm:text-2xl font-bold tabular-nums ml-auto w-16 text-right',
        urgent ? 'text-danger animate-blink' : 'text-ink',
      )}>
        {fmtClock(left)}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-faint font-medium hidden sm:inline">SCORE</span>
        <span className="text-base sm:text-lg font-bold tabular-nums text-accent w-14 text-right">{g.score}</span>
      </div>
      <HealthBar health={g.health} />
      {s.status === 'reconnecting' && <Badge tone="warn">⚡</Badge>}
      <ThemeToggle className="hidden sm:inline-flex" />
    </header>
  );
}

function TeamStrip() {
  const s = useStore();
  const g = s.g;
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

function ReviewOverlay() {
  const s = useStore();
  const now = useNow(500);
  const g = s.g;
  const me = g.players[s.you];
  const st = g.sprintStats || {};
  const left = Math.max(0, Math.ceil((g.reviewEndsAt - now) / 1000));

  return (
    <Overlay>
      <Card className="p-6 sm:p-8 space-y-6 text-center">
        <div>
          <div className="text-3xl mb-2">📋</div>
          <h2 className="text-2xl font-bold">Sprint {g.sprint} review</h2>
          <p className="text-subtle text-sm mt-1">Deep breath. Retro later. More shipping now.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Shipped" value={st.shipped ?? 0} tone="accent" />
          <Stat label="Bugs fixed" value={st.bugsFixed ?? 0} tone="ok" />
          <Stat label="Incidents" value={st.incidentsResolved ?? 0} tone="warn" />
          <Stat label="Missed" value={st.missed ?? 0} tone="danger" />
        </div>
        <div className="text-sm text-subtle">
          +{st.scoreDelta ?? (g.score - (st.scoreStart ?? 0))} points · health {Math.round(g.health)}
        </div>
        {me?.isHost ? (
          <Button size="lg" className="w-full" onClick={nextSprint}>
            Start sprint {g.sprint + 1} ({left}s)
          </Button>
        ) : (
          <p className="text-subtle text-sm">Sprint {g.sprint + 1} starts in {left}s…</p>
        )}
      </Card>
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

const CENTER_TABS = [
  { id: 'board', label: '📌 Board' },
  { id: 'obs', label: '🔭 Observability' },
  { id: 'infra', label: '🏗️ Infra' },
];

function CenterTabs() {
  const s = useStore();
  const [tab, setTab] = useState('board');
  const badNodes = Object.values(s.g.nodes || {}).filter((n) => n.s !== 'ok').length;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-1 border-b border-line shrink-0">
        {CENTER_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cx(
              'px-3.5 py-2 text-sm font-medium transition-colors relative cursor-pointer -mb-px border-b-2',
              tab === t.id ? 'text-ink border-accent' : 'text-subtle hover:text-ink border-transparent',
            )}>
            {t.label}
            {t.id === 'infra' && badNodes > 0 && (
              <span className="ml-1.5 px-1.5 py-px rounded-full bg-danger text-white text-[10px] font-bold">{badNodes}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 pt-3 overflow-y-auto">
        {tab === 'board' && <Board />}
        {tab === 'obs' && <Obs />}
        {tab === 'infra' && <Infra full />}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- player views

function PlayerDesktop() {
  return (
    <PanelGroup direction="horizontal" autoSaveId="dt-player" className="flex-1 min-h-0 p-3">
      <Panel defaultSize={27} minSize={22} className="min-w-0">
        <div className="h-full overflow-y-auto space-y-3 pr-1">
          <Missions />
          <Controls />
        </div>
      </Panel>
      <ResizeH />
      <Panel defaultSize={46} minSize={30} className="min-w-0">
        <CenterTabs />
      </Panel>
      <ResizeH />
      <Panel defaultSize={27} minSize={18} className="min-w-0">
        <Card className="h-full overflow-hidden"><Chat /></Card>
      </Panel>
    </PanelGroup>
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
  const g = s.g;
  const myTasks = g.tasks.filter((t) => t.displayPid === s.you).length;
  const badNodes = Object.values(g.nodes || {}).filter((n) => n.s !== 'ok').length;
  const badge = { console: myTasks + (g.incident ? 1 : 0), infra: badNodes };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-1">
        {tab === 'console' && <div className="space-y-3"><Missions /><Controls /></div>}
        {tab === 'board' && <Board />}
        {tab === 'chat' && <Card className="h-[72vh] overflow-hidden flex flex-col"><Chat /></Card>}
        {tab === 'obs' && <Obs />}
        {tab === 'infra' && <Infra />}
      </div>
      <nav className="shrink-0 border-t border-line bg-surface/90 backdrop-blur flex pb-[env(safe-area-inset-bottom)]">
        {MOBILE_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cx(
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium cursor-pointer relative',
              tab === t.id ? 'text-accent' : 'text-subtle',
            )}>
            <span className="text-lg leading-none relative">
              {t.icon}
              {badge[t.id] > 0 && (
                <span className="absolute -top-1 -right-2.5 min-w-4 h-4 px-0.5 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center">
                  {badge[t.id]}
                </span>
              )}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}

// --------------------------------------------------------------- spectator

function SpectatorDesktop() {
  const s = useStore();
  const now = useNow(250);
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-4">
        <TeamStrip />
        <div className="w-96 shrink-0"><IncidentCard incident={s.g.incident} now={now} compact /></div>
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
  const now = useNow(250);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <TeamStrip />
      <IncidentCard incident={s.g.incident} now={now} compact />
      <Infra />
      <MetricsGrid compact />
      <Card className="p-3"><Board /></Card>
      <Card className="h-[50vh] overflow-hidden flex flex-col"><Chat readOnly /></Card>
    </div>
  );
}

export default function Game() {
  const s = useStore();
  const desktop = useIsDesktop();
  const me = s.g.players[s.you];
  const spectator = !me || me.role === 'spectator';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Header />
      {spectator
        ? (desktop ? <SpectatorDesktop /> : <SpectatorMobile />)
        : (desktop ? <PlayerDesktop /> : <PlayerMobile />)}
      {s.g.phase === 'review' && <ReviewOverlay />}
    </div>
  );
}
