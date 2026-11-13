import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { makeQuestion, makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

describe('history page', () => {
  it('lists interviews with their state, progress and where to continue', async () => {
    mockedApi.listSessions.mockResolvedValue([
      makeSession({ id: 'a', state: 'PAUSED', questions_answered: 2 }),
      makeSession({ id: 'b', state: 'COMPLETED', questions_answered: 5, context: { input_model: 'TOPIC', topic: 'Databases', subtopics: [] } }),
      makeSession({ id: 'c', state: 'PREPARING', context: null, config: null }),
    ])
    renderApp('/history')

    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Paused')).toBeInTheDocument()
    expect(within(items[0]).getByText(/2 of 5 answered/)).toBeInTheDocument()
    expect(within(items[0]).getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/sessions/a/interview')
    expect(within(items[1]).getByRole('link', { name: 'View report' })).toHaveAttribute('href', '/sessions/b/report')
    expect(within(items[2]).getByText('Untitled interview')).toBeInTheDocument()
    expect(within(items[2]).getByRole('link', { name: 'Continue setup' })).toHaveAttribute('href', '/sessions/c/topic')
  })

  it('invites you to start when there are no interviews', async () => {
    mockedApi.listSessions.mockResolvedValue([])
    renderApp('/history')

    expect(await screen.findByText(/No interviews yet/)).toBeInTheDocument()
  })

  it('offers a retry when the list cannot load', async () => {
    mockedApi.listSessions.mockRejectedValueOnce(new ApiError(0, 'Cannot reach the InterAct server.'))
    mockedApi.listSessions.mockResolvedValueOnce([])
    renderApp('/history')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(/No interviews yet/)).toBeInTheDocument()
  })
})

describe('resuming an interview', () => {
  it('opens a paused interview where it left off', async () => {
    mockedApi.listSessions.mockResolvedValue([makeSession({ id: 's-1', state: 'PAUSED', questions_answered: 2 })])
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'PAUSED', questions_answered: 2 }))
    mockedApi.currentQuestion.mockResolvedValue(makeQuestion({ sequence: 3 }))
    const router = renderApp('/history')

    await userEvent.setup().click(await screen.findByRole('link', { name: 'Resume' }))

    expect(await screen.findByRole('heading', { name: 'Interview paused' })).toBeInTheDocument()
    expect(screen.getByText('2 of 5 questions answered. Your progress is saved.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sessions/s-1/interview')
  })
})
