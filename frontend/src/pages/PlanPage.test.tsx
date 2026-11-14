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

const configured = makeSession({ state: 'CONFIGURING', questions_asked: 0 })

describe('plan page', () => {
  it('shows the topic, settings and the style and focus of every question', async () => {
    mockedApi.getSession.mockResolvedValue(configured)
    renderApp('/sessions/s-1/plan')

    expect(await screen.findByRole('heading', { name: 'Review your interview plan' })).toBeInTheDocument()
    expect(screen.getByText('Operating systems')).toBeInTheDocument()
    const list = screen.getByRole('list') // The planned questions.
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list).getByText('Case-based')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Change settings' })).toHaveAttribute('href', '/sessions/s-1/configure')
  })

  it('confirms, starts and opens the interview', async () => {
    mockedApi.getSession.mockResolvedValue(configured)
    mockedApi.confirmPlan.mockResolvedValue(makeSession({ state: 'READY' }))
    mockedApi.start.mockImplementation(async () => {
      // Like the server: once started, the session is in progress with its first question.
      mockedApi.getSession.mockResolvedValue(makeSession())
      mockedApi.currentQuestion.mockResolvedValue(makeQuestion())
      return makeQuestion()
    })
    const router = renderApp('/sessions/s-1/plan')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Confirm and start' }))

    expect(await screen.findByRole('heading', { name: 'Ready to join?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sessions/s-1/interview')
    expect(mockedApi.confirmPlan).toHaveBeenCalledWith('s-1')
    expect(mockedApi.start).toHaveBeenCalledWith('s-1')
  })

  it('keeps the plan confirmed when starting fails, so a retry only starts', async () => {
    mockedApi.getSession.mockResolvedValue(configured)
    mockedApi.confirmPlan.mockResolvedValue(makeSession({ state: 'READY' }))
    mockedApi.start.mockRejectedValueOnce(new ApiError(503, 'The model could not generate question after 2 tries.'))
    mockedApi.start.mockReturnValueOnce(new Promise(() => {}))
    const user = userEvent.setup()
    renderApp('/sessions/s-1/plan')

    await user.click(await screen.findByRole('button', { name: 'Confirm and start' }))

    expect(await screen.findByText('The model could not generate question after 2 tries.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '← Change settings' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start interview' }))
    expect(mockedApi.confirmPlan).toHaveBeenCalledTimes(1)
    expect(mockedApi.start).toHaveBeenCalledTimes(2)
  })

  it('offers only Start for a plan confirmed earlier', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'READY', questions_asked: 0 }))
    renderApp('/sessions/s-1/plan')

    expect(await screen.findByRole('heading', { name: 'Your plan is confirmed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start interview' })).toBeInTheDocument()
  })
})
