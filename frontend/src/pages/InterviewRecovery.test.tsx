import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { makeQuestion, makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

const modelDown = new ApiError(503, 'The model could not evaluate answer after 2 tries. Nothing was scored or created; try again.')
const second = makeQuestion({ id: 'q-2', sequence: 2, prompt: 'Why does paging help?' })

function scoringInterrupted() {
  mockedApi.getSession.mockResolvedValue(makeSession({ state: 'EVALUATING', questions_answered: 1 }))
}

describe('interview recovery', () => {
  it('shows the retry view when the model fails after the answer is saved', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession())
    mockedApi.currentQuestion.mockResolvedValue(makeQuestion())
    mockedApi.submitAnswer.mockImplementation(async () => {
      scoringInterrupted()
      throw modelDown
    })
    const user = userEvent.setup()
    renderApp('/sessions/s-1/interview')

    await user.type(await screen.findByLabelText('Your answer'), 'A running program.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(await screen.findByText('Your last answer is saved, but scoring did not finish')).toBeInTheDocument()
    expect(screen.getByText(/no score was guessed/)).toBeInTheDocument()
  })

  it('retries scoring and continues with the next question', async () => {
    scoringInterrupted()
    mockedApi.retry.mockImplementation(async () => {
      mockedApi.getSession.mockResolvedValue(makeSession({ questions_answered: 1 }))
      mockedApi.currentQuestion.mockResolvedValue(second)
      return { state: 'IN_PROGRESS', next_question: second, completed: false }
    })
    renderApp('/sessions/s-1/interview')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try scoring again' }))

    expect(await screen.findByRole('heading', { name: 'Why does paging help?' })).toBeInTheDocument()
    expect(mockedApi.retry).toHaveBeenCalledWith('s-1')
  })

  it('says so when scoring fails again', async () => {
    scoringInterrupted()
    mockedApi.retry.mockRejectedValue(modelDown)
    renderApp('/sessions/s-1/interview')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Try scoring again' }))

    expect(await screen.findByText('Scoring failed again')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try scoring again' })).toBeEnabled()
  })

  it('keeps the typed answer when the server cannot be reached', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession())
    mockedApi.currentQuestion.mockResolvedValue(makeQuestion())
    mockedApi.submitAnswer.mockRejectedValueOnce(new ApiError(0, 'Cannot reach the InterAct server.'))
    mockedApi.submitAnswer.mockReturnValueOnce(new Promise(() => {}))
    const user = userEvent.setup()
    renderApp('/sessions/s-1/interview')

    await user.type(await screen.findByLabelText('Your answer'), 'A running program.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(await screen.findByText(/Your text is still here, so you can send it again/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your answer')).toHaveValue('A running program.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(mockedApi.submitAnswer).toHaveBeenCalledTimes(2)
  })

  it('shows a waiting notice while the answer is scored', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession())
    mockedApi.currentQuestion.mockResolvedValue(makeQuestion())
    mockedApi.submitAnswer.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderApp('/sessions/s-1/interview')

    await user.type(await screen.findByLabelText('Your answer'), 'A running program.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(await screen.findByText(/Scoring your answer and preparing what comes next/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your answer')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Submitting/ })).toBeDisabled()
  })
})
