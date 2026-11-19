import { useEffect, useState } from 'react'
import { Spinner } from './ui'

const SLOW_AFTER_SECONDS = 45

/** Shown while a slow model call runs, with how long it has taken so far. */
export default function WaitingNotice({ message, startedAt }: { message: string; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return (
    <div className="flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="status">
      <span className="mt-0.5">
        <Spinner />
      </span>
      <div>
        <p>
          {message} <span className="tabular-nums text-sky-700">{seconds}s</span>
        </p>
        <p className="mt-1 text-sky-700">
          {seconds >= SLOW_AFTER_SECONDS
            ? 'Still working. Local models can be slow; your answer is already saved, so you can keep waiting.'
            : 'With a local model this usually takes 10 to 60 seconds.'}
        </p>
      </div>
    </div>
  )
}
