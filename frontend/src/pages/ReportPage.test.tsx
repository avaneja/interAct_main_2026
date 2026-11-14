import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { makeQuestion, makeReport, makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

describe('report page', () => {
  it('shows the overall score, notices, competencies, coverage and areas to revise', async () => {
    mockedApi.report.mockResolvedValue(makeReport())
    renderApp('/sessions/s-1/report')

    expect(await screen.findByRole('heading', { name: 'Your report: Operating systems' })).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('12 of 20 rubric points')).toBeInTheDocument()
    expect(screen.getByText(/practice estimate, not a hiring decision/)).toBeInTheDocument()
    expect(screen.getByText(/ended early/)).toBeInTheDocument()
    expect(screen.getByText('90% · 1 question')).toBeInTheDocument()
    expect(screen.getByText(/2 of 3 planned areas assessed \(67%\)/)).toBeInTheDocument()
    expect(screen.getByText('Not assessed: scheduling.')).toBeInTheDocument()
    expect(screen.getAllByText('memory').length).toBeGreaterThan(0)
  })

  it('shows each question with the answer, scores, quotes and a better-answer outline', async () => {
    mockedApi.report.mockResolvedValue(makeReport())
    const user = userEvent.setup()
    renderApp('/sessions/s-1/report')

    await user.click(await screen.findByText('What is a process?'))

    expect(screen.getByText('A running program with its own memory.')).toBeVisible()
    expect(screen.getByText('“its own memory”')).toBeVisible()
    expect(screen.getByText('Mention the process control block.')).toBeVisible()
    expect(screen.getByText('9/10')).toBeInTheDocument()
    expect(screen.getByText('Not answered')).toBeInTheDocument()
  })

  it('shows the follow-up questions and replies under the answer', async () => {
    mockedApi.report.mockResolvedValue(makeReport())
    renderApp('/sessions/s-1/report')

    await userEvent.setup().click(await screen.findByText('What is a process?'))

    expect(screen.getByText('Follow-up: What does its own memory mean?')).toBeVisible()
    expect(screen.getByText('Its own address space.')).toBeVisible()
    expect(screen.getByText(/scored together with your answer/)).toBeVisible()
  })

  it('explains a low-confidence grade', async () => {
    mockedApi.report.mockResolvedValue(makeReport())
    const user = userEvent.setup()
    renderApp('/sessions/s-1/report')

    await user.click(await screen.findByText('Why does paging help?'))

    expect(screen.getByText(/could not be graded with confidence: the answer does not address the question/)).toBeVisible()
  })

  it('sends an unfinished interview back to the interview', async () => {
    mockedApi.report.mockRejectedValue(new ApiError(409, 'The report is ready once the interview is completed.'))
    mockedApi.getSession.mockResolvedValue(makeSession())
    mockedApi.currentQuestion.mockResolvedValue(makeQuestion())
    const router = renderApp('/sessions/s-1/report')

    expect(await screen.findByRole('heading', { name: 'Ready to join?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sessions/s-1/interview')
  })
})
