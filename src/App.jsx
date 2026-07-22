import { useEffect } from 'react';
import { useStore } from './lib/store.js';
import { tryResume } from './lib/net.js';
import Landing from './screens/Landing.jsx';
import Lobby from './screens/Lobby.jsx';
import Game from './screens/Game.jsx';
import Retro from './screens/Retro.jsx';

export default function App() {
  const s = useStore();
  useEffect(() => { if (s.status === 'idle') tryResume(); }, []);

  if (s.status === 'error') {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="text-4xl">📡</div>
          <p className="text-subtle">{s.error}</p>
        </div>
      </div>
    );
  }

  if (!s.g || s.status === 'idle' || s.status === 'connecting') return <Landing />;

  switch (s.g.phase) {
    case 'lobby': return <Lobby />;
    case 'ended': return <Retro />;
    default: return <Game />; // playing | review (review renders as overlay)
  }
}
