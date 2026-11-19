import { useEffect, useRef } from 'react'

/** The candidate's own camera tile, mirrored like a video call. The video stays in the browser. */
export default function SelfView({
  stream,
  name,
  trackingEyes = false,
}: {
  stream: MediaStream | null
  name: string
  /** Eye contact is being estimated, so the candidate can see that it is on. */
  trackingEyes?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl bg-slate-200 shadow-lg shadow-sky-200/50 ring-4 ring-white">
      {stream ? (
        <video
          ref={video}
          className="h-full w-full -scale-x-100 object-cover"
          autoPlay
          muted
          playsInline
          aria-label="Your camera"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-emerald-400 text-3xl font-bold text-white shadow-lg">
            {(name[0] ?? 'Y').toUpperCase()}
          </span>
          <p className="text-sm font-medium text-slate-600">Camera off</p>
        </div>
      )}
      <p className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-800 shadow">You</p>
      {stream && trackingEyes && (
        <p className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-emerald-700 shadow">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          Eye contact tracking on
        </p>
      )}
    </div>
  )
}
