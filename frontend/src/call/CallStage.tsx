import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

export type InterviewerActivity = 'speaking' | 'listening' | 'thinking' | 'idle'

export interface Caption {
  who: 'interviewer' | 'you'
  text: string
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
    ? 'bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-lg shadow-rose-300/60 hover:from-rose-600 hover:to-red-600'
    : pressed === false
      ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-200'
      : 'bg-white text-slate-800 shadow-md shadow-violet-200/50 ring-1 ring-slate-200 hover:bg-violet-50'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`flex h-11 min-w-11 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${tone}`}
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
  caption?: Caption | null
  captionsOn?: boolean
  header?: ReactNode
  controls?: CallControls
  stageRef?: RefObject<HTMLDivElement | null>
  fullScreen?: boolean
  onToggleFullScreen?: () => void
}

/**
 * The video-call layout: two tiles side by side, the candidate's camera and
 * the interviewer (camera off, voice only), with the panel beside them (the
 * pre-call check in the lobby, the question and answer in the call). In the
 * call, captions and the controls are added; the tiles stay mounted, so
 * nothing reloads on joining.
 */
export default function CallStage({
  mode,
  interviewer,
  self,
  panel,
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
      className="flex flex-col gap-4 data-[full]:h-screen data-[full]:overflow-auto data-[full]:bg-[#fffbf7] data-[full]:p-4"
      data-full={fullScreen || undefined}
    >
      {inCall && header}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="aspect-video sm:aspect-auto sm:h-[min(50vh,28rem)]">{self}</div>
            <div className="aspect-video sm:aspect-auto sm:h-[min(50vh,28rem)]">{interviewer}</div>
          </div>
          {inCall && captionsOn && caption && caption.text && (
            <p className="surface mx-auto w-full max-w-3xl px-5 py-3 text-center text-base text-slate-800" aria-live="polite">
              <span className="mr-2 font-semibold text-violet-600">{caption.who === 'you' ? 'You' : 'Interviewer'}:</span>
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
