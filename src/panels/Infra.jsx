import { INFRA_NODES } from '../../shared/content.js';
import { Card, Badge, Dot, cx } from '../components/ui.jsx';
import { useStore } from '../lib/store.js';

// fixed topology layout (viewBox 500 x 300)
const POS = {
  cdn: [60, 60], lb: [180, 60], frontend: [300, 60],
  backend: [180, 150], cache: [60, 150], db: [300, 150],
  queue: [180, 240], payments: [300, 240], region: [60, 240],
};
const EDGES = [
  ['cdn', 'lb'], ['lb', 'frontend'], ['lb', 'backend'],
  ['backend', 'cache'], ['backend', 'db'], ['backend', 'queue'],
  ['backend', 'payments'], ['region', 'cdn'],
];

const STATUS = {
  ok: { fill: 'var(--dt-ok)', label: 'operational' },
  degraded: { fill: 'var(--dt-warn)', label: 'degraded' },
  down: { fill: 'var(--dt-danger)', label: 'down' },
};

function Node({ id, label, status }) {
  const [x, y] = POS[id];
  const st = STATUS[status] || STATUS.ok;
  const bad = status !== 'ok';
  return (
    <g transform={`translate(${x - 52}, ${y - 19})`}>
      <rect width="104" height="38" rx="10"
        className={cx('fill-[var(--dt-surface)]', bad ? '' : '')}
        stroke={bad ? st.fill : 'var(--dt-line)'} strokeWidth={bad ? 1.5 : 1} />
      <circle cx="14" cy="19" r="4" fill={st.fill}>
        {bad && <animate attributeName="opacity" values="1;0.25;1" dur="1.2s" repeatCount="indefinite" />}
      </circle>
      <text x="26" y="23" fontSize="11" fontWeight="600" fill="var(--dt-ink)">{label}</text>
    </g>
  );
}

export default function Infra() {
  const { g } = useStore();
  const infra = g.infra || {};
  const bad = INFRA_NODES.filter((n) => infra[n.id] && infra[n.id] !== 'ok');

  return (
    <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
      <Card className="p-2">
        <svg viewBox="0 0 380 290" className="w-full max-h-[340px]">
          {EDGES.map(([a, b]) => (
            <line key={`${a}${b}`}
              x1={POS[a][0]} y1={POS[a][1]} x2={POS[b][0]} y2={POS[b][1]}
              stroke="var(--dt-line-strong)" strokeWidth="1" strokeDasharray="3 3" />
          ))}
          {INFRA_NODES.map((n) => (
            <Node key={n.id} id={n.id} label={n.label} status={infra[n.id] || 'ok'} />
          ))}
        </svg>
      </Card>

      {bad.length === 0 ? (
        <Card className="p-3 flex items-center gap-2 text-sm text-ok">
          <Dot tone="ok" /> All systems operational
        </Card>
      ) : (
        <Card className="p-3 space-y-2">
          {bad.map((n) => (
            <div key={n.id} className="flex items-center justify-between text-sm">
              <span className="font-medium">{n.label}</span>
              <Badge tone={infra[n.id] === 'down' ? 'danger' : 'warn'}>
                {STATUS[infra[n.id]].label}
              </Badge>
            </div>
          ))}
          {g.incident && (
            <div className="text-xs text-subtle border-t border-line pt-2">
              🚨 <span className="font-semibold">{g.incident.title}</span> — resolve it from the mission panel checklist.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
