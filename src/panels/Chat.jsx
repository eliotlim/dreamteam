import { useState } from 'react';
import { Avatar, Input, Button, cx } from '../components/ui.jsx';
import { sendChat } from '../lib/net.js';
import { useAutoScroll } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';

function timeShort(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Chat({ readOnly = false }) {
  const s = useStore();
  const g = s.g;
  const [text, setText] = useState('');
  const scrollRef = useAutoScroll(g.chat.length);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    sendChat(t);
    setText('');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-line flex items-center gap-2 shrink-0">
        <span className="text-faint font-bold">#</span>
        <span className="text-sm font-semibold">dreamteam</span>
        <span className="text-xs text-faint">— where shipping happens</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5 min-h-0">
        {g.chat.map((m) => (
          <div key={m.id} className="flex gap-2.5 text-sm animate-pop">
            {m.bot ? (
              <span className="size-8 shrink-0 rounded-lg bg-raised border border-line flex items-center justify-center text-base">
                {m.icon}
              </span>
            ) : (
              <Avatar name={m.from} role={m.role} />
            )}
            <div className="min-w-0">
              <span className={cx('font-bold mr-2', m.bot && 'text-accent')}>
                {m.from}
                {m.bot && <span className="ml-1.5 text-[9px] font-bold bg-raised border border-line rounded px-1 py-px text-faint align-middle">APP</span>}
              </span>
              <span className="text-[11px] text-faint tabular-nums">{timeShort(m.ts)}</span>
              <div className="text-ink/90 break-words leading-snug">{m.text}</div>
            </div>
          </div>
        ))}
        {g.chat.length === 0 && (
          <div className="text-center text-faint text-xs py-6">It's quiet. Too quiet.</div>
        )}
      </div>

      {!readOnly && (
        <div className="p-2.5 border-t border-line flex gap-2 shrink-0">
          <Input
            className="flex-1 h-9"
            placeholder="Message #dreamteam"
            value={text}
            maxLength={300}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Button size="sm" className="h-9" onClick={submit} disabled={!text.trim()}>Send</Button>
        </div>
      )}
    </div>
  );
}
