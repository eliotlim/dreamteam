import { useMemo } from 'react';
import { ReactFlow, Background, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SERVICES, SERVICE_EDGES } from '../../shared/content.js';
import { Card, Badge, cx } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';
import { IncidentCard } from './Missions.jsx';
import { useNow } from '../lib/hooks.js';

const STATUS_STYLE = {
  ok:       { dot: 'bg-ok',     border: 'border-line' },
  degraded: { dot: 'bg-warn animate-pulse',   border: 'border-warn' },
  down:     { dot: 'bg-danger animate-pulse', border: 'border-danger' },
};

function ServiceNode({ data }) {
  const st = STATUS_STYLE[data.status] || STATUS_STYLE.ok;
  return (
    <div className={cx(
      'w-[148px] rounded-xl border bg-surface px-3 py-2 shadow-sm transition-colors',
      st.border, data.status === 'down' && 'bg-danger-soft',
    )}>
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !size-1" />
      <div className="flex items-center gap-1.5">
        <span className={cx('size-2 rounded-full shrink-0', st.dot)} />
        <span className="text-xs font-semibold text-ink truncate">{data.icon} {data.label}</span>
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

export default function Infra({ full = false }) {
  const { g } = useStore();
  const now = useNow(500);
  const services = g.services || [];
  const nodes = g.nodes || {};

  const flowNodes = useMemo(() => {
    const byTier = {};
    return services.map((id) => {
      const def = SERVICES[id];
      const tierIdx = (byTier[def.tier] = (byTier[def.tier] ?? -1) + 1);
      return {
        id,
        type: 'service',
        position: { x: TIER_X[def.tier], y: tierIdx * 92 + (def.tier === 2 ? 46 : 0) },
        data: {
          label: def.label, icon: def.icon,
          status: nodes[id]?.s || 'ok', stat: nodes[id]?.v,
        },
        draggable: false, connectable: false, selectable: false,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, nodes]);

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
    <div className="flex flex-col gap-3 h-full min-h-0">
      <Card className={cx('overflow-hidden shrink-0', full ? 'flex-1 min-h-[260px]' : 'h-[300px] sm:h-[340px]')}>
        <ReactFlow
          key={services.join('|')}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={18} size={1} color="var(--dt-line)" />
        </ReactFlow>
      </Card>

      <IncidentCard incident={g.incident} now={now} compact />

      <Card className="p-3 shrink-0">
        {bad.length === 0 ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-ok">
              <span className="size-2 rounded-full bg-ok" /> All {services.length} services operational
            </span>
            <span className="text-xs text-faint">ship epics to grow the platform</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {bad.map((id) => (
              <div key={id} className="flex items-center justify-between text-sm">
                <span className="font-medium">{SERVICES[id].icon} {SERVICES[id].label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs font-mono text-subtle">{nodes[id]?.v}</span>
                  <Badge tone={nodes[id].s === 'down' ? 'danger' : 'warn'}>{nodes[id].s}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
