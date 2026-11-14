import { Navigate, Outlet, useLocation } from 'react-router'
import { Alert, Button, Spinner } from '../components/ui'
import { signInPath } from '../lib/nextPath'
import { useAuth } from './context'

/**
 * Shows the pages inside it only to a signed-in user. Someone who just signed
 * out goes to the home page; anyone else goes to sign in and comes back after.
 */
export default function RequireAuth() {
  const { state, refresh } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <Alert
        title="Cannot check whether you are signed in"
        action={
          <Button variant="secondary" onClick={refresh}>
            Try again
          </Button>
        }
      >
        {state.error.message}
      </Alert>
    )
  }
  if (state.status === 'signed-out') {
    if (state.fromPage === location.key) return <Navigate to="/" replace />
    return <Navigate to={signInPath(location.pathname + location.search)} replace />
  }
  return <Outlet />
}
