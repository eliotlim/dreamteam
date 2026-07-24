import { useEffect, useRef, useState } from 'react';
import { serverNow } from './store.ts';

// server-adjusted clock, ticking every `ms`
export function useNow(ms = 500): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function fmtClock(msRemaining: number): string {
  const s = Math.max(0, Math.ceil(msRemaining / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// keep a scrollable element pinned to the bottom as content streams in
export function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}
