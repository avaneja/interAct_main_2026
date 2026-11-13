import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { AnswerResult, QuestionView, SessionView } from '../api/types'
import { Alert, Badge, Button, Card } from '../components/ui'
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts'
import { difficultyLabel, styleLabel } from '../lib/labels'
import { pathForSession } from '../lib/sessionRoutes'
import { inputClass } from '../lib/styles'
import { useLoad } from '../lib/useLoad'

const MAX_ANSWER = 10_000

interface Snapshot {
  session: SessionView
  question: QuestionView | null
}

async function loadSnapshot(id: string, signal: AbortSignal): Promise<Snapshot> {
  const session = await api.getSession(id, signal)
  if (session.state !== 'IN_PROGRESS' && session.state !== 'PAUSED') return { session, question: null }
  try {
    return { session, question: await api.currentQuestion(id, signal) }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { session, question: null }
    throw error
  }
}

export default function InterviewPage() {
  const { id = '' } = useParams()
  const loaded = useLoad((signal) => loadSnapshot(id, signal), id)

  if (loaded.loading) return <p className="text-slate-400">Loading your interview…</p>
  if (loaded.error || !loaded.data) {
    return (
      <Alert title="Could not load this interview" action={<Button variant="secondary" onClick={loaded.reload}>Try again</Button>}>
        {loaded.error?.message}
      </Alert>
    )
  }
  const { session, question } = loaded.data
  if (!['IN_PROGRESS', 'PAUSED', 'EVALUATING'].includes(session.state)) {
    return <Navigate to={pathForSession(session.id, session.state)} replace />
  }
  return <Interview key={`${session.state}-${question?.id ?? 'none'}`} session={session} question={question} onChange={loaded.reload} />
}

function Interview({
  session,
  question,
  onChange,
}: {
  session: SessionView
  question: QuestionView | null
  onChange: () => void
}) {
  const navigate = useNavigate()
  const [text, setText] = useState(() => (question ? loadDraft(question.id) : ''))
  const [busy, setBusy] = useState<'submit' | 'pause' | 'resume' | 'finish' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const total = session.config?.question_count ?? 0

  async function act(kind: NonNullable<typeof busy>, action: () => Promise<unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
      setBusy(null)
    }
  }

  const afterAnswer = (result: AnswerResult) => {
    if (result.completed) navigate(`/sessions/${session.id}/report`)
    else onChange()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!question || !text.trim()) return
    await act('submit', async () => {
      const result = await api.submitAnswer(session.id, question.id, text)
      clearDraft(question.id)
      afterAnswer(result)
    })
  }

  const finish = () =>
    act('finish', async () => {
      await api.finish(session.id)
      navigate(`/sessions/${session.id}/report`)
    })

  if (session.state === 'PAUSED') {
    return (
      <section className="mx-auto max-w-2xl">
        <Card className="text-center">
          <h1 className="text-xl font-semibold text-white">Interview paused</h1>
          <p className="mt-2 text-slate-400">
            {session.questions_answered} of {total} questions answered. Your progress is saved.
          </p>
          {error && <div className="mt-4 text-left"><Alert>{error}</Alert></div>}
          <Button className="mt-6" busy={busy === 'resume'} onClick={() => act('resume', async () => { await api.resume(session.id); onChange() })}>
            Resume interview
          </Button>
        </Card>
      </section>
    )
  }

  if (session.state === 'EVALUATING' || !question) {
    return (
      <section className="mx-auto max-w-2xl">
        <Alert
          kind="warning"
          title="Your last answer is saved, but scoring did not finish"
          action={<Button variant="secondary" onClick={onChange}>Check again</Button>}
        >
          The model did not respond in time. Nothing was scored yet.
        </Alert>
      </section>
    )
  }

  const answered = session.questions_answered
  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div>
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Question {question.sequence} of {total}
          </span>
          <span>{answered} answered</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
          <div className="h-full bg-violet-500 transition-all" style={{ width: `${total ? (100 * answered) / total : 0}%` }} />
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          <Badge tone="violet">{styleLabel(question.type)}</Badge>
          <Badge>{question.competency}</Badge>
          <Badge>{difficultyLabel(question.difficulty)}</Badge>
        </div>
        <h1 className="mt-4 text-lg leading-relaxed text-white">{question.prompt}</h1>
      </Card>

      <form className="space-y-3" onSubmit={submit}>
        <label htmlFor="answer" className="block text-sm font-medium text-slate-200">
          Your answer
        </label>
        <textarea
          id="answer"
          className={`${inputClass} min-h-48`}
          value={text}
          maxLength={MAX_ANSWER}
          onChange={(e) => {
            setText(e.target.value)
            saveDraft(question.id, e.target.value)
          }}
          disabled={busy !== null}
          placeholder="Answer as you would in a real interview."
        />
        <div className="flex justify-between text-xs text-slate-500">
          <span>Your draft is saved in this browser as you type.</span>
          <span>
            {text.length.toLocaleString()} / {MAX_ANSWER.toLocaleString()}
          </span>
        </div>

        {error && <Alert title="Your answer was not sent">{error}</Alert>}
        {busy === 'submit' && (
          <Alert kind="info">Saving your answer and preparing what comes next. With a local model this can take up to a minute.</Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button type="button" variant="secondary" disabled={busy !== null} busy={busy === 'pause'}
              onClick={() => act('pause', async () => { await api.pause(session.id); onChange() })}>
              Pause
            </Button>
            {confirmFinish ? (
              <>
                <Button type="button" variant="danger" busy={busy === 'finish'} disabled={busy !== null} onClick={finish}>
                  Yes, finish now
                </Button>
                <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmFinish(false)}>
                  Keep going
                </Button>
              </>
            ) : (
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setConfirmFinish(true)}>
                Finish early
              </Button>
            )}
          </div>
          <Button type="submit" busy={busy === 'submit'} disabled={!text.trim() || busy !== null}>
            {busy === 'submit' ? 'Submitting…' : 'Submit answer'}
          </Button>
        </div>
        {confirmFinish && (
          <p className="text-sm text-slate-400">
            Finishing now skips the remaining questions. Your report covers the {answered} answered so far.
          </p>
        )}
      </form>
    </section>
  )
}
