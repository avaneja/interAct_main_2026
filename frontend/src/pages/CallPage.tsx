import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { AnswerResult, QuestionView, SessionView } from '../api/types'
import AnswerPanel from '../call/AnswerPanel'
import CallStage, { CallTimer, type Caption } from '../call/CallStage'
import Interviewer, { type InterviewerHandle, type InterviewerStatus } from '../call/Interviewer'
import { DEFAULT_INTERVIEWER } from '../call/interviewers'
import PreCallPanel, { type AnswerMode } from '../call/PreCallPanel'
import { canRecognizeSpeech } from '../call/recognition'
import {
  CLOSING_LINE,
  PAUSE_LINE,
  STILL_THINKING_LINE,
  acknowledgementLine,
  linesAfterAnswer,
  openingLines,
  questionIntroLine,
} from '../call/script'
import SelfView from '../call/SelfView'
import { avatarSpeaker, browserSpeaker, canUseBrowserVoice, captionSpeaker, type Speaker } from '../call/speaker'
import { useCamera } from '../call/useCamera'
import { useFullScreen } from '../call/useFullScreen'
import { useVoice, type VoiceState } from '../call/useVoice'
import type { Voice } from '../call/voice'
import { useAuth } from '../auth/context'
import { Alert, Button, Card } from '../components/ui'
import WaitingNotice from '../components/WaitingNotice'
import { clearDraft } from '../lib/drafts'
import { pathForSession } from '../lib/sessionRoutes'
import { useLoad } from '../lib/useLoad'

// Browser tests set VITE_CALL_VOICE=captions so they do not download the neural voice,
// and VITE_CALL_WPM to show the captions faster than anyone speaks.
const CAPTIONS_ONLY = import.meta.env.VITE_CALL_VOICE === 'captions'
const CAPTION_WPM = Number(import.meta.env.VITE_CALL_WPM) || undefined
const NO_VOICE = () => new Promise<Voice>(() => {})
// After the acknowledgement, a wait longer than this gets "Just a moment longer".
const STILL_THINKING_AFTER_MS = 12_000

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

export default function CallPage() {
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
  return <Call key={session.id} initialSession={session} initialQuestion={question} />
}

type Turn = 'lobby' | 'asking' | 'answering' | 'scoring' | 'retry' | 'paused' | 'closing'

function Call({ initialSession, initialQuestion }: { initialSession: SessionView; initialQuestion: QuestionView | null }) {
  const navigate = useNavigate()
  const { state: auth } = useAuth()
  const preset = DEFAULT_INTERVIEWER
  const total = initialSession.config?.question_count ?? 0
  const topic = initialSession.context?.topic ?? null
  const reportPath = `/sessions/${initialSession.id}/report`

  const [question, setQuestion] = useState(initialQuestion)
  const [turn, setTurn] = useState<Turn>('lobby')
  const [mode, setMode] = useState<AnswerMode>('type')
  const [joining, setJoining] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [caption, setCaption] = useState<Caption | null>(null)
  const [captionsOn, setCaptionsOn] = useState(true)
  const [microphoneOn, setMicrophoneOn] = useState(true)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [waitStartedAt, setWaitStartedAt] = useState(0)
  const [interviewerStatus, setInterviewerStatus] = useState<InterviewerStatus>('loading')
  const [usingBrowserVoice, setUsingBrowserVoice] = useState(CAPTIONS_ONLY)

  const voice = useVoice(CAPTIONS_ONLY ? 'none' : preset.voice, CAPTIONS_ONLY ? NO_VOICE : undefined)
  const { camera, turnOn: cameraOn, turnOff: cameraOff } = useCamera()
  const interviewer = useRef<InterviewerHandle>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fullScreen = useFullScreen(stage)
  const alive = useRef(true)
  const speakQueue = useRef(Promise.resolve())

  // The speaker is chosen when it is needed: the neural voice with lip-sync when both it and the
  // 3D interviewer are ready, otherwise the browser's voice, otherwise captions only.
  const speakerRef = useRef<Speaker | null>(null)
  const chooseSpeaker = (): Speaker => {
    if (!speakerRef.current) {
      if (!usingBrowserVoice && voice.status === 'ready' && interviewerStatus === 'ready') {
        speakerRef.current = avatarSpeaker(voice.voice, () => interviewer.current)
      } else if (!CAPTIONS_ONLY && canUseBrowserVoice()) {
        speakerRef.current = browserSpeaker()
      } else {
        speakerRef.current = captionSpeaker(CAPTION_WPM)
      }
    }
    return speakerRef.current
  }

  useEffect(() => {
    alive.current = true
    void cameraOn()
    return () => {
      alive.current = false
      speakerRef.current?.stop()
    }
  }, [cameraOn])

  /** Speak one line with live captions. Lines never overlap: each waits for the one before. */
  const say = (text: string) => {
    const next = speakQueue.current.then(async () => {
      if (!alive.current) return
      const speaker = chooseSpeaker()
      setCaption({ who: 'interviewer', text: '' })
      let shown = ''
      await speaker.speak(text, (word) => {
        shown = shown ? `${shown} ${word}` : word
        // "Speaking" shows from the first word heard, not while the speech is still being made.
        if (alive.current) {
          setSpeaking(true)
          setCaption({ who: 'interviewer', text: shown })
        }
      })
      if (!alive.current) return
      setCaption({ who: 'interviewer', text })
      setSpeaking(false)
    })
    speakQueue.current = next.catch(() => undefined)
    return next
  }

  const ask = async (next: QuestionView, before: string[]) => {
    setTurn('asking')
    setAnswerError(null)
    const speaker = chooseSpeaker()
    speaker.prepare(next.prompt)
    for (const line of before) await say(line)
    await say(next.prompt)
    if (!alive.current) return
    linesAfterAnswer(next.sequence, total).forEach((line) => speaker.prepare(line))
    setTurn('answering')
  }

  const afterScoring = async (result: AnswerResult, current: QuestionView | null) => {
    if (current) clearDraft(current.id)
    if (result.completed || !result.next_question) {
      setTurn('closing')
      await say(CLOSING_LINE)
      // After the last answer the interview waits in its wrap-up; finishing scores every answer.
      if (!result.completed) await api.finish(initialSession.id)
      if (alive.current) navigate(reportPath)
      return
    }
    setQuestion(result.next_question)
    await ask(result.next_question, [questionIntroLine(result.next_question.sequence, total)])
  }

  /** Run a scoring request while the interviewer acknowledges, and says more if it takes long. */
  const score = async (request: () => Promise<AnswerResult>, current: QuestionView | null) => {
    setTurn('scoring')
    setAnswerError(null)
    setCallError(null)
    setWaitStartedAt(Date.now())
    const acknowledged = current ? say(acknowledgementLine(current.sequence)) : Promise.resolve()
    let slow = 0
    void acknowledged.then(() => {
      slow = window.setTimeout(() => void say(STILL_THINKING_LINE), STILL_THINKING_AFTER_MS)
    })
    try {
      const result = await request()
      window.clearTimeout(slow)
      await acknowledged
      window.clearTimeout(slow)
      await afterScoring(result, current)
    } catch (caught) {
      window.clearTimeout(slow)
      await acknowledged
      window.clearTimeout(slow)
      if (!alive.current) return
      // The model failed after the answer was saved: nothing was scored, and it can be retried.
      if (caught instanceof ApiError && caught.status === 503) {
        setCallError(null)
        setTurn('retry')
        return
      }
      const message = caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.'
      if (current) {
        // A failed send goes back to the answer, which still holds the text.
        setAnswerError(message)
        setTurn('answering')
      } else {
        setCallError(message)
        setTurn('retry')
      }
    }
  }

  const resuming = initialSession.questions_answered > 0 || (question?.sequence ?? 1) > 1 || initialSession.state === 'PAUSED'
  const openingFor = (sequence: number) =>
    openingLines({ interviewerName: preset.name, questionCount: total, topic, nextSequence: sequence, resuming })

  // Once the voice is ready, make the opening and the first question while the candidate is
  // still in the lobby, so the interviewer starts talking as soon as they join.
  const readyVoice = voice.status === 'ready' ? voice.voice : null
  const firstPrompt = initialQuestion?.prompt
  const firstSequence = initialQuestion?.sequence
  useEffect(() => {
    if (!readyVoice || !firstPrompt || !firstSequence) return
    const lines = [
      ...openingLines({ interviewerName: preset.name, questionCount: total, topic, nextSequence: firstSequence, resuming }),
      firstPrompt,
    ]
    for (const line of lines) readyVoice.say(line).catch(() => undefined)
  }, [readyVoice, firstPrompt, firstSequence, preset.name, total, topic, resuming])

  const join = async (chosen: AnswerMode) => {
    setMode(chosen)
    setJoining(true)
    void fullScreen.enter()
    try {
      if (initialSession.state === 'PAUSED') await api.resume(initialSession.id)
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not resume the interview. Try again.')
      setJoining(false)
      return
    }
    setJoining(false)
    setStartedAt(Date.now())
    if (initialSession.state === 'EVALUATING' || !question) {
      setTurn('retry')
      return
    }
    const opening = openingFor(question.sequence)
    const speaker = chooseSpeaker()
    opening.forEach((line) => speaker.prepare(line))
    await ask(question, opening)
  }

  const submit = (text: string) => {
    if (!question) return
    const current = question
    void score(() => api.submitAnswer(initialSession.id, current.id, text), current)
  }

  const retry = () => void score(() => api.retry(initialSession.id), null)

  const pause = async () => {
    setBusy(true)
    try {
      speakerRef.current?.stop()
      await api.pause(initialSession.id)
      setTurn('paused')
      setCaption(null)
      void say(PAUSE_LINE)
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not pause. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const resume = async () => {
    if (!question) return
    setBusy(true)
    try {
      await api.resume(initialSession.id)
      setCallError(null)
      void ask(question, ["Let's continue.", questionIntroLine(question.sequence, total)])
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not resume. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const end = async () => {
    setBusy(true)
    try {
      speakerRef.current?.stop()
      await api.finish(initialSession.id)
      await fullScreen.exit()
      navigate(reportPath)
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not end the interview. Try again.')
      setBusy(false)
    }
  }

  // The voice shown in the lobby also waits for the 3D interviewer, so both start together.
  const lobbyVoice: VoiceState =
    voice.status === 'ready' && interviewerStatus === 'loading' ? { status: 'loading', progress: null } : voice
  const displayName = auth.status === 'signed-in' ? (auth.user.display_name ?? auth.user.email ?? 'You') : 'You'
  // Every question before the current one has been answered.
  const answered = question ? question.sequence - 1 : initialSession.questions_answered
  const activity = speaking ? 'speaking' : turn === 'answering' && mode === 'speak' && microphoneOn ? 'listening' : turn === 'scoring' ? 'thinking' : 'idle'

  const panel = (() => {
    if (turn === 'lobby') {
      return (
        <div className="space-y-3">
          {callError && <Alert>{callError}</Alert>}
          <PreCallPanel
            interviewerName={preset.name}
            questionCount={total}
            voice={lobbyVoice}
            usingBrowserVoice={usingBrowserVoice}
            onUseBrowserVoice={() => setUsingBrowserVoice(true)}
            camera={camera}
            onCameraOn={() => void cameraOn()}
            onCameraOff={cameraOff}
            canSpeak={canRecognizeSpeech()}
            joining={joining}
            onJoin={(chosen) => void join(chosen)}
          />
        </div>
      )
    }
    if (confirmEnd) {
      return (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-white">End the interview now?</h2>
          <p className="text-sm text-slate-400">
            The remaining questions are skipped. Your report covers the {answered} answered so far.
          </p>
          {callError && <Alert>{callError}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" busy={busy} onClick={() => void end()}>
              Yes, end now
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmEnd(false)}>
              Keep going
            </Button>
          </div>
        </Card>
      )
    }
    if (turn === 'paused') {
      return (
        <Card className="space-y-3 text-center">
          <h2 className="text-lg font-semibold text-white">Interview paused</h2>
          <p className="text-sm text-slate-400">
            {answered} of {total} questions answered. Your progress is saved, so you can also come back later.
          </p>
          {callError && <Alert>{callError}</Alert>}
          <Button busy={busy} onClick={() => void resume()}>
            Resume interview
          </Button>
        </Card>
      )
    }
    if (turn === 'retry' || (turn === 'scoring' && !question)) {
      return (
        <div className="space-y-3">
          <Alert
            kind="warning"
            title="Your last answer is saved, but scoring did not finish"
            action={
              <Button busy={turn === 'scoring'} onClick={retry}>
                {turn === 'scoring' ? 'Scoring…' : 'Try scoring again'}
              </Button>
            }
          >
            The model did not respond, so nothing was scored and no score was guessed. Trying again scores the answer
            you already sent.
          </Alert>
          {turn === 'scoring' && <WaitingNotice message="Scoring your answer…" startedAt={waitStartedAt} />}
          {callError && <Alert title="Scoring failed again">{callError}</Alert>}
        </div>
      )
    }
    if (!question) return null
    return (
      <div className="flex h-full flex-col gap-3">
        <AnswerPanel
          key={question.id}
          questionId={question.id}
          mode={mode}
          interviewerName={preset.name}
          questionNumber={question.sequence}
          questionCount={total}
          question={question.prompt}
          canListen={turn === 'answering'}
          microphoneOn={microphoneOn}
          sending={turn === 'scoring'}
          error={answerError}
          onSubmit={submit}
          onCaption={(text) => {
            if (turn === 'answering') setCaption(text ? { who: 'you', text } : null)
          }}
        />
        {turn === 'scoring' && <WaitingNotice message="Scoring your answer and preparing what comes next…" startedAt={waitStartedAt} />}
        {callError && <Alert>{callError}</Alert>}
      </div>
    )
  })()

  return (
    <CallStage
      mode={turn === 'lobby' ? 'lobby' : 'call'}
      stageRef={stage}
      fullScreen={fullScreen.fullScreen}
      onToggleFullScreen={() => void fullScreen.toggle()}
      interviewer={<Interviewer interviewer={preset} ref={interviewer} onStatusChange={setInterviewerStatus} />}
      self={<SelfView stream={camera.status === 'on' ? camera.stream : null} name={displayName} />}
      panel={panel}
      activity={activity}
      caption={caption}
      captionsOn={captionsOn}
      header={
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Interview with {preset.name}
            {question ? ` · Question ${question.sequence} of ${total}` : ''}
          </span>
          {startedAt > 0 && <CallTimer startedAt={startedAt} />}
        </div>
      }
      controls={{
        microphoneOn,
        onToggleMicrophone: mode === 'speak' ? () => setMicrophoneOn((on) => !on) : undefined,
        cameraOn: camera.status === 'on',
        onToggleCamera: () => (camera.status === 'on' ? cameraOff() : void cameraOn()),
        captionsOn,
        onToggleCaptions: () => setCaptionsOn((on) => !on),
        onPause: () => void pause(),
        onEnd: () => setConfirmEnd(true),
      }}
    />
  )
}
