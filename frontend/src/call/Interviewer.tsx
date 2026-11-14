import type { SpeechAudio, TalkingHead, TalkingHeadOptions } from '@met4citizen/talkinghead'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Spinner } from '../components/ui'
import type { InterviewerPreset } from './interviewers'

export type InterviewerStatus = 'loading' | 'ready' | 'error'

export interface InterviewerHandle {
  /** Speak with lip-sync. Resolves when the speech has finished or was stopped. */
  speak: (speech: SpeechAudio[], onWord?: (word: string) => void) => Promise<void>
  stopSpeaking: () => void
  /** The audio context the avatar plays through, so speech can be decoded for it. Null until ready. */
  audioContext: () => AudioContext | null
}

// A head-and-shoulders view that keeps looking at the candidate, like a video call.
const OPTIONS: TalkingHeadOptions = {
  lipsyncModules: [], // HeadTTS provides the mouth shapes, so no text-to-viseme module is needed.
  cameraView: 'upper',
  cameraRotateEnable: false,
  cameraZoomEnable: false,
  cameraPanEnable: false,
  avatarMood: 'neutral',
  avatarIdleEyeContact: 0.6,
  avatarSpeakingEyeContact: 0.8,
}

/**
 * The 3D interviewer, drawn with TalkingHead (three.js) and loaded only when shown.
 * To switch interviewers, render it with key={interviewer.key} so it starts afresh.
 */
export default function Interviewer({
  interviewer,
  ref,
  onStatusChange,
}: {
  interviewer: InterviewerPreset
  ref?: Ref<InterviewerHandle>
  onStatusChange?: (status: InterviewerStatus) => void
}) {
  const node = useRef<HTMLDivElement>(null)
  const head = useRef<TalkingHead | null>(null)
  const pending = useRef(new Set<() => void>())
  const [status, setStatus] = useState<InterviewerStatus>('loading')
  const statusListener = useRef(onStatusChange)

  useEffect(() => {
    statusListener.current = onStatusChange
  })

  useEffect(() => {
    statusListener.current?.(status)
  }, [status])

  useEffect(() => {
    let cancelled = false
    let created: TalkingHead | null = null
    const finishAll = pending.current

    import('@met4citizen/talkinghead')
      .then(async ({ TalkingHead }) => {
        if (cancelled || !node.current) return
        created = new TalkingHead(node.current, {
          ...OPTIONS,
          modelPixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        })
        await created.showAvatar({ url: interviewer.modelUrl, body: interviewer.body, avatarMood: 'neutral', lipsyncLang: 'en' })
        if (cancelled) return
        head.current = created
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      head.current = null
      finishAll.forEach((finish) => finish())
      finishAll.clear()
      created?.dispose()
    }
  }, [interviewer.modelUrl, interviewer.body])

  useImperativeHandle(
    ref,
    () => ({
      speak: (speech, onWord) => {
        const current = head.current
        if (!current || speech.length === 0) return Promise.resolve()
        return new Promise<void>((resolve) => {
          const finish = () => {
            pending.current.delete(finish)
            resolve()
          }
          pending.current.add(finish)
          const subtitles = onWord ? (word: string) => onWord(word.trim()) : null
          speech.forEach((part) => current.speakAudio(part, null, subtitles))
          current.speakMarker(finish)
        })
      },
      stopSpeaking: () => {
        head.current?.stopSpeaking()
        // Stopping drops the queued end marker, so finish the waiting promises here.
        pending.current.forEach((finish) => finish())
      },
      audioContext: () => head.current?.audioCtx ?? null,
    }),
    [],
  )

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-b from-slate-800 to-slate-900">
      <div ref={node} className="h-full w-full" aria-hidden="true" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-slate-300">
          <Spinner />
          Getting {interviewer.name} ready…
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-700 text-3xl font-semibold text-white">
            {interviewer.name[0]}
          </span>
          <p className="text-sm text-slate-300">The 3D interviewer could not load in this browser.</p>
        </div>
      )}
      <p className="absolute bottom-3 left-3 rounded-md bg-slate-950/70 px-2 py-1 text-xs font-medium text-white">
        {interviewer.name} · AI interviewer
      </p>
    </div>
  )
}
