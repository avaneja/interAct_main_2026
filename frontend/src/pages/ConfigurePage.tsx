import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { Difficulty, InterviewConfig, QuestionCount, QuestionType, SessionView } from '../api/types'
import { Alert, Button, Card, PageTitle } from '../components/ui'
import { DIFFICULTIES, QUESTION_COUNTS, QUESTION_STYLES } from '../lib/labels'
import { pathForSession } from '../lib/sessionRoutes'
import { useLoad } from '../lib/useLoad'

const DEFAULT_CONFIG: InterviewConfig = {
  question_type: 'MIXED',
  difficulty: 'intermediate',
  question_count: 5,
  adaptive: true,
  feedback_timing: 'END',
}

const optionClass = (selected: boolean) =>
  `flex h-full cursor-pointer flex-col rounded-lg border p-3 text-left transition-colors ${
    selected ? 'border-violet-500 bg-violet-950/40' : 'border-slate-700 hover:border-slate-500'
  }`

export default function ConfigurePage() {
  const { id = '' } = useParams()
  const loaded = useLoad((signal) => api.getSession(id, signal), id)

  if (loaded.loading) return <p className="text-slate-400">Loading…</p>
  if (loaded.error || !loaded.data) {
    return (
      <Alert title="Could not load this interview" action={<Button variant="secondary" onClick={loaded.reload}>Try again</Button>}>
        {loaded.error?.message}
      </Alert>
    )
  }
  const session = loaded.data
  if (session.state !== 'CONFIGURING') return <Navigate to={pathForSession(session.id, session.state)} replace />
  return <ConfigureForm session={session} />
}

function ConfigureForm({ session }: { session: SessionView }) {
  const navigate = useNavigate()
  const [config, setConfig] = useState<InterviewConfig>(session.config ?? DEFAULT_CONFIG)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.setConfig(session.id, config)
      navigate(`/sessions/${session.id}/plan`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-3xl">
      <PageTitle title="Interview settings" subtitle={`Topic: ${session.context?.topic ?? ''}`} />
      <form className="space-y-6" onSubmit={submit}>
        <Card>
          <fieldset>
            <legend className="font-semibold text-white">Question style</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {QUESTION_STYLES.map((style) => (
                <label key={style.value} className={optionClass(config.question_type === style.value)}>
                  <input
                    type="radio"
                    name="question_type"
                    value={style.value}
                    className="sr-only"
                    checked={config.question_type === style.value}
                    onChange={() => setConfig((c) => ({ ...c, question_type: style.value as QuestionType }))}
                  />
                  <span className="font-medium text-white">{style.label}</span>
                  <span className="mt-1 text-sm text-slate-300">{style.description}</span>
                  <span className="mt-2 text-xs italic text-slate-500">“{style.example}”</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card>
          <fieldset>
            <legend className="font-semibold text-white">Difficulty</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {DIFFICULTIES.map((difficulty) => (
                <label key={difficulty.value} className={optionClass(config.difficulty === difficulty.value)}>
                  <input
                    type="radio"
                    name="difficulty"
                    value={difficulty.value}
                    className="sr-only"
                    checked={config.difficulty === difficulty.value}
                    onChange={() => setConfig((c) => ({ ...c, difficulty: difficulty.value as Difficulty }))}
                  />
                  <span className="font-medium text-white">{difficulty.label}</span>
                  <span className="mt-1 text-sm text-slate-300">{difficulty.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>

        <Card className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="font-semibold text-white">Number of questions</legend>
            <div className="mt-3 flex gap-2">
              {QUESTION_COUNTS.map((count) => (
                <label key={count} className={`${optionClass(config.question_count === count)} items-center px-5`}>
                  <input
                    type="radio"
                    name="question_count"
                    value={count}
                    className="sr-only"
                    checked={config.question_count === count}
                    onChange={() => setConfig((c) => ({ ...c, question_count: count as QuestionCount }))}
                  />
                  <span className="font-semibold text-white">{count}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <p className="font-semibold text-white">Follow-up questions</p>
            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-violet-600"
                checked={config.adaptive}
                onChange={(e) => setConfig((c) => ({ ...c, adaptive: e.target.checked }))}
              />
              <span className="text-sm text-slate-300">
                Allow follow-ups that dig deeper when an answer is incomplete. Your choice is saved with the plan;
                follow-ups arrive in a later version, so questions follow the plan for now.
              </span>
            </label>
          </div>
        </Card>

        {error && <Alert title="Could not save your settings">{error}</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to={`/sessions/${session.id}/topic`} className="text-sm text-slate-300 hover:text-white">
            ← Edit topic
          </Link>
          <Button type="submit" busy={saving}>
            {saving ? 'Saving…' : 'Review the plan'}
          </Button>
        </div>
      </form>
    </section>
  )
}
