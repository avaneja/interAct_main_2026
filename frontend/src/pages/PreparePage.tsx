import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { PreparationMessage, PreparationView, PrepareTurn, SessionView } from '../api/types'
import { DEFAULT_INTERVIEWER } from '../call/interviewers'
import { canRecognizeSpeech, createTranscriber, type Transcriber } from '../call/recognition'
import { browserSpeaker, canUseBrowserVoice, type Speaker } from '../call/speaker'
import ScopeFields, { type DraftErrors } from '../components/ScopeFields'
import { Alert, Button, Card, PageTitle, Spinner } from '../components/ui'
import { pathForSession } from '../lib/sessionRoutes'
import { inputClass } from '../lib/styles'
import { type Draft, draftFromContext, toContext, validateDraft } from '../lib/topicForm'
import { useLoad } from '../lib/useLoad'

const NAME = DEFAULT_INTERVIEWER.name
const MAX_MESSAGE = 2000
const VOICE_KEY = 'interact.prepare.voice'
// Browser tests set VITE_CALL_VOICE=captions, so nothing is read aloud there.
const SILENT = import.meta.env.VITE_CALL_VOICE === 'captions'

const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.')

function voicePreference(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== 'off'
  } catch {
    return true
  }
}

/**
 * Model A preparation: the candidate describes the interview they want, the
 * interviewer asks a few questions to pin down the scope, then the candidate
 * edits and confirms it. /new starts here; /sessions/:id/prepare continues it.
 */
export default function PreparePage() {
  const { id } = useParams()
  if (!id) return <RequestForm sessionId={null} />
  return <PrepareSession key={id} id={id} />
}

function PrepareSession({ id }: { id: string }) {
  const loaded = useLoad(
    async (signal): Promise<{ session: SessionView; preparation: PreparationView }> => {
      const [session, preparation] = await Promise.all([api.getSession(id, signal), api.getPreparation(id, signal)])
      return { session, preparation }
    },
    id,
  )

  if (loaded.loading) return <p className="text-slate-500">Loading…</p>
  if (loaded.error || !loaded.data) {
    return (
      <Alert title="Could not load this interview" action={<Button variant="secondary" onClick={loaded.reload}>Try again</Button>}>
        {loaded.error?.message}
      </Alert>
    )
  }
  const { session, preparation } = loaded.data
  if (session.state !== 'PREPARING' || session.input_model === 'DOCUMENT') {
    return <Navigate to={pathForSession(session.id, session.state, session.input_model)} replace />
  }
  if (preparation.messages.length === 0) return <RequestForm sessionId={id} onSent={(view) => loaded.setData({ session, preparation: view })} />
  return <Chat id={id} initial={preparation} />
}

/** The first step: what the candidate wants to practise, in their own words. */
function RequestForm({ sessionId, onSent }: { sessionId: string | null; onSent?: (view: PreparationView) => void }) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // Reuse a session created by an earlier attempt that failed halfway, so retries never duplicate it.
  const [created, setCreated] = useState<string | null>(sessionId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) {
      setError('Describe the interview you want to practise.')
      return
    }
    setSending(true)
    setError(null)
    try {
      let id = created
      if (!id) {
        id = (await api.createSession('TOPIC')).id
        setCreated(id)
      }
      const view = await api.prepareMessage(id, { text: text.trim() })
      if (onSent) onSent(view)
      else navigate(`/sessions/${id}/prepare`, { replace: true })
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="mx-auto max-w-2xl">
      <PageTitle
        title="What do you want to practise?"
        subtitle={`Describe it in your own words. ${NAME} will ask a couple of quick questions to plan your interview.`}
      />
      <Card>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <label htmlFor="request" className="block text-sm font-medium text-slate-700">
            Your interview
          </label>
          <textarea
            id="request"
            className={`${inputClass} min-h-28`}
            value={text}
            maxLength={MAX_MESSAGE}
            onChange={(event) => {
              setText(event.target.value)
              setError(null)
            }}
            placeholder="For example: Interview me on machine learning, especially overfitting and model evaluation. I'm preparing for an ML internship."
            autoFocus
          />
          {error && <Alert title="Could not start">{error}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex flex-wrap gap-4">
              <Link to={created ? `/sessions/${created}/topic` : '/new/form'} className="text-sm text-slate-600 hover:text-slate-900">
                Fill in a form instead
              </Link>
              {!created && (
                <Link to="/new/document" className="text-sm text-slate-600 hover:text-slate-900">
                  Use your own notes (PDF or TXT)
                </Link>
              )}
            </span>
            <Button type="submit" busy={sending}>
              {sending ? `${NAME} is reading…` : 'Continue'}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  )
}

function Bubble({ entry }: { entry: PreparationMessage }) {
  const mine = entry.role === 'user'
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          mine ? 'bg-brand text-white shadow-md shadow-fuchsia-200' : 'border border-slate-200 bg-white text-slate-800 shadow-sm'
        }`}
      >
        <p className="mb-0.5 text-xs font-medium opacity-70">{mine ? 'You' : NAME}</p>
        {entry.kind === 'skip' ? <p className="italic opacity-80">Skipped</p> : <p>{entry.content}</p>}
      </div>
    </li>
  )
}

function Chat({ id, initial }: { id: string; initial: PreparationView }) {
  const [view, setView] = useState(initial)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState<PrepareTurn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voiceOn, setVoiceOn] = useState(() => !SILENT && canUseBrowserVoice() && voicePreference())
  const speaker = useRef<Speaker | null>(null)
  const end = useRef<HTMLDivElement>(null)

  // Read each new line from the interviewer aloud, but not the ones already there on arrival.
  const spoken = useRef(initial.messages.length)
  useEffect(() => {
    const latest = view.messages[view.messages.length - 1]
    if (view.messages.length <= spoken.current || latest?.role !== 'assistant') return
    spoken.current = view.messages.length
    if (!voiceOn) return
    speaker.current ??= browserSpeaker()
    speaker.current.stop()
    void speaker.current.speak(latest.content)
  }, [view.messages, voiceOn])
  useEffect(() => () => speaker.current?.stop(), [])

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [view.messages.length, sending])

  async function send(turn: PrepareTurn) {
    setSending(turn)
    setError(null)
    try {
      setView(await api.prepareMessage(id, turn))
      setReply('')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSending(null)
    }
  }

  const toggleVoice = (on: boolean) => {
    setVoiceOn(on)
    if (!on) speaker.current?.stop()
    try {
      localStorage.setItem(VOICE_KEY, on ? 'on' : 'off')
    } catch {
      // The preference simply is not remembered.
    }
  }

  const busy = sending !== null
  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <PageTitle title={`Plan your interview with ${NAME}`} subtitle="A few quick questions, then you check the plan." />
      <Card className="space-y-4">
        <ol className="space-y-3" aria-label="Conversation">
          {view.messages.map((entry, index) => (
            <Bubble key={index} entry={entry} />
          ))}
        </ol>
        {busy && (
          <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
            <Spinner /> {NAME} is thinking…
          </p>
        )}
        <div ref={end} />
        {error && (
          <Alert title="Your message was not answered">
            {error} Your message is kept, so you can send it again.
          </Alert>
        )}
        <ReplyBox
          key={view.messages.length}
          value={reply}
          onChange={setReply}
          busy={busy}
          sending={sending}
          question={view.question}
          done={view.done}
          onSend={(text) => send({ text })}
          onSkip={() => send({ skip: true })}
          onEnough={() => send({ text: reply.trim(), enough: true })}
        />
        {!SILENT && canUseBrowserVoice() && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={voiceOn} onChange={(event) => toggleVoice(event.target.checked)} />
            Read {NAME}'s questions aloud
          </label>
        )}
      </Card>
      {view.done && view.context && <ScopeEditor key={view.messages.length} id={id} view={view} />}
    </section>
  )
}

function ReplyBox({
  value,
  onChange,
  busy,
  sending,
  question,
  done,
  onSend,
  onSkip,
  onEnough,
}: {
  value: string
  onChange: (text: string) => void
  busy: boolean
  sending: PrepareTurn | null
  question: string | null
  done: boolean
  onSend: (text: string) => void
  onSkip: () => void
  onEnough: () => void
}) {
  const [listening, setListening] = useState(false)
  const transcriber = useRef<Transcriber | null>(null)
  const before = useRef('')
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => () => transcriber.current?.stop(), [])

  const dictate = () => {
    if (listening) {
      transcriber.current?.stop()
      setListening(false)
      return
    }
    before.current = value
    transcriber.current ??= createTranscriber({
      onText: (confirmed, pending) => latest.current([before.current, confirmed, pending].map((part) => part.trim()).filter(Boolean).join(' ')),
      onProblem: () => setListening(false),
    })
    transcriber.current.start()
    setListening(true)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    transcriber.current?.stop()
    setListening(false)
    if (value.trim() && !busy) onSend(value.trim())
  }

  const unanswered = !done && question === null
  return (
    <form className="space-y-3 border-t border-slate-200 pt-4" onSubmit={submit}>
      <label htmlFor="reply" className="block text-sm font-medium text-slate-700">
        {done ? `Anything to change? Tell ${NAME}, or edit the plan below.` : unanswered ? 'Send your message again' : 'Your reply'}
      </label>
      <textarea
        id="reply"
        className={`${inputClass} min-h-20`}
        value={value}
        maxLength={MAX_MESSAGE}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        autoFocus
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {canRecognizeSpeech() && (
            <Button type="button" variant="secondary" onClick={dictate} disabled={busy}>
              {listening ? 'Stop dictating' : 'Speak'}
            </Button>
          )}
          {question !== null && (
            <>
              <Button type="button" variant="secondary" onClick={onSkip} disabled={busy} busy={sending?.skip}>
                Skip this question
              </Button>
              <Button type="button" variant="secondary" onClick={onEnough} disabled={busy} busy={sending?.enough}>
                That's enough, show the plan
              </Button>
            </>
          )}
        </div>
        <Button type="submit" disabled={!value.trim() || busy} busy={busy && !sending?.skip && !sending?.enough}>
          Send
        </Button>
      </div>
    </form>
  )
}

/** The summarised scope, editable, confirmed explicitly before the settings. */
function ScopeEditor({ id, view }: { id: string; view: PreparationView }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(() => draftFromContext(view.context))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function confirm(event: FormEvent) {
    event.preventDefault()
    const found = validateDraft(draft)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setError(null)
    try {
      await api.setContext(id, toContext(draft))
      navigate(`/sessions/${id}/configure`)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <form className="space-y-5" onSubmit={confirm} noValidate aria-label="Your interview plan">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Your interview plan</h2>
          <p className="mt-1 text-sm text-slate-500">Check it, change anything, then confirm. Nothing starts until you do.</p>
        </div>
        <ScopeFields
          draft={draft}
          errors={errors}
          onChange={(field, value) => {
            setDraft((current) => ({ ...current, [field]: value }))
            setError(null)
          }}
        />
        {error && <Alert title="Could not save the plan">{error}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" busy={saving}>
            {saving ? 'Saving…' : 'Confirm and choose settings'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
