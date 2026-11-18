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
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-800">
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
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-600 text-2xl font-semibold text-white">
            {(name[0] ?? 'Y').toUpperCase()}
          </span>
          <p className="text-sm text-slate-400">Camera off</p>
        </div>
      )}
      <p className="absolute bottom-3 left-3 rounded-md bg-slate-950/70 px-2 py-1 text-xs font-medium text-white">You</p>
      {stream && trackingEyes && (
        <p className="absolute right-3 top-3 rounded-md bg-slate-950/70 px-2 py-1 text-xs font-medium text-emerald-300">
          Eye contact tracking on
        </p>
      )}
    </div>
  )
}
