import { Link, Navigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { DeliverySummary, QuestionReport, ReportSummary } from '../api/types'
import { Alert, Badge, Button, Card, PageTitle } from '../components/ui'
import { difficultyLabel, styleLabel } from '../lib/labels'
import { useLoad } from '../lib/useLoad'

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return minutes < 1 ? 'under a minute' : `${minutes} minute${minutes === 1 ? '' : 's'}`
}

function Bar({ percent }: { percent: number | null }) {
  const value = percent ?? 0
  const tone = value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${tone}`} style={{ width: `${value}%` }} />
    </div>
  )
}

export default function ReportPage() {
  const { id = '' } = useParams()
  const loaded = useLoad((signal) => api.report(id, signal), id)

  if (loaded.loading) return <p className="text-slate-500">Loading your report…</p>
  if (loaded.error instanceof ApiError && loaded.error.status === 409) {
    return <Navigate to={`/sessions/${id}/interview`} replace />
  }
  if (loaded.error || !loaded.data) {
    return (
      <Alert title="Could not load the report" action={<Button variant="secondary" onClick={loaded.reload}>Try again</Button>}>
        {loaded.error?.message}
      </Alert>
    )
  }
  return <Report summary={loaded.data.summary} />
}

function Report({ summary }: { summary: ReportSummary }) {
  const competencies = Object.entries(summary.competencies)
  return (
    <section className="space-y-6">
      <PageTitle
        title={summary.topic ? `Your report: ${summary.topic}` : 'Your report'}
        subtitle={`${summary.answered_questions} of ${summary.planned_questions ?? summary.answered_questions} questions answered in ${formatDuration(summary.duration_seconds)}.`}
      />

      <Card className="flex flex-wrap items-center gap-6">
        <div>
          <p className="text-5xl font-bold text-slate-900">{summary.percent ?? 0}%</p>
          <p className="text-sm text-slate-500">
            {summary.score} of {summary.max_score} rubric points
          </p>
        </div>
        <div className="min-w-48 flex-1">
          <Bar percent={summary.percent} />
          <p className="mt-2 text-xs text-slate-400">{summary.label}. This is a practice estimate, not a hiring decision.</p>
        </div>
      </Card>

      {summary.notices.length > 0 && (
        <Alert kind="warning" title="Notes about this report">
          <ul className="list-disc space-y-1 pl-5">
            {summary.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </Alert>
      )}

      {summary.grounding && (
        <Card>
          <h2 className="font-semibold text-slate-900">Grounded in your document</h2>
          <p className="mt-1 text-sm text-slate-600">
            {summary.grounding.verified} of {summary.grounding.questions} questions were checked against your document: each
            one's quote was found on the page it cites ({summary.grounding.pass_rate ?? 0}%).
          </p>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-900">By competency</h2>
          <ul className="mt-3 space-y-3">
            {competencies.map(([name, totals]) => (
              <li key={name}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-700">{name}</span>
                  <span className="text-slate-500">
                    {totals.percent ?? 0}% · {totals.questions} question{totals.questions === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1">
                  <Bar percent={totals.percent} />
                </div>
              </li>
            ))}
            {competencies.length === 0 && <li className="text-sm text-slate-500">No answers were scored.</li>}
          </ul>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="font-semibold text-slate-900">Coverage</h2>
            <p className="mt-1 text-sm text-slate-600">
              {summary.coverage.covered.length} of {summary.coverage.planned.length} planned areas assessed
              {summary.coverage.percent !== null ? ` (${summary.coverage.percent}%)` : ''}.
            </p>
            {summary.coverage.not_covered.length > 0 && (
              <p className="mt-1 text-sm text-slate-500">Not assessed: {summary.coverage.not_covered.join(', ')}.</p>
            )}
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Areas to revise</h2>
            {summary.areas_to_revise.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summary.areas_to_revise.map((area) => (
                  <Badge key={area} tone="amber">{area}</Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-500">Nothing stood out as weak.</p>
            )}
          </div>
          {summary.missing_concepts.length > 0 && (
            <div>
              <h2 className="font-semibold text-slate-900">Concepts you missed</h2>
              <p className="mt-1 text-sm text-slate-600">{summary.missing_concepts.join(', ')}</p>
            </div>
          )}
        </Card>
      </div>

      {summary.delivery && <DeliverySection delivery={summary.delivery} />}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Question by question</h2>
        {summary.questions.map((question) => (
          <QuestionDetails key={question.sequence} question={question} />
        ))}
      </div>

      <div className="flex gap-3">
        <Link to="/new" className="bg-brand rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-fuchsia-300/50 hover:brightness-110">
          Start another interview
        </Link>
        <Link to="/history" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-violet-50">
          Your interviews
        </Link>
      </div>
    </section>
  )
}

function QuestionDetails({ question }: { question: QuestionReport }) {
  const evaluation = question.evaluation
  return (
    <details className="group rounded-xl border border-slate-200 bg-white/70 open:bg-white">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-4">
        <div>
          <p className="text-xs text-slate-500">
            Question {question.sequence} · {styleLabel(question.type)} · {question.competency} · {difficultyLabel(question.difficulty)}
          </p>
          <p className="mt-1 text-slate-800">{question.prompt}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-slate-700">
          {evaluation ? `${evaluation.score}/${evaluation.max_score}` : 'Not answered'}
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 p-4 text-sm">
        {question.grounding && <SourceNote grounding={question.grounding} />}
        <div>
          <h3 className="font-semibold text-slate-700">Your answer</h3>
          <p className="mt-1 whitespace-pre-wrap text-slate-600">{question.answer ?? 'You did not answer this question.'}</p>
        </div>
        {question.follow_ups.length > 0 && (
          <div className="space-y-3 border-l-2 border-slate-200 pl-3">
            {question.follow_ups.map((followUp, index) => (
              <div key={index}>
                <h3 className="font-semibold text-slate-700">Follow-up: {followUp.prompt}</h3>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">{followUp.answer ?? 'Not answered.'}</p>
              </div>
            ))}
            <p className="text-xs text-slate-400">Your replies to follow-ups are scored together with your answer.</p>
          </div>
        )}
        {evaluation?.insufficient_evidence && (
          <Alert kind="warning">This answer could not be graded with confidence: {evaluation.insufficient_reason ?? 'the evaluator flagged it'}.</Alert>
        )}
        {evaluation && (
          <div>
            <h3 className="font-semibold text-slate-700">Scores</h3>
            <ul className="mt-2 space-y-2">
              {evaluation.criteria.map((criterion) => (
                <li key={criterion.name} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex justify-between">
                    <span className="font-medium capitalize text-slate-800">{criterion.name}</span>
                    <span className="text-slate-600">
                      {criterion.score}/{criterion.max_score}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-500">{criterion.reason}</p>
                  {criterion.evidence_quote && (
                    <blockquote className="mt-2 border-l-2 border-violet-500 pl-3 italic text-slate-600">
                      “{criterion.evidence_quote}”
                    </blockquote>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {question.document_points && <DocumentPoints points={question.document_points} />}
        {question.better_answer_outline.length > 0 && (
          <div>
            <h3 className="font-semibold text-slate-700">A stronger answer would cover</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
              {question.better_answer_outline.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        )}
        {evaluation && evaluation.missing_concepts.length > 0 && (
          <p className="text-slate-500">Missing: {evaluation.missing_concepts.join(', ')}</p>
        )}
        {question.answer_key && (
          <div>
            <h3 className="font-semibold text-slate-700">Key points from the source</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
              {question.answer_key.key_points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

const percent = (ratio: number | null) => (ratio === null ? '–' : `${Math.round(ratio * 100)}%`)

function sourcePages(sources: NonNullable<QuestionReport['grounding']>['sources']): string {
  const labels = sources.map(({ page, page_end }) =>
    page === null ? 'your document' : page_end && page_end !== page ? `pages ${page}–${page_end}` : `page ${page}`,
  )
  return [...new Set(labels)].join(', ')
}

function SourceNote({ grounding }: { grounding: NonNullable<QuestionReport['grounding']> }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {grounding.sources.length > 0 ? `From your document, ${sourcePages(grounding.sources)}` : 'From your document'}
      </p>
      {grounding.supporting_quote && (
        <blockquote className="mt-2 border-l-2 border-emerald-500 pl-3 italic text-slate-600">“{grounding.supporting_quote}”</blockquote>
      )}
      {grounding.status === 'FLAGGED' && (
        <p className="mt-2 text-amber-800">Not verified: {grounding.note ?? 'the source could not be checked'}. Check it against your notes.</p>
      )}
    </div>
  )
}

function DocumentPoints({ points }: { points: NonNullable<QuestionReport['document_points']> }) {
  if (points.supported.length === 0 && points.outside.length === 0) return null
  const list = (items: typeof points.supported) => (
    <ul className="mt-1 space-y-1.5">
      {items.map((item) => (
        <li key={item.quote} className="text-slate-600">
          {item.point} <span className="italic text-slate-400">(you said “{item.quote}”)</span>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="font-semibold text-emerald-700">Supported by your document</h3>
        {points.supported.length ? list(points.supported) : <p className="mt-1 text-slate-400">Nothing from the document.</p>}
      </div>
      <div>
        <h3 className="font-semibold text-sky-700">Beyond your document</h3>
        <p className="text-xs text-slate-400">Outside knowledge: not wrong for that reason, but not in your notes.</p>
        {points.outside.length ? list(points.outside) : <p className="mt-1 text-slate-400">Nothing beyond it.</p>}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
      {hint && <dd className="text-xs text-slate-400">{hint}</dd>}
    </div>
  )
}

/** How the answers were given: pace, fillers and, with consent, focus. Shown apart from the score. */
function DeliverySection({ delivery }: { delivery: DeliverySummary }) {
  const minutes = Math.floor(delivery.speaking_seconds / 60)
  const seconds = delivery.speaking_seconds % 60
  return (
    <Card>
      <h2 className="font-semibold text-slate-900">Delivery and focus</h2>
      <p className="mt-1 text-sm text-slate-500">{delivery.note}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Answering time" value={`${minutes}:${String(seconds).padStart(2, '0')}`} hint={`${delivery.answers_measured} answers`} />
        <Stat
          label="Speaking pace"
          value={delivery.words_per_minute === null ? '–' : `${delivery.words_per_minute} wpm`}
          hint={delivery.words_per_minute === null ? 'Only for spoken answers' : 'About 120–160 is easy to follow'}
        />
        <Stat
          label="Filler words"
          value={String(delivery.filler_words)}
          hint={delivery.fillers_per_100_words === null ? undefined : `${delivery.fillers_per_100_words} per 100 words`}
        />
        <Stat
          label="Left the interview"
          value={`${delivery.tab_switches}×`}
          hint={`${delivery.seconds_away}s away${delivery.fullscreen_exits ? `, ${delivery.fullscreen_exits} full-screen exits` : ''}`}
        />
        {delivery.camera && (
          <>
            <Stat label="Looking away" value={percent(delivery.camera.looking_away_ratio)} hint="Of answering time, estimated" />
            <Stat label="Long look-aways" value={String(delivery.camera.look_aways)} hint="1.5 seconds or more" />
            <Stat label="Face not visible" value={percent(delivery.camera.face_missing_ratio)} />
            <Stat label="More than one face" value={percent(delivery.camera.multiple_faces_ratio)} />
          </>
        )}
      </dl>
    </Card>
  )
}
