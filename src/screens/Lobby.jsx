import { useState } from 'react';
import { ROLE_META, INCIDENTS, INCIDENT_LABELS, SERVICES, MODES, CONTROL_POOL } from '../../shared/content.js';
import {
  Button, Card, Badge, Avatar, Switch, Seg, ThemeToggle, SectionLabel, Dot, cx,
} from '../components/ui.jsx';
import { setRole, setConfig, startGame } from '../lib/net.js';
import { useStore } from '../lib/store.js';

const ROLE_CHOICES = ['pm', 'designer', 'engineer', 'ops', 'spectator'];

const PRESET_BLURB = {
  chill: 'Slow pace, forgiving deadlines, 5 starting services.',
  standard: 'The intended experience. 7 starting services.',
  chaos: 'Fast, punishing, 8 starting services. Bring earplugs.',
  custom: 'Custom settings — you know what you did.',
};

function NumberSetting({ label, value, onChange, min, max, step = 1, suffix }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-subtle">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 sm:w-28"
        />
        <span className="text-sm font-semibold tabular-nums w-13 text-right">
          {value}{suffix}
        </span>
      </span>
    </label>
  );
}

function ToggleSetting({ label, desc, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="text-sm font-medium block">{label}</span>
        {desc && <span className="text-xs text-faint">{desc}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

export default function Lobby() {
  const s = useStore();
  const g = s.g;
  const me = g.players[s.you];
  const isHost = !!me?.isHost;
  const cfg = g.config;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);

  const players = Object.values(g.players).sort((a, b) => a.joinedAt - b.joinedAt || a.name.localeCompare(b.name));
  const activeCount = players.filter((p) => p.connected && p.role !== 'spectator').length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${g.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex items-center justify-between px-5 py-4 max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-2 font-bold text-lg">🚀 DreamTeam</div>
        <ThemeToggle />
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-5 pb-10 grid gap-5 md:grid-cols-[1fr_360px] content-start">
        {/* left: room + players */}
        <div className="space-y-5">
          <Card className="p-5 sm:p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <SectionLabel>Room code</SectionLabel>
              <div className="text-3xl sm:text-4xl font-mono font-bold tracking-[0.25em] mt-1">{g.code}</div>
            </div>
            <Button variant="outline" onClick={copyLink}>
              {copied ? 'Copied ✓' : 'Copy invite link'}
            </Button>
          </Card>

          <Card className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel>Team ({players.filter((p) => p.connected).length})</SectionLabel>
              {activeCount === 0 && <Badge tone="warn">need at least 1 non-spectator</Badge>}
            </div>
            <ul className="space-y-2.5">
              {players.map((p) => (
                <li key={p.id} className={cx('flex items-center gap-3', !p.connected && 'opacity-40')}>
                  <Avatar name={p.name} role={p.role} />
                  <span className="font-medium text-sm flex-1 truncate">
                    {p.name}
                    {p.id === s.you && <span className="text-faint"> (you)</span>}
                    {p.isHost && <Badge tone="accent" className="ml-2">host</Badge>}
                    {!p.connected && <span className="text-faint text-xs ml-2">offline</span>}
                  </span>
                  <span className="text-sm text-subtle whitespace-nowrap">
                    {ROLE_META[p.role].icon} <span className="hidden sm:inline">{ROLE_META[p.role].label}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="pt-2 border-t border-line space-y-2">
              <SectionLabel>Your role</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_CHOICES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={cx(
                      'px-3 py-2 rounded-xl text-sm font-medium border transition cursor-pointer',
                      me?.role === r
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-subtle hover:text-ink hover:bg-raised',
                    )}
                  >
                    {ROLE_META[r].icon} {ROLE_META[r].label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-faint">
                Spectator gets a dashboard for the projector — no controls, all the drama.
              </p>
            </div>
          </Card>

          {isHost ? (
            <Button size="lg" className="w-full" onClick={startGame} disabled={activeCount === 0}>
              Start sprint 1 →
            </Button>
          ) : (
            <div className="text-center text-subtle text-sm py-3 flex items-center justify-center gap-2">
              <Dot tone="accent" pulse /> waiting for the host to start…
            </div>
          )}
        </div>

        {/* right: settings */}
        <Card className="p-5 sm:p-6 space-y-4 h-fit">
          <div className="flex items-center justify-between">
            <SectionLabel>Game settings</SectionLabel>
            {!isHost && <Badge>host only</Badge>}
          </div>

          <div className={cx(!isHost && 'opacity-60 pointer-events-none', 'space-y-1')}>
            <Seg
              options={[
                { value: 'chill', label: '🌴 Chill' },
                { value: 'standard', label: '⚡ Standard' },
                { value: 'chaos', label: '🔥 Chaos' },
              ]}
              value={cfg.preset}
              onChange={(preset) => setConfig({ preset })}
              className="w-full justify-center"
              size="sm"
            />
            <p className="text-xs text-faint pt-1 pb-2 min-h-9">{PRESET_BLURB[cfg.preset] || PRESET_BLURB.custom}</p>

            <div className="border-t border-line pt-3 pb-1 space-y-1">
              <SectionLabel>Mode</SectionLabel>
              <Seg
                options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }))}
                value={cfg.mode}
                onChange={(mode) => setConfig({ mode })}
                className="w-full justify-center"
                size="sm"
              />
              <p className="text-xs text-faint pt-1 min-h-9">{MODES[cfg.mode]?.blurb}</p>
            </div>

            <div className="border-t border-line">
              <NumberSetting label="Sprints" value={cfg.sprintCount} min={1} max={10}
                onChange={(v) => setConfig({ sprintCount: v })} />
            </div>

            <div className="divide-y divide-line border-t border-line">
              <ToggleSetting label="Bot chatter" desc="ceo-dave & customer-support in chat"
                checked={cfg.botChatter} onChange={(on) => setConfig({ botChatter: on })} />
              <ToggleSetting label="Mega mode" desc="crowd play: dials are duplicated across screens and missions need a quorum of teammates"
                checked={!!cfg.megaMode} onChange={(on) => setConfig({ megaMode: on })} />
              {activeCount > 6 && !cfg.megaMode && (
                <p className="text-xs text-accent py-2">
                  👥 {activeCount} players — that's a crowd. Mega mode was made for this.
                </p>
              )}
            </div>

            <button
              className="text-xs text-accent font-medium cursor-pointer pt-3"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? '− Hide' : '+ Show'} advanced
            </button>

            {showAdvanced && (
              <div className="space-y-4 animate-pop pt-2">
                <div className="divide-y divide-line">
                  <NumberSetting label="Sprint length" value={cfg.sprintSeconds} min={60} max={300} step={15} suffix="s"
                    onChange={(v) => setConfig({ sprintSeconds: v })} />
                  <NumberSetting label="New task every" value={cfg.taskEverySec} min={3} max={20} suffix="s"
                    onChange={(v) => setConfig({ taskEverySec: v })} />
                  <NumberSetting label="Task deadline" value={cfg.taskDeadlineSec} min={10} max={60} step={5} suffix="s"
                    onChange={(v) => setConfig({ taskDeadlineSec: v })} />
                  <NumberSetting label="Incident every" value={cfg.incidentEverySec} min={20} max={120} step={5} suffix="s"
                    onChange={(v) => setConfig({ incidentEverySec: v })} />
                  <NumberSetting label="Incident deadline" value={cfg.incidentDeadlineSec} min={20} max={180} step={10} suffix="s"
                    onChange={(v) => setConfig({ incidentDeadlineSec: v })} />
                  <NumberSetting label="Traffic spike ×" value={cfg.spikeMult} min={2} max={8}
                    onChange={(v) => setConfig({ spikeMult: v })} />
                  <NumberSetting label="Controls per player" value={cfg.controlsPerPlayer} min={2} max={8}
                    onChange={(v) => setConfig({ controlsPerPlayer: v })} />
                  <NumberSetting label="Max tasks per player" value={cfg.maxActivePerPlayer} min={1} max={4}
                    onChange={(v) => setConfig({ maxActivePerPlayer: v })} />
                  <NumberSetting label="Bug ratio" value={cfg.bugChance} min={0} max={1} step={0.05}
                    onChange={(v) => setConfig({ bugChance: v })} />
                  <NumberSetting label="Code review ratio" value={cfg.codeChance} min={0} max={0.6} step={0.05}
                    onChange={(v) => setConfig({ codeChance: v })} />
                  <NumberSetting label="Triage ratio" value={cfg.triageChance} min={0} max={0.6} step={0.05}
                    onChange={(v) => setConfig({ triageChance: v })} />
                  <NumberSetting label="Miss penalty" value={cfg.missPenalty} min={0} max={25} suffix=" hp"
                    onChange={(v) => setConfig({ missPenalty: v })} />
                  <NumberSetting label="Incident drain" value={cfg.incidentDrainPerSec} min={0} max={3} step={0.1} suffix="/s"
                    onChange={(v) => setConfig({ incidentDrainPerSec: v })} />
                  <NumberSetting label="Difficulty ramp" value={cfg.difficultyRamp} min={0} max={1} step={0.05}
                    onChange={(v) => setConfig({ difficultyRamp: v })} />
                </div>

                <div className="space-y-1">
                  <SectionLabel>Incident types</SectionLabel>
                  {Object.keys(INCIDENTS).map((k) => (
                    <label key={k} className="flex items-center justify-between py-1">
                      <span className="text-sm text-subtle">
                        {INCIDENT_LABELS[k] || k}
                        {INCIDENTS[k].requires && (
                          <span className="text-xs text-faint"> (needs {SERVICES[INCIDENTS[k].requires].label})</span>
                        )}
                        {INCIDENTS[k].requiresControl && (
                          <span className="text-xs text-faint">
                            {' '}(needs “{CONTROL_POOL.find((c) => c.key === INCIDENTS[k].requiresControl)?.label}” dealt)
                          </span>
                        )}
                      </span>
                      <Switch
                        checked={!!cfg.incidents[k]}
                        onChange={(on) => setConfig({ incidents: { [k]: on } })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
