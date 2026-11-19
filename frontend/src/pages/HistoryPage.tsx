import { Link } from 'react-router'
import { api } from '../api/client'
import type { SessionState, SessionView } from '../api/types'
import { Alert, Badge, Button, PageTitle } from '../components/ui'
import { STATE_LABELS, styleLabel } from '../lib/labels'
import { pathForSession } from '../lib/sessionRoutes'
import { useLoad } from '../lib/useLoad'

const ACTIONS: Record<SessionState, string> = {
  PREPARING: 'Continue setup',
  CONFIGURING: 'Continue setup',
  READY: 'Start',
  IN_PROGRESS: 'Resume',
  PAUSED: 'Resume',
  EVALUATING: 'Resume',
  COMPLETED: 'View report',
}

const TONES: Record<SessionState, 'slate' | 'violet' | 'green' | 'amber'> = {
  PREPARING: 'slate',
  CONFIGURING: 'slate',
  READY: 'violet',
  IN_PROGRESS: 'violet',
  PAUSED: 'amber',
  EVALUATING: 'amber',
  COMPLETED: 'green',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function HistoryPage() {
  const loaded = useLoad((signal) => api.listSessions(signal), 'history')

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageTitle title="Your interviews" subtitle="Newest first. Pick up any interview where you left off." />
        <Link to="/new" className="bg-brand mb-6 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-300/50 hover:brightness-110">
          New interview
        </Link>
      </div>
      {loaded.loading && <p className="text-slate-500">Loading…</p>}
      {loaded.error && (
        <Alert title="Could not load your interviews" action={<Button variant="secondary" onClick={loaded.reload}>Try again</Button>}>
          {loaded.error.message}
        </Alert>
      )}
      {loaded.data?.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-500">
          No interviews yet. <Link to="/new" className="text-violet-600 hover:text-violet-700">Start your first one.</Link>
        </p>
      )}
      {loaded.data && loaded.data.length > 0 && (
        <ul className="space-y-3">
          {loaded.data.map((session) => (
            <HistoryItem key={session.id} session={session} />
          ))}
        </ul>
      )}
    </section>
  )
}

function HistoryItem({ session }: { session: SessionView }) {
  const planned = session.config?.question_count
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/70 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-slate-900">{session.context?.topic ?? 'Untitled interview'}</p>
          <Badge tone={TONES[session.state]}>{STATE_LABELS[session.state]}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {formatDate(session.created_at)}
          {session.config && ` · ${styleLabel(session.config.question_type)}`}
          {planned !== undefined && ` · ${session.questions_answered} of ${planned} answered`}
        </p>
      </div>
      <Link
        to={pathForSession(session.id, session.state, session.input_model)}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-violet-50"
      >
        {ACTIONS[session.state]}
      </Link>
    </li>
  )
}
