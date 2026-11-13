import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

export interface Loaded<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  reload: () => void
  setData: (data: T) => void
}

interface Result<T> {
  key: string
  data: T | null
  error: ApiError | null
}

/**
 * Load data for a page. `key` names what is loaded (for example a session id):
 * a new key, or reload(), starts a fresh request, and a request the page no
 * longer needs is cancelled.
 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Loaded<T> {
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${key}#${attempt}`
  const [result, setResult] = useState<Result<T>>({ key: '', data: null, error: null })
  const loadRef = useRef(load)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    const controller = new AbortController()
    loadRef.current(controller.signal).then(
      (data) => setResult({ key: requestKey, data, error: null }),
      (caught: unknown) => {
        if (controller.signal.aborted) return
        const error = caught instanceof ApiError ? caught : new ApiError(0, 'Something went wrong. Try again.')
        setResult({ key: requestKey, data: null, error })
      },
    )
    return () => controller.abort()
  }, [requestKey])

  const current = result.key === requestKey
  return {
    data: current ? result.data : null,
    error: current ? result.error : null,
    loading: !current,
    reload: () => setAttempt((n) => n + 1),
    setData: (data: T) => setResult({ key: requestKey, data, error: null }),
  }
}
