import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { ApiError, api, onSignedOut } from '../api/client'
import { AuthContext, type AuthState } from './context'

/** Knows who is signed in. The server is the only source of truth: it reads the signed session cookie. */
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const location = useLocation()

  useEffect(() => {
    const controller = new AbortController()
    api.me(controller.signal).then(
      (user) => setState({ status: 'signed-in', user }),
      (caught: unknown) => {
        if (controller.signal.aborted) return
        if (caught instanceof ApiError && caught.status === 401) {
          setState({ status: 'signed-out' })
        } else {
          const error = caught instanceof ApiError ? caught : new ApiError(0, 'Something went wrong. Try again.')
          setState({ status: 'error', error })
        }
      },
    )
    return () => controller.abort()
  }, [attempt])

  // Any 401 means the session ended (expired, or signed out in another tab).
  useEffect(() => onSignedOut(() => setState({ status: 'signed-out' })), [])

  const refresh = () => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  const signOut = async () => {
    await api.signOut()
    setState({ status: 'signed-out', fromPage: location.key })
  }

  return <AuthContext value={{ state, refresh, signOut }}>{children}</AuthContext>
}
