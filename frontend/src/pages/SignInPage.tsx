import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { ApiError, api, signInUrl } from '../api/client'
import type { SignInProvider } from '../api/types'
import { useAuth } from '../auth/context'
import { Alert, Button, Card, PageTitle, Spinner } from '../components/ui'
import { safeNext } from '../lib/nextPath'
import { useLoad } from '../lib/useLoad'

const PROVIDER_LABELS: Record<SignInProvider, string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
}

export default function SignInPage() {
  const { state } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  if (state.status === 'signed-in') return <Navigate to={next} replace />
  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <Spinner />
      </div>
    )
  }
  return <SignInOptions next={next} failed={params.get('error') === 'failed'} />
}

function SignInOptions({ next, failed }: { next: string; failed: boolean }) {
  const { refresh } = useAuth()
  const options = useLoad((signal) => api.signInOptions(signal), 'sign-in-options')
  const [devBusy, setDevBusy] = useState(false)
  const [devError, setDevError] = useState<string | null>(null)

  async function devSignIn() {
    setDevBusy(true)
    setDevError(null)
    try {
      await api.devSignIn()
      refresh()
    } catch (caught) {
      setDevError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.')
    } finally {
      setDevBusy(false)
    }
  }

  const available = options.data
  const nothingSetUp = available && available.providers.length === 0 && !available.dev_login

  return (
    <section className="mx-auto max-w-md">
      <PageTitle title="Sign in to InterAct" subtitle="Your interviews and reports are saved to your account." />

      <div className="space-y-4">
        {failed && (
          <Alert title="Sign-in did not finish">
            You may have cancelled it, or the provider could not be reached. Try again.
          </Alert>
        )}

        <Card className="space-y-3">
          {options.loading && (
            <div className="flex justify-center py-4 text-slate-500">
              <Spinner />
            </div>
          )}
          {options.error && (
            <Alert
              action={
                <Button variant="secondary" onClick={options.reload}>
                  Try again
                </Button>
              }
            >
              {options.error.message}
            </Alert>
          )}
          {available?.providers.map((provider) => (
            <a
              key={provider}
              href={signInUrl(provider, next)}
              className="flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {PROVIDER_LABELS[provider]}
            </a>
          ))}
          {available?.dev_login && (
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <p className="text-xs text-slate-500">Development only. Not available on the deployed site.</p>
              <Button variant="secondary" className="w-full" busy={devBusy} onClick={devSignIn}>
                Continue as local test user
              </Button>
            </div>
          )}
          {devError && <Alert>{devError}</Alert>}
          {nothingSetUp && (
            <Alert kind="info" title="No sign-in method is set up">
              Add Google or GitHub keys to backend/.env, as described in docs/oauth-setup.md.
            </Alert>
          )}
        </Card>

        <p className="text-xs text-slate-400">
          InterAct keeps only your name and email address from Google or GitHub. It never sees your password.
        </p>
      </div>
    </section>
  )
}
