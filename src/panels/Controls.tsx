import { useState } from 'react';
import type { ComponentType } from 'react';
import { CONTROL_SERVICE } from '../../shared/content.ts';
import type { ControlInstance, ControlType } from '../../shared/types.ts';
import { Card, Switch, Seg, Button, SectionLabel, cx } from '../components/ui.tsx';
import { setControl, pressButton } from '../lib/net.ts';
import { useStore } from '../lib/store.ts';

// Every widget row has a fixed height so the console never shifts layout.

interface WidgetProps { c: ControlInstance }

function ToggleControl({ c }: WidgetProps) {
  return (
    <div className="h-12 flex items-center justify-between gap-3">
      <span className="text-sm font-medium truncate">{c.label}</span>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cx('text-[10px] font-bold w-7 text-right', c.value ? 'text-ok' : 'text-faint')}>
          {c.value ? 'ON' : 'OFF'}
        </span>
        <Switch checked={!!c.value} onChange={(on) => setControl(c.key, on ? 1 : 0)} />
      </div>
    </div>
  );
}

function SliderControl({ c }: WidgetProps) {
  const [local, setLocal] = useState<number | null>(null);
  const shown = local ?? c.value;
  const min = c.min ?? 0;
  const commit = () => { if (local != null) { setControl(c.key, local); setLocal(null); } };
  return (
    <div className="h-[76px] flex flex-col justify-center gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">{c.label}</span>
        <span className="text-sm font-bold tabular-nums text-accent w-6 text-right">{shown}</span>
      </div>
      <input
        type="range" min={min} max={c.max} step={1} value={shown}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onTouchEnd={commit}
      />
      <div className="flex justify-between text-[10px] text-faint tabular-nums px-0.5">
        <span>{min}</span><span>{c.max}</span>
      </div>
    </div>
  );
}

function SelectControl({ c }: WidgetProps) {
  return (
    <div className="h-[76px] flex flex-col justify-center gap-1.5">
      <span className="text-sm font-medium block truncate">{c.label}</span>
      <Seg
        size="sm"
        options={(c.options ?? []).map((o, i) => ({ value: i, label: o }))}
        value={c.value}
        onChange={(v) => setControl(c.key, v)}
        className="overflow-x-auto"
      />
    </div>
  );
}

function ButtonControl({ c }: WidgetProps) {
  const [flash, setFlash] = useState(false);
  return (
    <div className="h-14 flex items-center">
      <Button
        variant={flash ? 'primary' : 'action'}
        className="w-full font-semibold h-11"
        onClick={() => {
          pressButton(c.key);
          setFlash(true);
          setTimeout(() => setFlash(false), 250);
        }}
      >
        {c.label}
      </Button>
    </div>
  );
}

const WIDGET: Record<ControlType, ComponentType<WidgetProps>> = {
  toggle: ToggleControl, slider: SliderControl, select: SelectControl, button: ButtonControl,
};

// Single control widget by type — also used by the infra node inspector.
export function ControlWidget({ c }: WidgetProps) {
  const W = WIDGET[c.type];
  return W ? <W c={c} /> : null;
}

function Group({ label, controls }: { label: string; controls: ControlInstance[] }) {
  if (!controls.length) return null;
  return (
    <div>
      <SectionLabel className="mb-1">{label}</SectionLabel>
      <div className="divide-y divide-line/60">
        {controls.map((c) => {
          const W = WIDGET[c.type];
          return <div key={c.key}>{W ? <W c={c} /> : null}</div>;
        })}
      </div>
    </div>
  );
}

export default function Controls({ flat = false }: { flat?: boolean }) {
  const s = useStore();
  const g = s.g!;
  const me = s.you ? g.players[s.you] : undefined;
  if (!me || me.role === 'spectator' || !me.controls?.length) return null;

  // Arcade: the whole console lives on the dashboard. Assisted/realism: infra
  // controls are operated from their node on the infra map instead — the flat
  // console keeps only mission dials, plus any crit control whose service
  // isn't deployed yet (it has no node to live on). `flat` (mobile) forces
  // the arcade layout: diagrams are for looking at, not for tapping through.
  const arcade = flat || g.config.mode === 'arcade';
  const onMap = (c: ControlInstance) => CONTROL_SERVICE[c.key] && g.services.includes(CONTROL_SERVICE[c.key]);
  const ops = me.controls.filter((c) => c.crit && (arcade || !onMap(c)));
  const dials = me.controls.filter((c) => !c.crit);
  const movedToMap = !arcade && me.controls.some((c) => c.crit && onMap(c));

  return (
    <Card className="p-4 space-y-4">
      <Group label="⚙️ Ops console — keeps the site up" controls={ops} />
      <Group label="🎛️ Mission dials — missions target these" controls={dials} />
      {movedToMap && (
        <p className="text-xs text-faint">
          🏗️ Your infra controls live on the <span className="font-semibold">Infra map</span> — tap a service node to operate it.
        </p>
      )}
    </Card>
  );
}
