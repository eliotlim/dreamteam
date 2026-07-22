import { useState } from 'react';
import { Card, Switch, Seg, Button, SectionLabel, cx } from '../components/ui.jsx';
import { setControl, pressButton } from '../lib/net.js';
import { useStore } from '../lib/store.js';

function ToggleControl({ c }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{c.label}</span>
      <div className="flex items-center gap-2">
        <span className={cx('text-[10px] font-bold w-7 text-right', c.value ? 'text-ok' : 'text-faint')}>
          {c.value ? 'ON' : 'OFF'}
        </span>
        <Switch checked={!!c.value} onChange={(on) => setControl(c.key, on ? 1 : 0)} />
      </div>
    </div>
  );
}

function SliderControl({ c }) {
  const [local, setLocal] = useState(null);
  const shown = local ?? c.value;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{c.label}</span>
        <span className="text-sm font-bold tabular-nums text-accent">{shown}</span>
      </div>
      <input
        type="range" min={0} max={c.max} step={1} value={shown}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => { if (local != null) { setControl(c.key, local); setLocal(null); } }}
        onKeyUp={() => { if (local != null) { setControl(c.key, local); setLocal(null); } }}
      />
      <div className="flex justify-between text-[10px] text-faint tabular-nums px-0.5">
        <span>0</span><span>{c.max}</span>
      </div>
    </div>
  );
}

function SelectControl({ c }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium block">{c.label}</span>
      <Seg
        size="sm"
        options={c.options.map((o, i) => ({ value: i, label: o }))}
        value={c.value}
        onChange={(v) => setControl(c.key, v)}
        className="flex-wrap"
      />
    </div>
  );
}

function ButtonControl({ c }) {
  const [flash, setFlash] = useState(false);
  return (
    <Button
      variant="subtle"
      className={cx('w-full border border-line-strong font-semibold', flash && 'bg-accent text-on-accent')}
      onClick={() => {
        pressButton(c.key);
        setFlash(true);
        setTimeout(() => setFlash(false), 250);
      }}
    >
      {c.label}
    </Button>
  );
}

const WIDGET = { toggle: ToggleControl, slider: SliderControl, select: SelectControl, button: ButtonControl };

export default function Controls() {
  const s = useStore();
  const me = s.g.players[s.you];
  if (!me || me.role === 'spectator' || !me.controls?.length) return null;

  return (
    <Card className="p-4 space-y-1">
      <SectionLabel className="mb-2">Your console</SectionLabel>
      <div className="space-y-4">
        {me.controls.map((c) => {
          const W = WIDGET[c.type];
          return <div key={c.key}>{W ? <W c={c} /> : null}</div>;
        })}
      </div>
    </Card>
  );
}
