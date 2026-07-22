import { useEffect, useState } from 'react';

// DreamTeam design system — minimalist primitives on semantic tokens.
// Tones: neutral | accent | ok | warn | danger | info

export const cx = (...xs) => xs.filter(Boolean).join(' ');

const TONE_TEXT = {
  neutral: 'text-subtle', accent: 'text-accent', ok: 'text-ok',
  warn: 'text-warn', danger: 'text-danger', info: 'text-info',
};
const TONE_SOFT = {
  neutral: 'bg-raised text-subtle', accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info',
};
const TONE_SOLID = {
  neutral: 'bg-ink', accent: 'bg-accent', ok: 'bg-ok',
  warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info',
};

// ---------------------------------------------------------------- Button

const BTN_VARIANTS = {
  primary: 'bg-accent text-on-accent hover:opacity-90 active:scale-[0.98] shadow-sm',
  subtle: 'bg-raised text-ink hover:bg-line active:scale-[0.98]',
  ghost: 'text-subtle hover:text-ink hover:bg-raised',
  danger: 'bg-danger text-white hover:opacity-90 active:scale-[0.98]',
  outline: 'border border-line-strong text-ink hover:bg-raised active:scale-[0.98]',
};
const BTN_SIZES = {
  sm: 'h-8 px-3 text-xs rounded-lg',
  md: 'h-10 px-4 text-sm rounded-xl',
  lg: 'h-12 px-6 text-base rounded-xl',
};

export function Button({ variant = 'primary', size = 'md', className, ...props }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 font-medium transition-all',
        'disabled:opacity-40 disabled:pointer-events-none select-none cursor-pointer',
        BTN_VARIANTS[variant], BTN_SIZES[size], className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({ className, ...props }) {
  return <div className={cx('bg-surface border border-line rounded-2xl', className)} {...props} />;
}

export function SectionLabel({ className, children }) {
  return (
    <div className={cx('text-[11px] font-semibold uppercase tracking-widest text-faint', className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- badges & stats

export function Badge({ tone = 'neutral', className, children }) {
  return (
    <span className={cx(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
      TONE_SOFT[tone], className,
    )}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse, className }) {
  return (
    <span className={cx(
      'inline-block size-2 rounded-full', TONE_SOLID[tone],
      pulse && 'animate-pulse', className,
    )} />
  );
}

export function Stat({ label, value, tone = 'neutral', className }) {
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
      <span className={cx('text-xl font-bold tabular-nums leading-none', TONE_TEXT[tone] === 'text-subtle' ? 'text-ink' : TONE_TEXT[tone])}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- progress

export function Progress({ value, tone = 'accent', className, animate = true }) {
  return (
    <div className={cx('h-1.5 rounded-full bg-line overflow-hidden', className)}>
      <div
        className={cx('h-full rounded-full', TONE_SOLID[tone], animate && 'transition-bar')}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- inputs

export function Input({ className, ...props }) {
  return (
    <input
      className={cx(
        'h-10 px-3.5 rounded-xl bg-surface border border-line text-sm text-ink',
        'placeholder:text-faint outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition',
        className,
      )}
      {...props}
    />
  );
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative w-11 h-6.5 rounded-full transition-colors cursor-pointer shrink-0',
        checked ? 'bg-accent' : 'bg-line-strong',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      <span className={cx(
        'absolute top-0.75 left-0.75 size-5 rounded-full bg-white shadow transition-transform',
        checked && 'translate-x-4.5',
      )} />
    </button>
  );
}

export function Seg({ options, value, onChange, size = 'md', className }) {
  return (
    <div className={cx('inline-flex p-0.5 rounded-xl bg-raised border border-line gap-0.5', className)}>
      {options.map((opt, i) => {
        const val = opt.value ?? i;
        const active = value === val;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cx(
              'rounded-[10px] font-medium transition-all cursor-pointer whitespace-nowrap',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active ? 'bg-surface text-ink shadow-sm border border-line' : 'text-subtle hover:text-ink',
            )}
          >
            {opt.label ?? opt}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- tabs

export function Tabs({ tabs, active, onChange, className }) {
  return (
    <div className={cx('flex gap-1 border-b border-line', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            'px-3.5 py-2 text-sm font-medium transition-colors relative cursor-pointer -mb-px',
            active === tab.id
              ? 'text-ink border-b-2 border-accent'
              : 'text-subtle hover:text-ink border-b-2 border-transparent',
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            {tab.label}
            {tab.count > 0 && (
              <span className="px-1.5 py-px rounded-full bg-danger text-white text-[10px] font-bold leading-4">
                {tab.count}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- avatar

const ROLE_COLORS = {
  pm: 'bg-purple-500', designer: 'bg-pink-500', engineer: 'bg-blue-500',
  ops: 'bg-emerald-500', spectator: 'bg-zinc-500',
};

export function Avatar({ name, role, size = 'md', className }) {
  const initials = (name || '?').split(/[_\s]/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span
      title={name}
      className={cx(
        'inline-flex items-center justify-center rounded-full text-white font-bold shrink-0',
        size === 'sm' ? 'size-6 text-[10px]' : size === 'lg' ? 'size-10 text-sm' : 'size-8 text-xs',
        ROLE_COLORS[role] || 'bg-zinc-500', className,
      )}
    >
      {initials}
    </span>
  );
}

// ---------------------------------------------------------------- theme toggle

export function ThemeToggle({ className }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('dt-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <Button variant="ghost" size="sm" className={className} onClick={() => setDark(!dark)}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      {dark ? '☀️' : '🌙'}
    </Button>
  );
}

// ---------------------------------------------------------------- overlay

export function Overlay({ children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="animate-pop w-full max-w-lg">{children}</div>
    </div>
  );
}
