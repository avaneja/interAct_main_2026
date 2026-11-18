import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { DocumentSummary, DocumentView, SessionView } from '../api/types'
import { Alert, Badge, Button, Card, PageTitle, Spinner } from '../components/ui'
import { pathForSession } from '../lib/sessionRoutes'
import { fileProblem, MAX_UPLOAD_MB, pagesLabel, POLL_MS, titleOf } from '../lib/documents'
import { useLoad } from '../lib/useLoad'

const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.')

/**
 * Model B: upload notes, wait while they are read, then choose the topics
 * to be interviewed on. /new/document starts here; /sessions/:id/document
 * changes the topics of an interview that has not started.
 */
export default function DocumentPage() {
  const { id } = useParams()
  if (!id) return <DocumentFlow session={null} />
  return <ExistingSession key={id} id={id} />
}

function ExistingSession({ id }: { id: string }) {
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
  if (session.input_model !== 'DOCUMENT' || !['PREPARING', 'CONFIGURING'].includes(session.state)) {
    return <Navigate to={pathForSession(session.id, session.state, session.input_model)} replace />
  }
  return <DocumentFlow session={session} />
}

function DocumentFlow({ session }: { session: SessionView | null }) {
  const [documentId, setDocumentId] = useState<string | null>(session?.context?.document_id ?? null)
  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <PageTitle
        title="Practise from your notes"
        subtitle="Upload lecture notes or a chapter. The interviewer asks about what they say and cites the pages."
      />
      {documentId ? (
        <Reading key={documentId} documentId={documentId} session={session} onStartOver={() => setDocumentId(null)} />
      ) : (
        <>
          <UploadCard onUploaded={(document) => setDocumentId(document.id)} />
          <YourDocuments onPick={(document) => setDocumentId(document.id)} />
          <p className="text-sm">
            <Link to="/new" className="text-slate-300 hover:text-white">
              Describe a topic instead
            </Link>
          </p>
        </>
      )}
    </section>
  )
}

function UploadCard({ onUploaded }: { onUploaded: (document: DocumentView) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null
    setFile(chosen)
    setError(chosen ? fileProblem(chosen) : null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Choose a file to upload.')
      return
    }
    const problem = fileProblem(file)
    if (problem) {
      setError(problem)
      return
    }
    setSending(true)
    setError(null)
    try {
      onUploaded(await api.uploadDocument(file))
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <label htmlFor="document" className="block text-sm font-medium text-slate-200">
            Your notes
          </label>
          <input
            id="document"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            onChange={choose}
            className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100 hover:file:bg-slate-700"
          />
          <p className="text-xs text-slate-400">
            A text-based PDF (you can select its text) or a TXT file, up to {MAX_UPLOAD_MB} MB. Scanned documents can't be read
            yet. Uploads are deleted automatically after 30 days.
          </p>
        </div>
        {error && <Alert title="Can't upload this file">{error}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" busy={sending}>
            {sending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function YourDocuments({ onPick }: { onPick: (document: DocumentView) => void }) {
  const listed = useLoad((signal) => api.listDocuments(signal), 'documents')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const documents = listed.data ?? []
  if (listed.loading || listed.error || documents.length === 0) return null

  async function remove(document: DocumentView) {
    setDeleting(document.id)
    setError(null)
    try {
      await api.deleteDocument(document.id)
      listed.setData(documents.filter((d) => d.id !== document.id))
    } catch (caught) {
      setError(message(caught))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold text-white">Your uploads</h2>
      {error && <Alert title="Could not delete">{error}</Alert>}
      <ul className="divide-y divide-slate-800" aria-label="Your uploads">
        {documents.map((document) => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div>
              <p className="text-sm text-slate-100">{document.filename}</p>
              <p className="text-xs text-slate-500">
                {document.status === 'READY' ? 'Ready' : document.status === 'FAILED' ? 'Could not be read' : 'Being read'} · deleted
                on {new Date(document.expires_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2">
              {document.status !== 'FAILED' && (
                <Button variant="secondary" onClick={() => onPick(document)}>
                  Use
                </Button>
              )}
              <Button variant="secondary" onClick={() => void remove(document)} busy={deleting === document.id} aria-label={`Delete ${document.filename}`}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Waits while the document is read, then shows its topics to choose from. */
function Reading({ documentId, session, onStartOver }: { documentId: string; session: SessionView | null; onStartOver: () => void }) {
  const [summary, setSummary] = useState<DocumentSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer = 0
    const check = async () => {
      try {
        const next = await api.documentSummary(documentId, controller.signal)
        setSummary(next)
        setError(null)
        if (next.document.status === 'UPLOADED' || next.document.status === 'PROCESSING') {
          timer = window.setTimeout(() => void check(), POLL_MS)
        }
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(message(caught))
      }
    }
    void check()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [documentId, attempt])

  const retry = async () => {
    setError(null)
    try {
      await api.processDocument(documentId)
      setSummary(null)
      setAttempt((n) => n + 1)
    } catch (caught) {
      setError(message(caught))
    }
  }

  if (error && !summary) {
    return (
      <Alert title="Could not check your document" action={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>
        {error}
      </Alert>
    )
  }
  const status = summary?.document.status
  if (!summary || status === 'UPLOADED' || status === 'PROCESSING') {
    return (
      <Card className="flex items-center gap-3" >
        <Spinner />
        <div role="status">
          <p className="text-slate-100">Reading {summary?.document.filename ?? 'your document'}…</p>
          <p className="text-sm text-slate-400">Finding its topics. This can take up to a minute with a local model.</p>
        </div>
      </Card>
    )
  }
  if (status === 'FAILED') {
    return (
      <Alert
        title={`Could not read ${summary.document.filename}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void retry()}>
              Try again
            </Button>
            <Button variant="secondary" onClick={onStartOver}>
              Upload a different file
            </Button>
          </div>
        }
      >
        {summary.document.summary?.error ?? 'The document could not be processed.'}
        {error && <p className="mt-2">{error}</p>}
      </Alert>
    )
  }
  return <TopicReview summary={summary} session={session} onStartOver={onStartOver} />
}

function TopicReview({ summary, session, onStartOver }: { summary: DocumentSummary; session: SessionView | null; onStartOver: () => void }) {
  const navigate = useNavigate()
  const sameDocument = session?.context?.document_id === summary.document.id
  const preselected = sameDocument ? session?.context?.selected_topic_ids ?? [] : []
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(preselected.length ? preselected : summary.topics.map((topic) => topic.id)),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const created = useRef<string | null>(session?.id ?? null)
  const { document, topics } = summary

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function confirm() {
    if (chosen.size === 0) {
      setError('Choose at least one topic.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      created.current ??= (await api.createSession('DOCUMENT')).id
      await api.setContext(created.current, {
        input_model: 'DOCUMENT',
        topic: titleOf(document.filename),
        subtopics: [],
        document_id: document.id,
        selected_topic_ids: topics.filter((topic) => chosen.has(topic.id)).map((topic) => topic.id),
      })
      navigate(`/sessions/${created.current}/configure`)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-white">{document.filename}</h2>
          {document.summary?.pages ? <Badge>{document.summary.pages} pages</Badge> : null}
        </div>
        {document.summary?.summary && <p className="mt-2 text-sm text-slate-300">{document.summary.summary}</p>}
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-slate-200">Topics to be interviewed on</legend>
        {topics.map((topic) => (
          <label key={topic.id} className="flex cursor-pointer gap-3 rounded-lg border border-slate-800 p-3 hover:border-slate-700">
            <input type="checkbox" className="mt-1" checked={chosen.has(topic.id)} onChange={() => toggle(topic.id)} />
            <span>
              <span className="block text-sm font-medium text-slate-100">{topic.name}</span>
              {topic.summary && <span className="block text-sm text-slate-400">{topic.summary}</span>}
              {topic.pages.length > 0 && <span className="block text-xs text-slate-500">{pagesLabel(topic.pages)}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      {error && <Alert title="Could not continue">{error}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onStartOver} className="text-sm text-slate-300 hover:text-white">
          Use a different file
        </button>
        <Button onClick={() => void confirm()} busy={saving}>
          {saving ? 'Saving…' : `Continue with ${chosen.size} topic${chosen.size === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Card>
  )
}
