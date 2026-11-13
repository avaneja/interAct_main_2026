import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { InterviewContext, SessionView } from '../api/types'
import { Alert, Button, Card, Field, PageTitle } from '../components/ui'
import { DIFFICULTIES } from '../lib/labels'
import { pathForSession } from '../lib/sessionRoutes'
import { inputClass } from '../lib/styles'
import { type Draft, EMPTY, MAX_TEXT, parseSubtopics, validateDraft } from '../lib/topicForm'
import { useLoad } from '../lib/useLoad'

function toContext(draft: Draft): InterviewContext {
  return {
    input_model: 'TOPIC',
    topic: draft.topic.trim(),
    goal: draft.goal.trim() || null,
    level: draft.level || null,
    subtopics: parseSubtopics(draft.subtopics),
  }
}

function fromSession(session: SessionView): Draft {
  const context = session.context
  if (!context) return EMPTY
  return {
    topic: context.topic,
    goal: context.goal ?? '',
    level: context.level ?? '',
    subtopics: context.subtopics.join(', '),
  }
}

/** /new starts an interview; /sessions/:id/topic edits one before its plan is confirmed. */
export default function TopicPage() {
  const { id } = useParams()
  const existing = useLoad<SessionView | null>((signal) => (id ? api.getSession(id, signal) : Promise.resolve(null)), id ?? 'new')

  if (existing.loading) return <p className="text-slate-400">Loading…</p>
  if (existing.error) {
    return (
      <Alert title="Could not load this interview" action={<Button variant="secondary" onClick={existing.reload}>Try again</Button>}>
        {existing.error.message}
      </Alert>
    )
  }
  const session = existing.data
  if (session && !['PREPARING', 'CONFIGURING'].includes(session.state)) {
    return <Navigate to={pathForSession(session.id, session.state)} replace />
  }
  return <TopicForm key={session?.id ?? 'new'} session={session} />
}

function TopicForm({ session }: { session: SessionView | null }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(session ? fromSession(session) : EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Reuse a session created by an earlier attempt that failed halfway, so retries never duplicate it.
  const [sessionId, setSessionId] = useState<string | null>(session?.id ?? null)

  const update = (field: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setServerError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found = validateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setServerError(null)
    try {
      let id = sessionId
      if (!id) {
        id = (await api.createSession('TOPIC')).id
        setSessionId(id)
      }
      await api.setContext(id, toContext(draft))
      navigate(`/sessions/${id}/configure`)
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <PageTitle
        title={session?.context ? 'Edit your topic' : 'What do you want to practise?'}
        subtitle="Describe the interview you want. You choose the question style next."
      />
      <Card>
        <form className="space-y-5" onSubmit={submit} noValidate>
          <Field id="topic" label="Topic" hint="For example: Operating systems, or Machine learning model evaluation." error={errors.topic}>
            <input
              id="topic"
              className={inputClass}
              value={draft.topic}
              onChange={(e) => update('topic')(e.target.value)}
              maxLength={MAX_TEXT + 50}
              autoFocus
            />
          </Field>
          <Field id="goal" label="Goal (optional)" hint="For example: a software engineering internship." error={errors.goal}>
            <input id="goal" className={inputClass} value={draft.goal} onChange={(e) => update('goal')(e.target.value)} />
          </Field>
          <Field id="level" label="Your level (optional)">
            <select id="level" className={inputClass} value={draft.level} onChange={(e) => update('level')(e.target.value)}>
              <option value="">Not specified</option>
              {DIFFICULTIES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="subtopics"
            label="Subtopics to focus on (optional)"
            hint="Separate with commas. Questions rotate through them; without any, they cover the whole topic."
            error={errors.subtopics}
          >
            <textarea
              id="subtopics"
              className={inputClass}
              rows={2}
              value={draft.subtopics}
              onChange={(e) => update('subtopics')(e.target.value)}
              placeholder="processes, memory management, scheduling"
            />
          </Field>
          {serverError && <Alert title="Could not save your topic">{serverError}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" busy={saving}>
              {saving ? 'Saving…' : 'Continue to settings'}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  )
}
