import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-violet-600 text-white hover:bg-violet-500 disabled:bg-violet-600/50',
  secondary: 'border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800 disabled:text-slate-500',
  danger: 'border border-red-900 bg-red-950/60 text-red-200 hover:bg-red-900/60 disabled:text-red-200/50',
}

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      role="status"
      aria-label="Loading"
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 ${className}`}>{children}</div>
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      {subtitle && <p className="mt-1 text-slate-400">{subtitle}</p>}
    </div>
  )
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-200">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function Alert({
  kind = 'error',
  title,
  children,
  action,
}: {
  kind?: 'error' | 'info' | 'warning'
  title?: string
  children: ReactNode
  action?: ReactNode
}) {
  const styles = {
    error: 'border-red-900 bg-red-950/50 text-red-100',
    warning: 'border-amber-900 bg-amber-950/40 text-amber-100',
    info: 'border-sky-900 bg-sky-950/40 text-sky-100',
  }[kind]
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : ''}>{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'violet' | 'green' | 'amber' }) {
  const tones = {
    slate: 'bg-slate-800 text-slate-200',
    violet: 'bg-violet-900/60 text-violet-200',
    green: 'bg-emerald-900/60 text-emerald-200',
    amber: 'bg-amber-900/60 text-amber-200',
  }
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}
