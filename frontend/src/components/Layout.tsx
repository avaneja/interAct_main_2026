import { useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import AuthProvider from '../auth/AuthProvider'
import { useAuth } from '../auth/context'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
    isActive ? 'bg-brand text-white shadow-md shadow-fuchsia-200' : 'text-slate-600 hover:bg-white hover:text-slate-900'
  }`

function Account() {
  const { state, signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (state.status === 'signed-out') {
    return (
      <NavLink to="/sign-in" className={navClass}>
        Sign in
      </NavLink>
    )
  }
  if (state.status !== 'signed-in') return null

  async function handleSignOut() {
    setBusy(true)
    setFailed(false)
    try {
      await signOut()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const { user } = state
  return (
    <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
      <span className="max-w-40 truncate text-sm font-medium text-slate-700" title={user.email ?? undefined}>
        {user.display_name || user.email || 'Signed in'}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="rounded-full px-4 py-1.5 text-sm font-semibold text-slate-600 hover:bg-white hover:text-slate-900 disabled:text-slate-400"
      >
        Sign out
      </button>
      {failed && (
        <span role="alert" className="text-xs font-medium text-rose-600">
          Could not sign out. Try again.
        </span>
      )}
    </div>
  )
}

export default function Layout() {
  // The interview call needs room for the interviewer and the answer panel side by side.
  const wide = useMatch('/sessions/:id/interview') !== null
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col text-slate-900">
        <header className="sticky top-0 z-10 border-b border-white/70 bg-white/70 backdrop-blur">
          <nav className={`mx-auto flex ${wide ? 'max-w-6xl' : 'max-w-5xl'} flex-wrap items-center justify-between gap-4 px-4 py-3`}>
            <Link to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <span className="bg-brand flex h-8 w-8 items-center justify-center rounded-xl text-sm text-white shadow-md shadow-fuchsia-200" aria-hidden>
                iA
              </span>
              <span className="text-brand">InterAct</span>
            </Link>
            <div className="flex flex-wrap items-center gap-1">
              <NavLink to="/new" className={navClass}>
                New interview
              </NavLink>
              <NavLink to="/history" className={navClass}>
                History
              </NavLink>
              <Account />
            </div>
          </nav>
        </header>
        <main className={`mx-auto w-full flex-1 px-4 py-8 ${wide ? 'max-w-6xl' : 'max-w-5xl'}`}>
          <Outlet />
        </main>
      </div>
    </AuthProvider>
  )
}
