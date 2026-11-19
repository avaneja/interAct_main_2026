import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { SessionView } from '../api/types'
import { Alert, Badge, Button, Card, PageTitle } from '../components/ui'
import WaitingNotice from '../components/WaitingNotice'
import { difficultyLabel, styleLabel } from '../lib/labels'
import { pathForSession } from '../lib/sessionRoutes'
import { useLoad } from '../lib/useLoad'

export default function PlanPage() {
  const { id = '' } = useParams()
  const loaded = useLoad((signal) => api.getSession(id, signal), id)

  if (loaded.loading) return <p className="text-slate-500">Loading…</p>
  if (loaded.error || !loaded.data) {
    return (
      <Alert title="Could not load this interview" action={<Button variant="secondary" onClick={loaded.reload}>Try again</Button>}>
        {loaded.error?.message}
      </Alert>
    )
  }
  const session = loaded.data
  if (!['CONFIGURING', 'READY'].includes(session.state) || !session.config) {
    return <Navigate to={pathForSession(session.id, session.state, session.input_model)} replace />
  }
  return <PlanReview session={session} />
}

function PlanReview({ session }: { session: SessionView }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'starting'>('idle')
  const [startedAt, setStartedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // A confirmed plan is fixed, even if starting then fails: only "Start" remains.
  const [confirmed, setConfirmed] = useState(session.state === 'READY')
  const context = session.context!
  const config = session.config!

  async function begin() {
    setError(null)
    try {
      if (!confirmed) {
        setPhase('confirming')
        await api.confirmPlan(session.id)
        setConfirmed(true)
      }
      setPhase('starting')
      setStartedAt(Date.now())
      await api.start(session.id)
      navigate(`/sessions/${session.id}/interview`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
      setPhase('idle')
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <PageTitle
        title={confirmed ? 'Your plan is confirmed' : 'Review your interview plan'}
        subtitle={confirmed ? 'Start whenever you are ready.' : 'Check everything below. Once you start, the plan is fixed.'}
      />

      <Card className="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Topic</h2>
          <p className="mt-1 text-lg text-slate-900">{context.topic}</p>
          {context.goal && <p className="text-sm text-slate-600">Goal: {context.goal}</p>}
          {context.level && <p className="text-sm text-slate-600">Your level: {difficultyLabel(context.level)}</p>}
          {context.subtopics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {context.subtopics.map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Settings</h2>
          <dl className="mt-1 space-y-1 text-sm text-slate-700">
            <div>
              <dt className="inline text-slate-500">Style: </dt>
              <dd className="inline">{styleLabel(config.question_type)}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Difficulty: </dt>
              <dd className="inline">{difficultyLabel(config.difficulty)}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Questions: </dt>
              <dd className="inline">{config.question_count}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Mode: </dt>
              <dd className="inline">{config.adaptive ? 'Adaptive (follow-ups, revisits weak areas)' : 'Fixed order, no follow-ups'}</dd>
            </div>
            <div>
              <dt className="inline text-slate-500">Feedback: </dt>
              <dd className="inline">At the end</dd>
            </div>
          </dl>
        </div>
      </Card>

      {session.plan && (
        <Card>
          <h2 className="font-semibold text-slate-900">Questions you will be asked</h2>
          <ol className="mt-3 divide-y divide-slate-100">
            {session.plan.map((planned) => (
              <li key={planned.sequence} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-600">
                  <span className="mr-2 text-slate-400">{planned.sequence}.</span>
                  {planned.competency}
                </span>
                <Badge tone="violet">{styleLabel(planned.question_type)}</Badge>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {error && <Alert title="Could not start the interview">{error}</Alert>}
      {phase === 'starting' && <WaitingNotice message="Preparing your first question…" startedAt={startedAt} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {confirmed ? (
          <span />
        ) : (
          <Link to={`/sessions/${session.id}/configure`} className="text-sm text-slate-600 hover:text-slate-900">
            ← Change settings
          </Link>
        )}
        <Button onClick={begin} busy={phase !== 'idle'}>
          {phase === 'confirming' ? 'Confirming…' : phase === 'starting' ? 'Preparing…' : confirmed ? 'Start interview' : 'Confirm and start'}
        </Button>
      </div>
    </section>
  )
}
