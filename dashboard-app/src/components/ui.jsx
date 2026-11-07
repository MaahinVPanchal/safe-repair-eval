import { cn } from '../lib/utils'

/* shadcn-style primitives, hand-written for this app (no CLI needed).
   Tokens come from index.css and auto-switch light/dark. */

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-card shadow-sm transition-colors',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function Button({ variant = 'primary', size, className, children, ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all',
        'disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        variant === 'primary' && 'border border-fg bg-fg text-bg hover:-translate-y-px hover:shadow-md',
        variant === 'secondary' && 'border border-line bg-card text-fg hover:bg-subtle',
        variant === 'ghost' && 'text-accent hover:bg-subtle',
        size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-sm',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg',
        'transition-colors placeholder:text-faint',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
        className
      )}
      {...props}
    />
  )
}

export function Badge({ kind = 'neutral', className, children }) {
  const tones = {
    pass: 'bg-ok/15 text-ok',
    fail: 'bg-bad/15 text-bad',
    unexecuted: 'bg-subtle text-muted',
    repair: 'bg-accent/10 text-accent',
    report: 'bg-warn/15 text-warn',
    escalate: 'bg-[#efe7f8] text-[#6633aa] dark:bg-[#2a2140] dark:text-[#c4a5f7]',
    you: 'bg-accent/10 text-accent',
    builtin: 'bg-ok/15 text-ok',
    neutral: 'bg-subtle text-muted'
  }
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap', tones[kind] || tones.neutral, className)}>
      {children}
    </span>
  )
}

export function Dot({ tone }) {
  const tones = { pass: 'bg-ok', fail: 'bg-bad', unexec: 'bg-faint', notrun: 'border border-dashed border-faint' }
  return <i className={cn('mr-1.5 inline-block h-2 w-2 rounded-full align-middle', tones[tone] || tones.unexec)} />
}
