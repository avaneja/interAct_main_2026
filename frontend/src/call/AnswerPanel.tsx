import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card } from '../components/ui'
import { loadDraft, saveDraft } from '../lib/drafts'
import { inputClass } from '../lib/styles'
import { createTranscriber, describeRecognitionProblem, type RecognitionProblem, type Transcriber } from './recognition'

export const MAX_ANSWER = 10_000
// After this long without new words, the answer is shown for review.
export const SILENCE_MS = 5000

const join = (...parts: string[]) =>
  parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')

export interface AnswerPanelProps {
  questionId: string
  /** Chosen in the lobby. When typing, the answer box is shown from the start. */
  mode: 'speak' | 'type'
  interviewerName: string
  questionNumber: number
  questionCount: number
  question: string
  /** The interviewer has finished asking, so listening can start. */
  canListen: boolean
  microphoneOn: boolean
  sending: boolean
  error?: string | null
  onSubmit: (text: string) => void
  /** The candidate's words as they speak, for the caption. */
  onCaption: (text: string) => void
  silenceMs?: number
  makeTranscriber?: typeof createTranscriber
}

/**
 * The candidate's side of a question. By voice: the live transcript while
 * they speak, then a review where they can correct recognition mistakes
 * before sending. By typing: an answer box, saved in the browser as they
 * type. A spoken answer can switch to typing at any point.
 */
export default function AnswerPanel({
  questionId,
  mode,
  interviewerName,
  questionNumber,
  questionCount,
  question,
  canListen,
  microphoneOn,
  sending,
  error = null,
  onSubmit,
  onCaption,
  silenceMs = SILENCE_MS,
  makeTranscriber = createTranscriber,
}: AnswerPanelProps) {
  // A saved draft (typed, or a reviewed transcript before a reload) goes straight to the answer box.
  const [saved] = useState(() => loadDraft(questionId))
  const [typing, setTyping] = useState(mode === 'type')
  const [phase, setPhase] = useState<'answering' | 'review'>(mode === 'type' || saved ? 'review' : 'answering')
  const [heard, setHeard] = useState({ confirmed: '', pending: '' })
  const [draft, setDraft] = useState(saved)
  const [problem, setProblem] = useState<RecognitionProblem | null>(null)
  const latest = useRef(heard)
  const caption = useRef(onCaption)

  const review = useCallback(() => {
    const text = join(latest.current.confirmed, latest.current.pending)
    setDraft(text)
    saveDraft(questionId, text)
    setPhase('review')
  }, [questionId])

  const transcriber = useRef<Transcriber | null>(null)

  // Declared before the listening effect, so it exists when that first runs.
  useEffect(() => {
    const made = makeTranscriber({
      onText: (confirmed, pending) => setHeard({ confirmed, pending }),
      // When recognition stops for good, the answer can still be typed or finished in review.
      onProblem: (stopped) => {
        setProblem(stopped)
        review()
      },
    })
    transcriber.current = made
    return () => {
      made.stop()
      transcriber.current = null
    }
  }, [makeTranscriber, review])

  useEffect(() => {
    latest.current = heard
    caption.current = onCaption
  })

  const spoken = join(heard.confirmed, heard.pending)
  const listening = !typing && canListen && microphoneOn && phase === 'answering' && problem === null && !sending

  useEffect(() => {
    if (!listening) return
    const current = transcriber.current
    current?.start(join(latest.current.confirmed, latest.current.pending))
    return () => current?.stop()
  }, [listening])

  useEffect(() => {
    caption.current(phase === 'answering' ? spoken : '')
  }, [phase, spoken])

  // A pause after speaking moves to review; any new word restarts the wait.
  useEffect(() => {
    if (!listening || !spoken) return
    const timer = window.setTimeout(review, silenceMs)
    return () => window.clearTimeout(timer)
  }, [listening, spoken, silenceMs, review])

  const keepTalking = () => {
    setHeard({ confirmed: draft, pending: '' })
    setTyping(false)
    setPhase('answering')
  }

  return (
    <Card className="flex h-full flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-violet-300">
          Question {questionNumber} of {questionCount}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-100">{question}</p>
      </div>

      {phase === 'answering' ? (
        <>
          <div className="min-h-32 flex-1 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm" aria-live="polite">
            {spoken ? (
              <p>
                <span className="text-slate-100">{heard.confirmed}</span> <span className="text-slate-400">{heard.pending}</span>
              </p>
            ) : (
              <p className="text-slate-500">
                {!canListen
                  ? `Listen to the question. Your microphone turns on when ${interviewerName} finishes.`
                  : !microphoneOn
                    ? 'Your microphone is muted. Unmute it to answer.'
                    : 'Listening… answer out loud.'}
              </p>
            )}
          </div>
          {canListen && !microphoneOn && spoken && (
            <p className="text-xs text-slate-400">Your microphone is muted. Unmute to keep answering, or press Done.</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="text-sm text-violet-300 hover:text-violet-200"
              onClick={() => {
                setTyping(true)
                review()
              }}
            >
              Type instead
            </button>
            <Button onClick={review} disabled={!spoken || sending}>
              Done answering
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-1 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim()) onSubmit(draft.trim())
          }}
        >
          {problem && (
            <Alert kind="warning" title="Listening stopped">
              {describeRecognitionProblem(problem)} You can type or finish your answer here.
            </Alert>
          )}
          <label htmlFor="answer-review" className="text-sm font-medium text-slate-200">
            {typing ? 'Your answer' : 'Check your answer'}
          </label>
          <textarea
            id="answer-review"
            className={`${inputClass} min-h-40 flex-1`}
            value={draft}
            maxLength={MAX_ANSWER}
            onChange={(event) => {
              setDraft(event.target.value)
              saveDraft(questionId, event.target.value)
            }}
            disabled={sending}
            placeholder={typing ? 'Answer as you would in a real interview.' : undefined}
          />
          <p className="flex justify-between gap-2 text-xs text-slate-500">
            <span>{typing ? 'Your answer is saved in this browser as you type.' : 'Fix any words the browser heard wrong, then send.'}</span>
            <span>
              {draft.length.toLocaleString()} / {MAX_ANSWER.toLocaleString()}
            </span>
          </p>
          {error && <Alert title="Your answer was not sent">{error} Your answer is still here, so you can send it again.</Alert>}
          <div className="flex flex-wrap justify-between gap-2">
            {mode === 'speak' && problem === null && (
              <Button type="button" variant="secondary" onClick={keepTalking} disabled={sending}>
                Keep talking
              </Button>
            )}
            <Button type="submit" busy={sending} disabled={!draft.trim() || sending}>
              {sending ? 'Sending…' : 'Send answer'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
