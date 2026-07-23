import { useState } from 'react';
import { Button, Card, Input, ThemeToggle, SectionLabel } from '../components/ui.jsx';
import { createRoom, roomInfo, connect } from '../lib/net.js';
import { useStore } from '../lib/store.js';

export default function Landing() {
  const s = useStore();
  const [name, setName] = useState(() => localStorage.getItem('dt-name') || '');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [pass, setPass] = useState('');
  const [needPass, setNeedPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const saveName = () => {
    const n = name.trim();
    if (n) localStorage.setItem('dt-name', n);
    return n;
  };

  const onCreate = async () => {
    setBusy(true); setErr(null);
    try {
      const roomCode = await createRoom();
      connect(roomCode, saveName());
      history.replaceState(null, '', `/?room=${roomCode}`);
    } catch {
      setErr('Could not create a room. Try again.');
      setBusy(false);
    }
  };

  const onJoin = async () => {
    const c = code.trim().toUpperCase();
    if (c.length !== 4) { setErr('Room codes are 4 letters.'); return; }
    setBusy(true); setErr(null);
    const info = await roomInfo(c, pass).catch(() => ({ exists: false }));
    if (!info.exists) {
      setErr(`Room ${c} doesn't exist.`);
      setBusy(false);
      return;
    }
    if (info.hasPassword && !info.passOk) {
      setNeedPass(true);
      setErr(pass ? 'Wrong password.' : 'This room is password-protected.');
      setBusy(false);
      return;
    }
    connect(c, saveName(), pass);
    history.replaceState(null, '', `/?room=${c}`);
  };

  const connecting = busy || s.status === 'connecting' || s.status === 'reconnecting';

  return (
    <div className="h-full flex flex-col">
      <header className="relative z-10 flex justify-end p-4"><ThemeToggle /></header>
      <main className="flex-1 flex items-center justify-center p-6 -mt-16">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-3">
            <div className="text-5xl">🚀</div>
            <h1 className="text-3xl font-bold tracking-tight">DreamTeam</h1>
            <p className="text-subtle text-sm leading-relaxed">
              A co-op party game about surviving the product development cycle.
              Ship features, squash bugs, resolve incidents — by shouting at your team.
            </p>
          </div>

          <Card className="p-5 space-y-5">
            <div className="space-y-2">
              <SectionLabel>Your name</SectionLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. turbo_narwhal (random if blank)"
                maxLength={24}
                className="w-full"
              />
            </div>

            <Button size="lg" className="w-full" onClick={onCreate} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Create a team'}
            </Button>

            <div className="flex items-center gap-3 text-faint text-xs">
              <div className="flex-1 h-px bg-line" /> or <div className="flex-1 h-px bg-line" />
            </div>

            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setNeedPass(false); setPass(''); }}
                onKeyDown={(e) => e.key === 'Enter' && onJoin()}
                placeholder="CODE"
                maxLength={4}
                className="w-28 text-center font-mono font-bold tracking-[0.3em] uppercase"
              />
              <Button variant="outline" className="flex-1" onClick={onJoin} disabled={connecting}>
                Join a team
              </Button>
            </div>

            {needPass && (
              <Input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onJoin()}
                placeholder="🔒 Room password"
                maxLength={32}
                autoFocus
                className="w-full"
              />
            )}

            {err && <p className="text-danger text-xs">{err}</p>}
          </Card>

          <p className="text-center text-faint text-xs">
            3–8 players + a projector for the spectator view. Same room, loud voices.
          </p>
        </div>
      </main>
    </div>
  );
}
