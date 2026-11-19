import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { SessionView } from '../api/types'
import ScopeFields, { type DraftErrors } from '../components/ScopeFields'
import { Alert, Button, Card, PageTitle } from '../components/ui'
import { pathForSession } from '../lib/sessionRoutes'
import { type Draft, EMPTY, draftFromContext, toContext, validateDraft } from '../lib/topicForm'
import { useLoad } from '../lib/useLoad'

/** /new/form starts an interview from a form; /sessions/:id/topic edits one before its plan is confirmed. */
export default function TopicPage() {
  const { id } = useParams()
  const existing = useLoad<SessionView | null>((signal) => (id ? api.getSession(id, signal) : Promise.resolve(null)), id ?? 'new')

  if (existing.loading) return <p className="text-slate-500">Loading…</p>
  if (existing.error) {
    return (
      <Alert title="Could not load this interview" action={<Button variant="secondary" onClick={existing.reload}>Try again</Button>}>
        {existing.error.message}
      </Alert>
    )
  }
  const session = existing.data
  if (session && (!['PREPARING', 'CONFIGURING'].includes(session.state) || session.input_model === 'DOCUMENT')) {
    const to = session.input_model === 'DOCUMENT' && session.state === 'CONFIGURING' ? `/sessions/${session.id}/document` : pathForSession(session.id, session.state, session.input_model)
    return <Navigate to={to} replace />
  }
  return <TopicForm key={session?.id ?? 'new'} session={session} />
}

function TopicForm({ session }: { session: SessionView | null }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(session ? draftFromContext(session.context) : EMPTY)
  const [errors, setErrors] = useState<DraftErrors>({})
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
          <ScopeFields draft={draft} errors={errors} onChange={(field, value) => update(field)(value)} autoFocus />
          {serverError && <Alert title="Could not save your topic">{serverError}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {(!session || session.state === 'PREPARING') ? (
              <Link to={sessionId ? `/sessions/${sessionId}/prepare` : '/new'} className="text-sm text-slate-600 hover:text-slate-900">
                Describe it in your own words instead
              </Link>
            ) : (
              <span />
            )}
            <Button type="submit" busy={saving}>
              {saving ? 'Saving…' : 'Continue to settings'}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  )
}
