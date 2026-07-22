import { Card, Button, Stat, ThemeToggle, SectionLabel } from '../components/ui.jsx';
import { restartGame } from '../lib/net.js';
import { useStore } from '../lib/store.js';

export default function Retro() {
  const s = useStore();
  const g = s.g;
  const me = g.players[s.you];
  const st = g.stats;

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex justify-end p-4"><ThemeToggle /></header>
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="text-6xl">{g.victory ? '🏆' : '🪦'}</div>
            <h1 className="text-3xl font-bold">
              {g.victory ? 'You shipped it!' : 'The startup ran out of runway'}
            </h1>
            <p className="text-subtle">
              {g.victory
                ? `${g.config.sprintCount} sprints survived. The roadmap is a smoking crater of success.`
                : 'Team health hit zero. The post-mortem will be blameless. Mostly.'}
            </p>
            <div className="text-5xl font-bold text-accent tabular-nums pt-2">{g.score}</div>
            <SectionLabel>final score</SectionLabel>
          </div>

          <Card className="p-6 space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <Stat label="Shipped" value={st.shipped} tone="accent" />
              <Stat label="Bugs fixed" value={st.bugsFixed} tone="ok" />
              <Stat label="Incidents" value={st.incidentsResolved} tone="warn" />
              <Stat label="Missed" value={st.missed} tone="danger" />
            </div>

            {st.sprints?.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-faint text-[11px] uppercase tracking-wider">
                    <th className="text-left font-semibold py-1">Sprint</th>
                    <th className="text-right font-semibold">Shipped</th>
                    <th className="text-right font-semibold">Bugs</th>
                    <th className="text-right font-semibold">Incidents</th>
                    <th className="text-right font-semibold">Points</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {st.sprints.map((sp) => (
                    <tr key={sp.sprint} className="border-t border-line">
                      <td className="py-1.5">Sprint {sp.sprint}</td>
                      <td className="text-right">{sp.shipped}</td>
                      <td className="text-right">{sp.bugsFixed}</td>
                      <td className="text-right">{sp.incidentsResolved}</td>
                      <td className="text-right font-semibold text-accent">+{sp.scoreDelta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {me?.isHost ? (
            <Button size="lg" className="w-full" onClick={restartGame}>
              Back to lobby — run it back
            </Button>
          ) : (
            <p className="text-center text-subtle text-sm">Waiting for the host to restart…</p>
          )}
        </div>
      </main>
    </div>
  );
}
