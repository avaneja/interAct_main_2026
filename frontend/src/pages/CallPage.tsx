import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../api/client'
import type { AnswerResult, ChatReply, DeliverySignals, QuestionView, SessionView } from '../api/types'
import { useAuth } from '../auth/context'
import AnswerPanel from '../call/AnswerPanel'
import CallStage, { CallTimer, type Caption } from '../call/CallStage'
import { startFocusTracker, type FocusTracker } from '../call/focusTracker'
import { startGaze, type Gaze } from '../call/gaze'
import Interviewer, { type InterviewerHandle, type InterviewerStatus } from '../call/Interviewer'
import { DEFAULT_INTERVIEWER } from '../call/interviewers'
import PreCallPanel, { type AnswerMode } from '../call/PreCallPanel'
import { canRecognizeSpeech } from '../call/recognition'
import {
  END_EARLY_LINE,
  PAUSE_LINE,
  STILL_THINKING_LINE,
  WARM_UP_QUESTION,
  WRAP_UP_LINE,
  fillerLine,
  goodbyeLine,
  linesAfterAnswer,
  openingLines,
  questionIntroLine,
  welcomeBackLine,
} from '../call/script'
import SelfView from '../call/SelfView'
import { avatarSpeaker, browserSpeaker, canUseBrowserVoice, captionSpeaker, type Speaker } from '../call/speaker'
import { useCamera } from '../call/useCamera'
import { useFullScreen } from '../call/useFullScreen'
import { useVoice, type VoiceState } from '../call/useVoice'
import type { Voice } from '../call/voice'
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
// After the listening sound, a wait longer than this gets "Just a moment".
const STILL_THINKING_AFTER_MS = 10_000

const WARM_UP_FALLBACK: ChatReply = { reply: "Thanks for sharing that. Let's get into the questions.", done: true }
const CLOSING_FALLBACK: ChatReply = { reply: "Sorry, I didn't quite catch that. Do you have any other questions?", done: false }

// Whether the warm-up was already held for a session, so a reload does not ask again.
const warmUpKey = (id: string) => `interact:warm-up:${id}`
function warmedUp(id: string): boolean {
  try {
    return localStorage.getItem(warmUpKey(id)) === 'done'
  } catch {
    return false
  }
}
function markWarmedUp(id: string) {
  try {
    localStorage.setItem(warmUpKey(id), 'done')
  } catch {
    // Not remembered; after a reload the warm-up is simply asked again.
  }
}

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
    return <Navigate to={pathForSession(session.id, session.state, session.input_model)} replace />
  }
  return <Call key={session.id} initialSession={session} initialQuestion={question} />
}

/** Where the call is. 'retry' follows a model failure; 'finishing' writes the report. */
type Stage = 'lobby' | 'call' | 'paused' | 'retry' | 'finishing'
/** What the candidate is answering: the warm-up, a question (or follow-up), or their own questions at the end. */
type Exchange = 'warm_up' | 'question' | 'closing'

function Call({ initialSession, initialQuestion }: { initialSession: SessionView; initialQuestion: QuestionView | null }) {
  const navigate = useNavigate()
  const { state: auth } = useAuth()
  const preset = DEFAULT_INTERVIEWER
  const sessionId = initialSession.id
  const total = initialSession.config?.question_count ?? 0
  const topic = initialSession.context?.topic ?? null
  const reportPath = `/sessions/${sessionId}/report`
  const user = auth.status === 'signed-in' ? auth.user : null
  const displayName = user ? (user.display_name ?? user.email ?? 'You') : 'You'
  // The development test user is not a person, so it is not called by name.
  const firstName = user && user.provider !== 'dev' && user.display_name ? user.display_name.split(' ')[0] : null
  // In progress with no question waiting: every planned question is answered (the wrap-up).
  const inWrapUp = initialSession.state === 'IN_PROGRESS' && initialQuestion === null

  const [question, setQuestion] = useState(initialQuestion)
  const [stage, setStage] = useState<Stage>('lobby')
  const [exchange, setExchange] = useState<Exchange>('question')
  const [listening, setListening] = useState(false)
  const [sending, setSending] = useState(false)
  const [turns, setTurns] = useState(0)
  const [closingRound, setClosingRound] = useState(0)
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
  const stageRef = useRef<HTMLDivElement>(null)
  const fullScreen = useFullScreen(stageRef)
  const alive = useRef(true)
  // Focus tracking runs only with the candidate's consent, given in the lobby.
  const focus = useRef<FocusTracker | null>(null)
  const gaze = useRef<Gaze | null>(null)
  const [trackingFocus, setTrackingFocus] = useState(false)
  const [trackingEyes, setTrackingEyes] = useState(false)
  const answerStartedAt = useRef(0)
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
      focus.current?.stop()
      focus.current = null
      speakerRef.current?.stop()
    }
  }, [cameraOn])

  /** Speak one line with live captions. Lines never overlap: each waits for the one before. */
  const say = (text: string) => {
    const next = speakQueue.current.then(async () => {
      if (!alive.current || !text) return
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

  /** Say `lines` (made ahead where possible), then listen for the candidate's reply. */
  const speakThenListen = async (lines: string[], next: Exchange) => {
    setListening(false)
    setExchange(next)
    const speaker = chooseSpeaker()
    lines.forEach((line) => speaker.prepare(line))
    for (const line of lines) await say(line)
    if (!alive.current) return
    linesAfterAnswer(turns + 1).forEach((line) => speaker.prepare(line))
    // An answer is measured from when the question has been asked.
    answerStartedAt.current = Date.now()
    focus.current?.reset()
    gaze.current?.reset()
    setListening(true)
  }

  /** How this answer was given: timing always, focus counts only with consent. Numbers only. */
  const deliveryOf = (spoken: boolean): DeliverySignals => ({
    answer_seconds: Math.min(3600, Math.max(0, (Date.now() - answerStartedAt.current) / 1000)),
    spoken,
    ...(focus.current?.read() ?? {}),
    ...(gaze.current?.read() ? { camera: gaze.current.read() ?? undefined } : {}),
  })

  // With consent and the camera on, estimate eye contact during the call. If the face model
  // cannot load, the call simply goes on without it.
  const cameraStream = camera.status === 'on' ? camera.stream : null
  const inCall = stage !== 'lobby'
  useEffect(() => {
    if (!trackingFocus || !cameraStream || !inCall) return
    let current = true
    let started: Gaze | null = null
    startGaze(cameraStream).then(
      (ready) => {
        if (!current) return ready.stop()
        started = ready
        gaze.current = ready
        setTrackingEyes(true)
      },
      () => undefined,
    )
    return () => {
      current = false
      started?.stop()
      gaze.current = null
      setTrackingEyes(false)
    }
  }, [trackingFocus, cameraStream, inCall])

  const ask = (next: QuestionView, before: string[]) => {
    setQuestion(next)
    setAnswerError(null)
    return speakThenListen([...before, next.prompt], 'question')
  }

  const startClosing = (before: string[]) => speakThenListen([...before, WRAP_UP_LINE], 'closing')

  /** Write the report: every answer is scored now, which can take a minute with a local model. */
  const finishCall = async () => {
    setStage('finishing')
    setListening(false)
    setCallError(null)
    setWaitStartedAt(Date.now())
    try {
      await api.finish(sessionId)
      await fullScreen.exit()
      if (alive.current) navigate(reportPath)
    } catch (caught) {
      if (alive.current) setCallError(caught instanceof ApiError ? caught.message : 'Could not write the report. Try again.')
    }
  }

  /** While a reply is worked out, make a short listening sound, then "Just a moment" if it is slow. */
  const whileThinking = async <T,>(request: () => Promise<T>): Promise<T> => {
    const turn = turns + 1
    setTurns(turn)
    setSending(true)
    setListening(false)
    setWaitStartedAt(Date.now())
    const listened = say(fillerLine(turn))
    let slow = 0
    void listened.then(() => {
      slow = window.setTimeout(() => void say(STILL_THINKING_LINE), STILL_THINKING_AFTER_MS)
    })
    try {
      return await request()
    } finally {
      window.clearTimeout(slow)
      await listened
      window.clearTimeout(slow)
      if (alive.current) setSending(false)
    }
  }

  /** The interviewer's next step after an answer: a follow-up, the next question, or the wrap-up. */
  const continueAfter = async (result: AnswerResult) => {
    if (result.completed) {
      navigate(reportPath)
      return
    }
    const next = result.next_question
    if (!next) {
      await startClosing(result.reaction ? [result.reaction] : [])
      return
    }
    await ask(next, [next.lead_in ?? questionIntroLine(next.sequence, total)])
  }

  const submit = async (text: string, how: { spoken: boolean }) => {
    if (!question) return
    const current = question
    setAnswerError(null)
    setCallError(null)
    let result: AnswerResult
    try {
      const delivery = deliveryOf(how.spoken)
      result = await whileThinking(() => api.submitAnswer(sessionId, current.id, text, delivery))
    } catch (caught) {
      if (!alive.current) return
      // The model failed after the answer was saved: nothing was lost, and it can be retried.
      if (caught instanceof ApiError && caught.status === 503) {
        setStage('retry')
        return
      }
      // A failed send goes back to the answer, which still holds the text.
      setAnswerError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
      setListening(true)
      return
    }
    clearDraft(current.id)
    await continueAfter(result)
  }

  const retry = async () => {
    setBusy(true)
    setCallError(null)
    setWaitStartedAt(Date.now())
    try {
      const result = await api.retry(sessionId)
      setStage('call')
      await continueAfter(result)
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const sendWarmUp = async (text: string) => {
    const reply = await whileThinking(() => api.chat(sessionId, 'warm_up', text).catch(() => WARM_UP_FALLBACK))
    markWarmedUp(sessionId)
    clearDraft(`warm-up-${sessionId}`)
    if (!question) return
    await ask(question, [reply.reply, questionIntroLine(question.sequence, total)])
  }

  const sendClosing = async (text: string) => {
    const reply = await whileThinking(() => api.chat(sessionId, 'closing', text).catch(() => CLOSING_FALLBACK))
    clearDraft(`closing-${sessionId}-${closingRound}`)
    setClosingRound((round) => round + 1)
    if (reply.done) {
      await say(reply.reply)
      await finishCall()
      return
    }
    await speakThenListen([reply.reply], 'closing')
  }

  const noMoreQuestions = async () => {
    setListening(false)
    await say(goodbyeLine(firstName))
    await finishCall()
  }

  const resuming =
    initialSession.questions_answered > 0 ||
    (initialQuestion?.sequence ?? 1) > 1 ||
    (initialQuestion?.follow_up ?? 0) > 0 ||
    initialSession.state === 'PAUSED' ||
    warmedUp(sessionId)

  // Once the voice is ready, make the opening and the first question while the candidate is
  // still in the lobby, so the interviewer starts talking as soon as they join.
  const readyVoice = voice.status === 'ready' ? voice.voice : null
  const firstPrompt = initialQuestion?.prompt
  const firstSequence = initialQuestion?.sequence
  useEffect(() => {
    if (!readyVoice || !firstPrompt || !firstSequence) return
    const lines = [
      ...openingLines({ interviewerName: preset.name, firstName, questionCount: total, topic, nextSequence: firstSequence, resuming }),
      firstPrompt,
    ]
    for (const line of lines) readyVoice.say(line).catch(() => undefined)
  }, [readyVoice, firstPrompt, firstSequence, preset.name, firstName, total, topic, resuming])

  const join = async (chosen: AnswerMode, trackFocus: boolean) => {
    setMode(chosen)
    if (trackFocus && !focus.current) focus.current = startFocusTracker()
    setTrackingFocus(trackFocus)
    setJoining(true)
    void fullScreen.enter()
    try {
      if (initialSession.state === 'PAUSED') await api.resume(sessionId)
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not resume the interview. Try again.')
      setJoining(false)
      return
    }
    setJoining(false)
    setStartedAt(Date.now())
    setStage('call')
    if (initialSession.state === 'EVALUATING') {
      setStage('retry')
      return
    }
    if (inWrapUp || !question) {
      await startClosing([welcomeBackLine(preset.name)])
      return
    }
    const opening = openingLines({
      interviewerName: preset.name,
      firstName,
      questionCount: total,
      topic,
      nextSequence: question.sequence,
      resuming,
    })
    if (resuming) await ask(question, opening)
    else await speakThenListen(opening, 'warm_up')
  }

  const pause = async () => {
    setBusy(true)
    try {
      speakerRef.current?.stop()
      await api.pause(sessionId)
      setStage('paused')
      setListening(false)
      setCaption(null)
      void say(PAUSE_LINE)
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not pause. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const resume = async () => {
    setBusy(true)
    try {
      await api.resume(sessionId)
      setCallError(null)
      setStage('call')
      if (exchange === 'closing' || !question) void startClosing(["Let's continue."])
      else void ask(question, ["Let's continue.", questionIntroLine(question.sequence, total)])
    } catch (caught) {
      setCallError(caught instanceof ApiError ? caught.message : 'Could not resume. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const endEarly = async () => {
    setConfirmEnd(false)
    speakerRef.current?.stop()
    setListening(false)
    void say(END_EARLY_LINE)
    await finishCall()
  }

  // The voice shown in the lobby also waits for the 3D interviewer, so both start together.
  const lobbyVoice: VoiceState =
    voice.status === 'ready' && interviewerStatus === 'loading' ? { status: 'loading', progress: null } : voice
  // Every question before the current one has been answered; in the wrap-up, all of them.
  const answered = exchange === 'closing' || inWrapUp ? total : question ? question.sequence - 1 : initialSession.questions_answered
  const activity =
    speaking ? 'speaking'
    : sending || stage === 'finishing' ? 'thinking'
    : listening && mode === 'speak' && microphoneOn ? 'listening'
    : 'idle'
  const questionLabel = (asked: QuestionView) =>
    `Question ${asked.sequence} of ${total}${asked.follow_up > 0 ? ' · Follow-up' : ''}`

  const panel = (() => {
    if (stage === 'lobby') {
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
            onJoin={(chosen, trackFocus) => void join(chosen, trackFocus)}
          />
        </div>
      )
    }
    if (stage === 'finishing') {
      return (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-white">Writing your report</h2>
          <p className="text-sm text-slate-400">
            Every answer is being scored against its rubric, together with its follow-ups.
          </p>
          {callError ? (
            <Alert title="The report could not be written" action={<Button onClick={() => void finishCall()}>Try again</Button>}>
              {callError} Your answers are saved, and scores already made are kept.
            </Alert>
          ) : (
            <WaitingNotice message={`Scoring ${answered} answer${answered === 1 ? '' : 's'}…`} startedAt={waitStartedAt} />
          )}
        </Card>
      )
    }
    if (confirmEnd) {
      return (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-white">End the interview now?</h2>
          <p className="text-sm text-slate-400">
            {answered < total
              ? `The remaining questions are skipped. Your report covers the ${answered} answered so far.`
              : 'Your report covers all of your answers.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void endEarly()}>
              Yes, end now
            </Button>
            <Button variant="secondary" onClick={() => setConfirmEnd(false)}>
              Keep going
            </Button>
          </div>
        </Card>
      )
    }
    if (stage === 'paused') {
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
    if (stage === 'retry') {
      return (
        <div className="space-y-3">
          <Alert
            kind="warning"
            title="Your last answer is saved, but the interviewer did not get to reply"
            action={
              <Button busy={busy} onClick={() => void retry()}>
                {busy ? 'Trying again…' : 'Try again'}
              </Button>
            }
          >
            The model did not respond, so nothing was made up. Trying again continues from your saved answer.
          </Alert>
          {busy && <WaitingNotice message="Preparing the next question…" startedAt={waitStartedAt} />}
          {callError && <Alert title="It failed again">{callError}</Alert>}
        </div>
      )
    }

    const common = {
      mode,
      interviewerName: preset.name,
      canListen: listening,
      microphoneOn,
      sending,
      onCaption: (text: string) => {
        if (listening) setCaption(text ? { who: 'you', text } : null)
      },
    }
    const thinking = sending && <WaitingNotice message={`${preset.name} is thinking about your answer…`} startedAt={waitStartedAt} />
    if (exchange === 'warm_up') {
      return (
        <div className="flex h-full flex-col gap-3">
          <AnswerPanel
            key="warm-up"
            {...common}
            draftKey={`warm-up-${sessionId}`}
            label="Getting started"
            prompt={WARM_UP_QUESTION}
            onSubmit={(text) => void sendWarmUp(text)}
          />
          {thinking}
        </div>
      )
    }
    if (exchange === 'closing') {
      return (
        <div className="flex h-full flex-col gap-3">
          <AnswerPanel
            key={`closing-${closingRound}`}
            {...common}
            draftKey={`closing-${sessionId}-${closingRound}`}
            label="Your questions"
            prompt={`Ask ${preset.name} anything about the interview, or end the call.`}
            onSubmit={(text) => void sendClosing(text)}
            extraAction={
              <Button variant="secondary" disabled={sending || !listening} onClick={() => void noMoreQuestions()}>
                No questions, end the interview
              </Button>
            }
          />
          {thinking}
        </div>
      )
    }
    if (!question) return null
    return (
      <div className="flex h-full flex-col gap-3">
        <AnswerPanel
          key={question.id}
          {...common}
          draftKey={question.id}
          label={questionLabel(question)}
          prompt={question.prompt}
          error={answerError}
          onSubmit={(text, how) => void submit(text, how)}
        />
        {thinking}
        {callError && <Alert>{callError}</Alert>}
      </div>
    )
  })()

  const headerDetail =
    exchange === 'warm_up' ? ' · Getting started'
    : exchange === 'closing' ? ' · Your questions'
    : question ? ` · ${questionLabel(question)}`
    : ''

  return (
    <CallStage
      mode={stage === 'lobby' ? 'lobby' : 'call'}
      stageRef={stageRef}
      fullScreen={fullScreen.fullScreen}
      onToggleFullScreen={() => void fullScreen.toggle()}
      interviewer={<Interviewer interviewer={preset} ref={interviewer} onStatusChange={setInterviewerStatus} />}
      self={<SelfView stream={camera.status === 'on' ? camera.stream : null} name={displayName} trackingEyes={trackingEyes} />}
      panel={panel}
      activity={activity}
      caption={caption}
      captionsOn={captionsOn}
      header={
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>
            Interview with {preset.name}
            {headerDetail}
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
