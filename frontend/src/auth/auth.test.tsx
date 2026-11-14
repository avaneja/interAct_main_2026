import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api, notifySignedOut } from '../api/client'
import { makeUser } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi
const SIGNED_OUT = new ApiError(401, 'You are not signed in.')

function signedOut(options = { providers: ['google', 'github'], dev_login: false }) {
  mockedApi.me.mockRejectedValue(SIGNED_OUT)
  mockedApi.signInOptions.mockResolvedValue(options)
}

const where = (router: ReturnType<typeof renderApp>) => router.state.location.pathname + router.state.location.search

describe('protected pages', () => {
  it.each(['/new', '/history', '/sessions/s-1/interview', '/sessions/s-1/report'])(
    'send a signed-out visitor from %s to sign in, remembering the page',
    async (path) => {
      signedOut()
      const router = renderApp(path)

      expect(await screen.findByRole('heading', { name: 'Sign in to InterAct' })).toBeInTheDocument()
      expect(where(router)).toBe(`/sign-in?${new URLSearchParams({ next: path })}`)
      expect(mockedApi.listSessions).not.toHaveBeenCalled()
      expect(mockedApi.getSession).not.toHaveBeenCalled()
    },
  )

  it('keep the home page public', async () => {
    signedOut()
    const router = renderApp('/')

    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
    expect(where(router)).toBe('/')
  })

  it('offer a retry when the server cannot say who is signed in', async () => {
    mockedApi.me.mockRejectedValueOnce(new ApiError(0, 'Cannot reach the InterAct server.'))
    mockedApi.listSessions.mockResolvedValue([])
    renderApp('/history')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/No interviews yet/)).toBeInTheDocument()
  })

  it('return to sign in when the session ends while a page is open', async () => {
    mockedApi.listSessions.mockResolvedValue([])
    const router = renderApp('/history')
    await screen.findByText(/No interviews yet/)
    mockedApi.me.mockRejectedValue(SIGNED_OUT)
    mockedApi.signInOptions.mockResolvedValue({ providers: ['github'], dev_login: false })

    act(() => notifySignedOut())

    expect(await screen.findByRole('heading', { name: 'Sign in to InterAct' })).toBeInTheDocument()
    expect(where(router)).toBe('/sign-in?next=%2Fhistory')
  })
})

describe('sign-in page', () => {
  it('links to each configured provider, passing on the page to return to', async () => {
    signedOut()
    renderApp('/sign-in?next=%2Fhistory')

    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/login?next=%2Fhistory',
    )
    expect(screen.getByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
      'href',
      '/api/v1/auth/github/login?next=%2Fhistory',
    )
    expect(screen.queryByRole('button', { name: 'Continue as local test user' })).not.toBeInTheDocument()
  })

  it.each(['//evil.example', 'https://evil.example', '/\\evil.example', '/sign-in'])(
    'ignores a return address outside InterAct (%s)',
    async (next) => {
      signedOut({ providers: ['github'], dev_login: false })
      renderApp(`/sign-in?${new URLSearchParams({ next })}`)

      expect(await screen.findByRole('link', { name: 'Continue with GitHub' })).toHaveAttribute(
        'href',
        '/api/v1/auth/github/login?next=%2F',
      )
    },
  )

  it('explains a failed or cancelled sign-in', async () => {
    signedOut()
    renderApp('/sign-in?error=failed')

    expect(await screen.findByText('Sign-in did not finish')).toBeInTheDocument()
  })

  it('says when no sign-in method is set up', async () => {
    signedOut({ providers: [], dev_login: false })
    renderApp('/sign-in')

    expect(await screen.findByText('No sign-in method is set up')).toBeInTheDocument()
  })

  it('signs in as the local test user in development and returns to the page', async () => {
    signedOut({ providers: [], dev_login: true })
    mockedApi.devSignIn.mockImplementation(async () => {
      mockedApi.me.mockResolvedValue(makeUser({ provider: 'dev', display_name: 'Local test user', email: null }))
    })
    mockedApi.listSessions.mockResolvedValue([])
    const router = renderApp('/sign-in?next=%2Fhistory')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue as local test user' }))

    expect(await screen.findByText(/No interviews yet/)).toBeInTheDocument()
    expect(where(router)).toBe('/history')
    expect(screen.getByText('Local test user')).toBeInTheDocument()
  })

  it('shows why the development sign-in failed', async () => {
    signedOut({ providers: [], dev_login: true })
    mockedApi.devSignIn.mockRejectedValue(new ApiError(404, 'Development sign-in is not available.'))
    renderApp('/sign-in')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue as local test user' }))

    expect(await screen.findByText('Development sign-in is not available.')).toBeInTheDocument()
  })

  it('sends someone already signed in straight on', async () => {
    mockedApi.listSessions.mockResolvedValue([])
    const router = renderApp('/sign-in?next=%2Fhistory')

    expect(await screen.findByText(/No interviews yet/)).toBeInTheDocument()
    expect(where(router)).toBe('/history')
  })
})

describe('signing out', () => {
  it('shows who is signed in and signs them out to the home page', async () => {
    mockedApi.listSessions.mockResolvedValue([])
    mockedApi.signOut.mockResolvedValue(undefined)
    const router = renderApp('/history')
    const user = userEvent.setup()

    expect(await screen.findByText('Ada Lovelace')).toHaveAttribute('title', 'ada@example.com')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(mockedApi.signOut).toHaveBeenCalledOnce()
    expect(where(router)).toBe('/')
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
  })

  it('asks to sign in again when a protected page is opened afterwards', async () => {
    mockedApi.listSessions.mockResolvedValue([])
    mockedApi.signOut.mockResolvedValue(undefined)
    mockedApi.signInOptions.mockResolvedValue({ providers: ['github'], dev_login: false })
    const router = renderApp('/history')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await screen.findByRole('link', { name: 'Sign in' })

    await user.click(screen.getByRole('link', { name: 'History' }))

    expect(await screen.findByRole('heading', { name: 'Sign in to InterAct' })).toBeInTheDocument()
    expect(where(router)).toBe('/sign-in?next=%2Fhistory')
  })

  it('stays signed in and says so when the server could not sign out', async () => {
    mockedApi.listSessions.mockResolvedValue([])
    mockedApi.signOut.mockRejectedValue(new ApiError(0, 'Cannot reach the InterAct server.'))
    const router = renderApp('/history')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Could not sign out. Try again.')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(where(router)).toBe('/history')
  })
})
