import { useState } from 'react';
import { Card, Badge, Progress, Tabs, ThemeToggle, Avatar, Button, Overlay, Stat, SectionLabel, cx } from '../components/ui.jsx';
import { useNow, fmtClock } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { nextSprint } from '../lib/net.js';
import Missions from '../panels/Missions.jsx';
import Controls from '../panels/Controls.jsx';
import Board from '../panels/Board.jsx';
import Chat from '../panels/Chat.jsx';
import Obs, { MetricsGrid } from '../panels/Obs.jsx';
import Infra from '../panels/Infra.jsx';

function HealthBar({ health }) {
  const tone = health > 60 ? 'ok' : health > 30 ? 'warn' : 'danger';
  return (
    <div className="flex items-center gap-2 min-w-28">
      <span className="text-xs">{health > 60 ? '💚' : health > 30 ? '💛' : '💔'}</span>
      <Progress value={health} tone={tone} className="flex-1 h-2" />
      <span className="text-xs font-bold tabular-nums w-7">{Math.round(health)}</span>
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
    <header className="h-14 shrink-0 border-b border-line bg-surface/80 backdrop-blur flex items-center gap-4 px-4">
      <span className="font-bold whitespace-nowrap">🚀 <span className="hidden sm:inline">DreamTeam</span></span>
      <Badge className="font-mono tracking-widest">{g.code}</Badge>
      <Badge tone="accent">Sprint {g.sprint}/{g.config.sprintCount}</Badge>
      <span className={cx(
        'text-2xl font-bold tabular-nums ml-auto',
        urgent ? 'text-danger animate-blink' : 'text-ink',
      )}>
        {fmtClock(left)}
      </span>
      <div className="hidden sm:flex items-center gap-1.5">
        <span className="text-xs text-faint font-medium">SCORE</span>
        <span className="text-lg font-bold tabular-nums text-accent">{g.score}</span>
      </div>
      <HealthBar health={g.health} />
      {s.status === 'reconnecting' && <Badge tone="warn">reconnecting…</Badge>}
      <ThemeToggle />
    </header>
  );
}

function TeamStrip() {
  const s = useStore();
  const g = s.g;
  const players = Object.values(g.players).filter((p) => p.role !== 'spectator');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
      {players.map((p) => {
        const count = g.tasks.filter((t) => t.displayPid === p.id).length;
        return (
          <span key={p.id} className={cx('flex items-center gap-1.5 text-xs', !p.connected && 'opacity-40')}>
            <Avatar name={p.name} role={p.role} size="sm" />
            <span className="font-medium">{p.name}</span>
            {count > 0 && <Badge tone="warn">{count}</Badge>}
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
      <Card className="p-8 space-y-6 text-center">
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

function PlayerLayout() {
  const s = useStore();
  const g = s.g;
  const [tab, setTab] = useState('board');

  return (
    <main className="flex-1 min-h-0 grid lg:grid-cols-[360px_1fr] gap-4 p-4 max-w-[1500px] w-full mx-auto">
      <div className="overflow-y-auto space-y-4 min-h-0 pr-0.5">
        <SectionLabel>Your missions — read them out loud!</SectionLabel>
        <Missions />
        <Controls />
      </div>
      <div className="flex flex-col min-h-0 max-lg:h-[70vh]">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'board', label: '📌 Board' },
            { id: 'chat', label: '💬 Chat' },
            { id: 'obs', label: '🔭 Observability' },
            { id: 'infra', label: '🏗️ Infra', count: Object.values(g.infra || {}).filter((x) => x !== 'ok').length },
          ]}
        />
        <div className="flex-1 min-h-0 pt-3">
          {tab === 'board' && <Board />}
          {tab === 'chat' && <Card className="h-full overflow-hidden"><Chat /></Card>}
          {tab === 'obs' && <Obs />}
          {tab === 'infra' && <Infra />}
        </div>
      </div>
    </main>
  );
}

function SpectatorLayout() {
  const s = useStore();
  const now = useNow(250);
  const g = s.g;

  return (
    <main className="flex-1 min-h-0 flex flex-col gap-3 p-4 max-w-[1700px] w-full mx-auto">
      <TeamStrip />
      {g.incident && (
        <Card className="p-3 border-danger bg-danger-soft flex items-center gap-3 animate-pulse-danger">
          <span className="text-xl">🚨</span>
          <div className="flex-1">
            <span className="font-bold">{g.incident.title}</span>
            <span className="text-subtle text-sm ml-2">{g.incident.desc}</span>
          </div>
          <Badge tone="danger">
            {g.incident.needs.filter((n) => n.done).length}/{g.incident.needs.length} ·{' '}
            {Math.max(0, Math.ceil((g.incident.deadlineAt - now) / 1000))}s
          </Badge>
        </Card>
      )}
      <div className="flex-1 min-h-0 grid lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 flex flex-col gap-3 min-h-0">
          <Card className="flex-1 min-h-0 overflow-y-auto p-3"><Board /></Card>
          <MetricsGrid compact />
        </div>
        <div className="flex flex-col gap-3 min-h-0">
          <Infra />
          <Card className="flex-1 min-h-0 overflow-hidden"><Chat readOnly /></Card>
        </div>
      </div>
    </main>
  );
}

export default function Game() {
  const s = useStore();
  const me = s.g.players[s.you];
  const spectator = !me || me.role === 'spectator';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Header />
      {spectator ? <SpectatorLayout /> : <PlayerLayout />}
      {s.g.phase === 'review' && <ReviewOverlay />}
    </div>
  );
}
