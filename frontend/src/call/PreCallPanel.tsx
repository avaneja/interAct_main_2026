import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Card, Spinner } from '../components/ui'
import { MediaAccessError, describeProblem, openDevice, stopStream, watchLevel, type MediaProblem } from './media'
import type { CameraState } from './useCamera'
import type { VoiceState } from './useVoice'

export type AnswerMode = 'speak' | 'type'

type Tone = 'ok' | 'wait' | 'warn'

function CheckRow({ label, tone, children }: { label: string; tone: Tone; children: ReactNode }) {
  const dot = { ok: 'bg-emerald-400', wait: 'bg-amber-300 animate-pulse', warn: 'bg-red-400' }[tone]
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-slate-800">{label}</p>
        <div className="mt-0.5 text-slate-500">{children}</div>
      </div>
    </li>
  )
}

type MicState = { status: 'starting' } | { status: 'on'; level: number } | { status: 'problem'; problem: MediaProblem }

/** Opens the microphone only to show a level meter, and closes it again when no longer shown. */
function MicrophoneCheck({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const [state, setState] = useState<MicState>({ status: 'starting' })
  const [attempt, setAttempt] = useState(0)
  const notify = useRef(onReadyChange)

  useEffect(() => {
    notify.current = onReadyChange
  })

  useEffect(() => {
    notify.current(state.status === 'on')
  }, [state.status])

  useEffect(() => {
    let current = true
    let stream: MediaStream | null = null
    let stopWatching = () => {}
    openDevice('microphone').then(
      (opened) => {
        if (!current) return stopStream(opened)
        stream = opened
        setState({ status: 'on', level: 0 })
        stopWatching = watchLevel(opened, (level) => current && setState({ status: 'on', level }))
      },
      (error: unknown) => {
        if (current) setState({ status: 'problem', problem: error instanceof MediaAccessError ? error.problem : 'failed' })
      },
    )
    return () => {
      current = false
      stopWatching()
      stopStream(stream)
    }
  }, [attempt])

  if (state.status === 'starting') {
    return (
      <CheckRow label="Microphone" tone="wait">
        Asking the browser for your microphone…
      </CheckRow>
    )
  }
  if (state.status === 'problem') {
    return (
      <CheckRow label="Microphone" tone="warn">
        <p>{describeProblem('microphone', state.problem)}</p>
        <button
          type="button"
          className="mt-1 text-violet-600 hover:text-violet-800"
          onClick={() => {
            setState({ status: 'starting' })
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </button>
      </CheckRow>
    )
  }
  return (
    <CheckRow label="Microphone" tone="ok">
      <p>Say something: the bar should move.</p>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(state.level * 100)}
      >
        <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${state.level * 100}%` }} />
      </div>
    </CheckRow>
  )
}

function VoiceCheck({ name, voice, usingBrowserVoice }: { name: string; voice: VoiceState; usingBrowserVoice: boolean }) {
  if (usingBrowserVoice || voice.status === 'failed') {
    return (
      <CheckRow label={`${name}'s voice`} tone="ok">
        {voice.status === 'failed'
          ? `${name}'s natural voice could not start in this browser, so your browser's built-in voice will speak instead.`
          : "Your browser's built-in voice will speak."}
      </CheckRow>
    )
  }
  if (voice.status === 'ready') {
    return (
      <CheckRow label={`${name}'s voice`} tone="ok">
        Ready.
      </CheckRow>
    )
  }
  return (
    <CheckRow label={`${name}'s voice`} tone="wait">
      {voice.progress === null
        ? `Preparing ${name}'s voice on this computer…`
        : `Downloading ${name}'s voice: ${Math.round(voice.progress * 100)}%. This happens only the first time (about 300 MB).`}
    </CheckRow>
  )
}

function CameraCheck({ camera, onCameraOn, onCameraOff }: { camera: CameraState; onCameraOn: () => void; onCameraOff: () => void }) {
  const toggle = (label: string, action: () => void) => (
    <button type="button" className="mt-1 text-violet-600 hover:text-violet-800" onClick={action}>
      {label}
    </button>
  )
  switch (camera.status) {
    case 'on':
      return (
        <CheckRow label="Camera" tone="ok">
          <p>On. Only you see this preview.</p>
          {toggle('Turn camera off', onCameraOff)}
        </CheckRow>
      )
    case 'starting':
      return (
        <CheckRow label="Camera" tone="wait">
          Asking the browser for your camera…
        </CheckRow>
      )
    case 'problem':
      return (
        <CheckRow label="Camera" tone="warn">
          <p>{describeProblem('camera', camera.problem)} You can also continue with the camera off.</p>
          {toggle('Try again', onCameraOn)}
        </CheckRow>
      )
    case 'off':
      return (
        <CheckRow label="Camera" tone="ok">
          <p>Off. You can interview without it.</p>
          {toggle('Turn camera on', onCameraOn)}
        </CheckRow>
      )
  }
}

export interface PreCallPanelProps {
  interviewerName: string
  questionCount: number
  voice: VoiceState
  usingBrowserVoice: boolean
  onUseBrowserVoice: () => void
  camera: CameraState
  onCameraOn: () => void
  onCameraOff: () => void
  canSpeak: boolean
  joining?: boolean
  /** `trackFocus` is the candidate's consent to focus tracking; it starts unchecked. */
  onJoin: (mode: AnswerMode, trackFocus: boolean) => void
}

/** The lobby before the call: check camera, microphone and voice, choose how to answer, then join. */
export default function PreCallPanel({
  interviewerName,
  questionCount,
  voice,
  usingBrowserVoice,
  onUseBrowserVoice,
  camera,
  onCameraOn,
  onCameraOff,
  canSpeak,
  joining = false,
  onJoin,
}: PreCallPanelProps) {
  const [mode, setMode] = useState<AnswerMode>(canSpeak ? 'speak' : 'type')
  const [micReady, setMicReady] = useState(false)
  const [trackFocus, setTrackFocus] = useState(false)
  const voiceLoading = voice.status === 'loading' && !usingBrowserVoice
  const blockedByMic = mode === 'speak' && !micReady

  return (
    <Card className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Ready to join?</h1>
        <p className="mt-1 text-sm text-slate-500">
          {interviewerName} will ask {questionCount} questions out loud, one at a time. Answer as you would in a real
          interview.
        </p>
      </div>

      <ul className="space-y-4">
        <VoiceCheck name={interviewerName} voice={voice} usingBrowserVoice={usingBrowserVoice} />
        <CameraCheck camera={camera} onCameraOn={onCameraOn} onCameraOff={onCameraOff} />
        {mode === 'speak' && <MicrophoneCheck onReadyChange={setMicReady} />}
      </ul>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">How will you answer?</legend>
        <label className={`flex gap-2 text-sm ${canSpeak ? 'text-slate-700' : 'text-slate-400'}`}>
          <input
            type="radio"
            name="answer-mode"
            checked={mode === 'speak'}
            disabled={!canSpeak}
            onChange={() => setMode('speak')}
          />
          <span>
            Speak my answers
            {!canSpeak && (
              <span className="block text-xs">
                Speaking needs Google Chrome or Microsoft Edge: this browser cannot turn speech into text. Open InterAct in
                Chrome to speak, or type your answers.
              </span>
            )}
          </span>
        </label>
        <label className="flex gap-2 text-sm text-slate-700">
          <input type="radio" name="answer-mode" checked={mode === 'type'} onChange={() => setMode('type')} />
          Type my answers
        </label>
      </fieldset>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        <p className="font-medium text-slate-600">What happens to your camera, microphone and voice</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>Your camera preview stays in this browser. InterAct never records or uploads video.</li>
          <li>
            When you speak, Chrome sends your voice to Google to turn it into text. Only the text reaches InterAct.
            Choose typing if you prefer.
          </li>
          <li>{interviewerName}'s voice is made on this computer.</li>
          <li>Your answers are saved to your account as text and scored.</li>
        </ul>
      </div>

      <label className="flex gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
        <input type="checkbox" checked={trackFocus} onChange={(event) => setTrackFocus(event.target.checked)} />
        <span>
          Track my focus for practice feedback
          <span className="mt-1 block text-xs text-slate-500">
            Counts tab switches and time away and, with the camera on, estimates eye contact in this browser. Only the
            numbers are kept, for the Delivery and focus part of your report. Nothing is recorded, and it never
            affects your score.
          </span>
        </span>
      </label>

      <div className="space-y-2">
        <Button className="w-full" busy={joining} disabled={voiceLoading || blockedByMic} onClick={() => onJoin(mode, trackFocus)}>
          {voiceLoading ? (
            <>
              <Spinner /> Waiting for {interviewerName}'s voice…
            </>
          ) : (
            'Join interview'
          )}
        </Button>
        {voiceLoading && (
          <button type="button" className="w-full text-center text-xs text-violet-600 hover:text-violet-800" onClick={onUseBrowserVoice}>
            Don't wait: use the browser's voice instead
          </button>
        )}
        {blockedByMic && !voiceLoading && (
          <p className="text-center text-xs text-slate-500">The microphone must work to speak your answers, or choose typing.</p>
        )}
      </div>
    </Card>
  )
}
