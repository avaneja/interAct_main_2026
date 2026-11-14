import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

export type InterviewerActivity = 'speaking' | 'listening' | 'thinking' | 'idle'

export interface Caption {
  who: 'interviewer' | 'you'
  text: string
}

const ACTIVITY_LABEL: Record<InterviewerActivity, string> = {
  speaking: 'Speaking',
  listening: 'Listening',
  thinking: 'Thinking…',
  idle: '',
}

/** Minutes and seconds since the call started. */
export function CallTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <span className="tabular-nums" aria-label={`Call time ${text}`}>
      {text}
    </span>
  )
}

function ControlButton({
  label,
  pressed,
  danger = false,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const tone = danger
    ? 'bg-red-600 text-white hover:bg-red-500'
    : pressed === false
      ? 'bg-red-950/80 text-red-200 hover:bg-red-900'
      : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`flex h-11 min-w-11 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${tone}`}
    >
      {children}
    </button>
  )
}

export interface CallControls {
  /** Only when answering by voice. */
  microphoneOn?: boolean
  onToggleMicrophone?: () => void
  cameraOn: boolean
  onToggleCamera: () => void
  captionsOn: boolean
  onToggleCaptions: () => void
  onPause: () => void
  onEnd: () => void
}

export function ControlBar({ controls, fullScreen, onToggleFullScreen }: { controls: CallControls; fullScreen: boolean; onToggleFullScreen: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" role="toolbar" aria-label="Call controls">
      {controls.onToggleMicrophone && (
        <ControlButton
          label={controls.microphoneOn ? 'Mute microphone' : 'Unmute microphone'}
          pressed={controls.microphoneOn}
          onClick={controls.onToggleMicrophone}
        >
          {controls.microphoneOn ? 'Mic on' : 'Mic off'}
        </ControlButton>
      )}
      <ControlButton label={controls.cameraOn ? 'Turn camera off' : 'Turn camera on'} pressed={controls.cameraOn} onClick={controls.onToggleCamera}>
        {controls.cameraOn ? 'Camera on' : 'Camera off'}
      </ControlButton>
      <ControlButton label={controls.captionsOn ? 'Hide captions' : 'Show captions'} onClick={controls.onToggleCaptions}>
        CC
      </ControlButton>
      <ControlButton label={fullScreen ? 'Exit full screen' : 'Full screen'} onClick={onToggleFullScreen}>
        {fullScreen ? 'Exit full screen' : 'Full screen'}
      </ControlButton>
      <ControlButton label="Pause interview" onClick={controls.onPause}>
        Pause
      </ControlButton>
      <ControlButton label="End interview" danger onClick={controls.onEnd}>
        End
      </ControlButton>
    </div>
  )
}

export interface CallStageProps {
  /** 'lobby' before joining, 'call' once joined. The tiles stay mounted across both. */
  mode: 'lobby' | 'call'
  interviewer: ReactNode
  self: ReactNode
  panel: ReactNode
  activity?: InterviewerActivity
  caption?: Caption | null
  captionsOn?: boolean
  header?: ReactNode
  controls?: CallControls
  stageRef?: RefObject<HTMLDivElement | null>
  fullScreen?: boolean
  onToggleFullScreen?: () => void
}

/**
 * The video-call layout. In the lobby the two tiles sit beside the pre-call
 * panel; in the call the interviewer fills the stage, the candidate's camera
 * is a small tile in the corner, and captions and controls sit below.
 */
export default function CallStage({
  mode,
  interviewer,
  self,
  panel,
  activity = 'idle',
  caption = null,
  captionsOn = true,
  header,
  controls,
  stageRef,
  fullScreen = false,
  onToggleFullScreen = () => {},
}: CallStageProps) {
  const fallbackRef = useRef<HTMLDivElement>(null)
  const inCall = mode === 'call'

  return (
    <div
      ref={stageRef ?? fallbackRef}
      className={inCall ? 'flex flex-col gap-3 bg-slate-950 data-[full]:h-screen data-[full]:p-4' : 'grid gap-4 lg:grid-cols-[1.4fr_1fr]'}
      data-full={fullScreen || undefined}
    >
      {inCall && header}
      <div className={inCall ? 'grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_22rem]' : 'space-y-3'}>
        <div className={inCall ? 'relative aspect-video min-h-0 w-full lg:aspect-auto lg:h-[min(70vh,40rem)]' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-1'}>
          <div className={inCall ? 'h-full w-full' : 'aspect-video'}>{interviewer}</div>
          <div className={inCall ? 'absolute right-3 top-3 aspect-video w-32 shadow-lg sm:w-44' : 'aspect-video'}>{self}</div>
          {inCall && activity !== 'idle' && (
            <p className="absolute left-3 top-3 rounded-full bg-slate-950/70 px-3 py-1 text-xs font-medium text-white" role="status">
              {ACTIVITY_LABEL[activity]}
            </p>
          )}
          {inCall && captionsOn && caption && caption.text && (
            <p
              className="absolute inset-x-3 bottom-12 mx-auto max-w-3xl rounded-lg bg-slate-950/80 px-4 py-2 text-center text-base text-white"
              aria-live="polite"
            >
              <span className="mr-2 font-semibold text-violet-300">{caption.who === 'you' ? 'You' : 'Interviewer'}:</span>
              {caption.text}
            </p>
          )}
        </div>
        <div className="min-h-0">{panel}</div>
      </div>
      {inCall && controls && <ControlBar controls={controls} fullScreen={fullScreen} onToggleFullScreen={onToggleFullScreen} />}
    </div>
  )
}
