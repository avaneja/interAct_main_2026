import { createContext, useContext } from 'react'
import type { ApiError } from '../api/client'
import type { Me } from '../api/types'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-in'; user: Me }
  // fromPage: the router location key of the page where they pressed Sign out
  // (absent when the session ended on its own).
  | { status: 'signed-out'; fromPage?: string }
  | { status: 'error'; error: ApiError }

export interface Auth {
  state: AuthState
  /** Ask the server again who is signed in, for example after the development sign-in. */
  refresh: () => void
  /** Sign out on the server. Throws, and stays signed in, if the server could not sign out. */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<Auth | null>(null)

export function useAuth(): Auth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>')
  return auth
}
