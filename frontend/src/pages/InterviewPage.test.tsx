import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api/client'
import { describe, expect, it, vi } from 'vitest'
import { makeQuestion, makeReport, makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

const second = makeQuestion({ id: 'q-2', sequence: 2, type: 'CONCEPTUAL', competency: 'memory', prompt: 'Why does paging help?' })

function atQuestion(question = makeQuestion(), answered = 0) {
  mockedApi.getSession.mockResolvedValue(makeSession({ questions_answered: answered, questions_asked: answered + 1 }))
  mockedApi.currentQuestion.mockResolvedValue(question)
}

describe('interview page', () => {
  it('shows one question with its progress, style, focus and difficulty', async () => {
    atQuestion()
    renderApp('/sessions/s-1/interview')

    expect(await screen.findByRole('heading', { name: 'What is a process?' })).toBeInTheDocument()
    expect(screen.getByText('Question 1 of 5')).toBeInTheDocument()
    expect(screen.getByText('Direct')).toBeInTheDocument()
    expect(screen.getByText('processes')).toBeInTheDocument()
    expect(screen.getByText('Intermediate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled()
  })

  it('submits the answer and moves to the next question', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockImplementation(async () => {
      atQuestion(second, 1)
      return { state: 'IN_PROGRESS', next_question: second, completed: false }
    })
    const user = userEvent.setup()
    renderApp('/sessions/s-1/interview')

    await user.type(await screen.findByLabelText('Your answer'), 'A running program.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(await screen.findByRole('heading', { name: 'Why does paging help?' })).toBeInTheDocument()
    expect(mockedApi.submitAnswer).toHaveBeenCalledWith('s-1', 'q-1', 'A running program.')
    expect(screen.getByLabelText('Your answer')).toHaveValue('')
    expect(localStorage.getItem('interact:draft:q-1')).toBeNull() // The sent draft is cleared.
    expect(screen.getByText('1 answered')).toBeInTheDocument()
  })

  it('keeps an unsent draft across a reload', async () => {
    atQuestion()
    const user = userEvent.setup()
    renderApp('/sessions/s-1/interview')
    await user.type(await screen.findByLabelText('Your answer'), 'Half written')
    expect(localStorage.getItem('interact:draft:q-1')).toBe('Half written')

    cleanup() // Leave the page, as a reload would.
    renderApp('/sessions/s-1/interview')

    expect(await screen.findByLabelText('Your answer')).toHaveValue('Half written')
  })

  it('opens the report after the last answer', async () => {
    atQuestion(makeQuestion({ sequence: 5 }), 4)
    mockedApi.submitAnswer.mockResolvedValue({ state: 'COMPLETED', next_question: null, completed: true })
    mockedApi.report.mockResolvedValue(makeReport())
    const user = userEvent.setup()
    const router = renderApp('/sessions/s-1/interview')

    await user.type(await screen.findByLabelText('Your answer'), 'Final answer.')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))

    expect(await screen.findByText('60%')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sessions/s-1/report')
  })

  it('pauses and resumes', async () => {
    atQuestion()
    mockedApi.pause.mockImplementation(async () => {
      mockedApi.getSession.mockResolvedValue(makeSession({ state: 'PAUSED' }))
      return makeSession({ state: 'PAUSED' })
    })
    mockedApi.resume.mockImplementation(async () => {
      mockedApi.getSession.mockResolvedValue(makeSession())
      return makeSession()
    })
    const user = userEvent.setup()
    renderApp('/sessions/s-1/interview')

    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('heading', { name: 'Interview paused' })).toBeInTheDocument()
    expect(screen.queryByText('What is a process?')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume interview' }))
    expect(await screen.findByRole('heading', { name: 'What is a process?' })).toBeInTheDocument()
  })

  it('asks before finishing early, then opens the report', async () => {
    atQuestion()
    mockedApi.finish.mockResolvedValue(makeSession({ state: 'COMPLETED' }))
    mockedApi.report.mockResolvedValue(makeReport())
    const user = userEvent.setup()
    const router = renderApp('/sessions/s-1/interview')

    await user.click(await screen.findByRole('button', { name: 'Finish early' }))
    expect(screen.getByText(/Finishing now skips the remaining questions/)).toBeInTheDocument()
    expect(mockedApi.finish).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes, finish now' }))
    await screen.findByText('60%')
    expect(router.state.location.pathname).toBe('/sessions/s-1/report')
  })
})
