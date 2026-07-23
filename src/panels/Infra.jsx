import { useMemo, useState } from 'react';
import { ReactFlow, Background, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SERVICES, SERVICE_EDGES, SERVICE_CONTROLS } from '../../shared/content.js';
import { Card, Badge, cx } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { IncidentCard } from './Missions.jsx';
import { ControlWidget } from './Controls.jsx';
import { useNow } from '../lib/hooks.js';

const STATUS_STYLE = {
  ok:       { dot: 'bg-ok',     border: 'border-line' },
  degraded: { dot: 'bg-warn animate-pulse',   border: 'border-warn' },
  down:     { dot: 'bg-danger animate-pulse', border: 'border-danger' },
};

function ServiceNode({ data }) {
  const st = STATUS_STYLE[data.status] || STATUS_STYLE.ok;
  return (
    <div
      className={cx(
        'w-[148px] rounded-xl border bg-surface px-3 py-2 shadow-sm transition-all cursor-pointer',
        'hover:shadow-md hover:border-accent/60',
        st.border, data.status === 'down' && 'bg-danger-soft',
        data.selected && 'ring-2 ring-accent border-accent',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !size-1" />
      <div className="flex items-center gap-1.5">
        <span className={cx('size-2 rounded-full shrink-0', st.dot)} />
        <span className="text-xs font-semibold text-ink truncate">{data.icon} {data.label}</span>
        {data.mine > 0 && (
          <span className="ml-auto text-[9px] font-bold text-accent shrink-0" title="you hold controls for this">🎛️{data.mine}</span>
        )}
      </div>
      <div className="text-[11px] font-mono tabular-nums text-subtle mt-0.5 h-4 truncate">
        {data.stat || '—'}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !size-1" />
    </div>
  );
}

const nodeTypes = { service: ServiceNode };

const TIER_X = [0, 210, 420, 640];

// Click a node → live detail stats + every control that operates this
// service: yours render as working widgets, the rest name who to shout at.
function NodeInspector({ id, onClose }) {
  const s = useStore();
  const g = s.g;
  const me = g.players[s.you];
  const def = SERVICES[id];
  const node = g.nodes?.[id] || {};
  const keys = SERVICE_CONTROLS[id] || [];

  const myControls = keys.map((k) => me?.controls?.find((c) => c.key === k)).filter(Boolean);
  const heldElsewhere = keys
    .filter((k) => !me?.controls?.some((c) => c.key === k))
    .map((k) => {
      const holders = Object.values(g.players).filter(
        (p) => p.connected && p.id !== s.you && p.controls?.some((c) => c.key === k),
      );
      if (!holders.length) return null;
      return { key: k, label: holders[0].controls.find((c) => c.key === k).label, names: holders.map((h) => h.name) };
    })
    .filter(Boolean);

  return (
    <Card className="p-3.5 space-y-3 animate-pop shrink-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm">{def.icon} {def.label}</span>
        <span className="flex items-center gap-2">
          <Badge tone={node.s === 'down' ? 'danger' : node.s === 'degraded' ? 'warn' : 'ok'}>
            {node.s || 'ok'}
          </Badge>
          <button className="text-subtle hover:text-ink text-sm cursor-pointer px-1" onClick={onClose} title="close">✕</button>
        </span>
      </div>

      {node.d?.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {node.d.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-1.5 text-xs min-w-0">
              <span className="text-faint">{label}</span>
              <span className="font-mono tabular-nums text-ink font-semibold truncate">{value}</span>
            </div>
          ))}
        </div>
      )}

      {myControls.length > 0 && (
        <div className="pt-2 border-t border-line divide-y divide-line/60">
          {myControls.map((c) => <ControlWidget key={c.key} c={c} />)}
        </div>
      )}

      {heldElsewhere.length > 0 && (
        <div className={cx('flex flex-wrap gap-1.5', myControls.length > 0 && 'pt-1')}>
          {heldElsewhere.map(({ key, label, names }) => (
            <span key={key} className="text-[11px] px-2 py-1 rounded-lg bg-raised text-subtle">
              {label} → <span className="font-semibold text-ink">{names.join(', ')}</span> 📣
            </span>
          ))}
        </div>
      )}

      {myControls.length === 0 && heldElsewhere.length === 0 && keys.length === 0 && (
        <p className="text-xs text-faint">No operable controls — this one just hums along.</p>
      )}
    </Card>
  );
}

export default function Infra({ full = false }) {
  const s = useStore();
  const { g } = s;
  const now = useNow(500);
  const [sel, setSel] = useState(null);
  const services = g.services || [];
  const nodes = g.nodes || {};
  const me = g.players[s.you];
  const selected = sel && services.includes(sel) ? sel : null;

  const flowNodes = useMemo(() => {
    const byTier = {};
    return services.map((id) => {
      const def = SERVICES[id];
      const tierIdx = (byTier[def.tier] = (byTier[def.tier] ?? -1) + 1);
      const mine = (SERVICE_CONTROLS[id] || []).filter(
        (k) => me?.controls?.some((c) => c.key === k),
      ).length;
      return {
        id,
        type: 'service',
        position: { x: TIER_X[def.tier], y: tierIdx * 92 + (def.tier === 2 ? 46 : 0) },
        data: {
          label: def.label, icon: def.icon,
          status: nodes[id]?.s || 'ok', stat: nodes[id]?.v,
          selected: selected === id, mine,
        },
        draggable: false, connectable: false,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, nodes, selected, me?.controls]);

  const flowEdges = useMemo(() =>
    SERVICE_EDGES
      .filter(([a, b]) => services.includes(a) && services.includes(b))
      .map(([a, b]) => {
        const bad = (nodes[a]?.s === 'down') || (nodes[b]?.s === 'down');
        return {
          id: `${a}-${b}`, source: a, target: b,
          animated: !bad,
          style: {
            stroke: bad ? 'var(--dt-danger)' : 'var(--dt-line-strong)',
            strokeWidth: bad ? 2 : 1.25,
          },
        };
      }),
    [services, nodes]);

  const bad = services.filter((id) => nodes[id]?.s && nodes[id].s !== 'ok');

  return (
    <div className="flex flex-col gap-3 h-full min-h-0 overflow-y-auto">
      <Card className={cx('overflow-hidden shrink-0', full ? 'flex-1 min-h-[260px]' : 'h-[300px] sm:h-[340px]')}>
        <ReactFlow
          key={`${services.join('|')}${selected ? '+inspect' : ''}`}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          onInit={(inst) => setTimeout(() => inst.fitView({ padding: 0.15 }), 80)}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, n) => setSel((cur) => (cur === n.id ? null : n.id))}
          onPaneClick={() => setSel(null)}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={18} size={1} color="var(--dt-line)" />
        </ReactFlow>
      </Card>

      {selected && <NodeInspector id={selected} onClose={() => setSel(null)} />}

      <IncidentCard incident={g.incident} now={now} compact />

      <Card className="p-3 shrink-0">
        {bad.length === 0 ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ok">
              <span className="size-2 rounded-full bg-ok" /> All {services.length} services operational
            </span>
            <span className="text-xs text-faint">tap a node to inspect & operate it</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {bad.map((id) => (
              <button key={id} onClick={() => setSel(id)}
                className="w-full flex items-center justify-between text-sm cursor-pointer hover:bg-raised rounded-lg px-1.5 py-0.5 -mx-1.5">
                <span className="font-medium">{SERVICES[id].icon} {SERVICES[id].label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-mono text-subtle">{nodes[id]?.v}</span>
                  <Badge tone={nodes[id].s === 'down' ? 'danger' : 'warn'}>{nodes[id].s}</Badge>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
