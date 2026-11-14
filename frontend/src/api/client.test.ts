import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, onSignedOut, signInUrl } from './client'

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('sends JSON to the versioned API path and returns the body', async () => {
    const fetch = respond(201, { id: 's-1', state: 'PREPARING' })
    vi.stubGlobal('fetch', fetch)

    const session = await api.createSession('TOPIC')

    expect(session).toEqual({ id: 's-1', state: 'PREPARING' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/sessions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({ input_model: 'TOPIC' })
  })

  it('sends no body or content type on a GET', async () => {
    const fetch = respond(200, [])
    vi.stubGlobal('fetch', fetch)

    await api.listSessions()

    const [, init] = fetch.mock.calls[0]
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers).toBeUndefined()
  })

  it('escapes session ids in the path', async () => {
    const fetch = respond(200, {})
    vi.stubGlobal('fetch', fetch)

    await api.getSession('a/b')

    expect(fetch.mock.calls[0][0]).toBe('/api/v1/sessions/a%2Fb')
  })

  it('turns a backend error into an ApiError with its message', async () => {
    vi.stubGlobal('fetch', respond(409, { detail: 'Cannot START while the session is CONFIGURING.' }))

    const error = await api.start('s-1').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: 'Cannot START while the session is CONFIGURING.' })
    expect((error as ApiError).isRetryable).toBe(false)
  })

  it('lists validation problems by field', async () => {
    vi.stubGlobal('fetch', respond(422, { detail: [
      { loc: ['body', 'question_count'], msg: 'Input should be 5, 10 or 15' },
      { loc: ['body', 'topic'], msg: 'String should have at least 1 character' },
    ] }))

    const error = await api.setConfig('s-1', {} as never).catch((e: unknown) => e)

    expect((error as ApiError).message).toBe(
      'question_count: Input should be 5, 10 or 15; topic: String should have at least 1 character',
    )
  })

  it('marks a model failure as retryable', async () => {
    vi.stubGlobal('fetch', respond(503, { detail: 'The model could not evaluate answer after 2 tries.' }))

    const error = (await api.submitAnswer('s-1', 'q-1', 'An answer').catch((e: unknown) => e)) as ApiError

    expect(error.status).toBe(503)
    expect(error.isRetryable).toBe(true)
  })

  it('explains when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const error = (await api.listSessions().catch((e: unknown) => e)) as ApiError

    expect(error.status).toBe(0)
    expect(error.message).toMatch(/Cannot reach the InterAct server/)
    expect(error.isRetryable).toBe(true)
  })

  it('handles an error response that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })))

    const error = (await api.listSessions().catch((e: unknown) => e)) as ApiError

    expect(error.message).toBe('The server answered with an error (HTTP 502).')
  })

  it('lets a cancelled request stay cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))

    await expect(api.listSessions()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('returns nothing for an empty 204 reply', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(api.signOut()).resolves.toBeUndefined()
  })

  it('tells listeners when the server says the user is signed out', async () => {
    vi.stubGlobal('fetch', respond(401, { detail: 'You are not signed in.' }))
    const listener = vi.fn()
    const stop = onSignedOut(listener)

    const error = await api.listSessions().catch((e: unknown) => e)
    stop()
    await api.listSessions().catch(() => undefined)

    expect((error as ApiError).status).toBe(401)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not treat other errors as signing out', async () => {
    vi.stubGlobal('fetch', respond(404, { detail: 'Session not found.' }))
    const listener = vi.fn()
    const stop = onSignedOut(listener)

    await api.getSession('s-1').catch(() => undefined)
    stop()

    expect(listener).not.toHaveBeenCalled()
  })

  it('builds the provider sign-in address with the page to return to', () => {
    expect(signInUrl('google', '/sessions/a b/report')).toBe('/api/v1/auth/google/login?next=%2Fsessions%2Fa+b%2Freport')
  })
})
