import { useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import AuthProvider from '../auth/AuthProvider'
import { useAuth } from '../auth/context'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
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
    <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
      <span className="max-w-40 truncate text-sm text-slate-300" title={user.email ?? undefined}>
        {user.display_name || user.email || 'Signed in'}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800/60 hover:text-white disabled:text-slate-500"
      >
        Sign out
      </button>
      {failed && (
        <span role="alert" className="text-xs text-red-300">
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
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="border-b border-slate-800">
          <nav className={`mx-auto flex ${wide ? 'max-w-6xl' : 'max-w-4xl'} flex-wrap items-center justify-between gap-4 px-4 py-3`}>
            <Link to="/" className="text-lg font-bold tracking-tight text-white">
              InterAct
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
        <main className={`mx-auto w-full flex-1 px-4 py-8 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}>
          <Outlet />
        </main>
      </div>
    </AuthProvider>
  )
}
