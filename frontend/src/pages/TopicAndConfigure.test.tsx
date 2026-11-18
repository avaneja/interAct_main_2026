import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { parseSubtopics, validateDraft } from '../lib/topicForm'
import { makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

const configuring = makeSession({ state: 'CONFIGURING', config: null, plan: null, questions_asked: 0 })

describe('topic form rules', () => {
  it('splits subtopics on commas and new lines', () => {
    expect(parseSubtopics(' processes, memory\nscheduling ,, ')).toEqual(['processes', 'memory', 'scheduling'])
  })

  it('needs a topic and rejects duplicate or too many subtopics', () => {
    const blank = { topic: ' ', goal: '', level: '' as const, subtopics: '' }
    expect(validateDraft(blank).topic).toBe('Enter a topic to practise.')
    expect(validateDraft({ ...blank, topic: 'OS', subtopics: 'Memory, memory' }).subtopics).toMatch(/only once/)
    expect(validateDraft({ ...blank, topic: 'OS', subtopics: Array.from({ length: 21 }, (_, i) => `t${i}`).join(',') }).subtopics).toMatch(/at most 20/)
    expect(validateDraft({ ...blank, topic: 'x'.repeat(201) }).topic).toMatch(/under 200/)
  })
})

describe('topic form page', () => {
  it('checks the form before calling the server', async () => {
    renderApp('/new/form')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue to settings' }))

    expect(screen.getByText('Enter a topic to practise.')).toBeInTheDocument()
    expect(mockedApi.createSession).not.toHaveBeenCalled()
  })

  it('creates the session, saves the topic and moves to settings', async () => {
    mockedApi.createSession.mockResolvedValue(makeSession({ state: 'PREPARING', context: null }))
    mockedApi.setContext.mockResolvedValue(configuring)
    mockedApi.getSession.mockResolvedValue(configuring)
    const user = userEvent.setup()
    const router = renderApp('/new/form')

    await user.type(await screen.findByLabelText('Topic'), 'Operating systems')
    await user.type(screen.getByLabelText('Goal (optional)'), 'internship')
    await user.selectOptions(screen.getByLabelText('Your level (optional)'), 'beginner')
    await user.type(screen.getByLabelText('Subtopics to focus on (optional)'), 'processes, memory')
    await user.click(screen.getByRole('button', { name: 'Continue to settings' }))

    expect(mockedApi.createSession).toHaveBeenCalledWith('TOPIC')
    expect(mockedApi.setContext).toHaveBeenCalledWith('s-1', {
      input_model: 'TOPIC', topic: 'Operating systems', goal: 'internship', level: 'beginner', subtopics: ['processes', 'memory'],
    })
    expect(await screen.findByRole('heading', { name: 'Interview settings' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sessions/s-1/configure')
  })

  it('shows a server error and retries without creating a second session', async () => {
    mockedApi.createSession.mockResolvedValue(makeSession({ state: 'PREPARING', context: null }))
    mockedApi.setContext.mockRejectedValueOnce(new ApiError(0, 'Cannot reach the InterAct server.'))
    mockedApi.setContext.mockResolvedValueOnce(configuring)
    mockedApi.getSession.mockResolvedValue(configuring)
    const user = userEvent.setup()
    renderApp('/new/form')

    await user.type(await screen.findByLabelText('Topic'), 'Operating systems')
    await user.click(screen.getByRole('button', { name: 'Continue to settings' }))
    expect(await screen.findByText('Cannot reach the InterAct server.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue to settings' }))

    expect(await screen.findByRole('heading', { name: 'Interview settings' })).toBeInTheDocument()
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1)
  })

  it('edits the topic of an existing session', async () => {
    mockedApi.getSession.mockResolvedValue(configuring)
    renderApp('/sessions/s-1/topic')

    expect(await screen.findByRole('heading', { name: 'Edit your topic' })).toBeInTheDocument()
    expect(screen.getByLabelText('Topic')).toHaveValue('Operating systems')
    expect(screen.getByLabelText('Subtopics to focus on (optional)')).toHaveValue('processes, memory')
  })
})

describe('settings page', () => {
  it('saves the chosen settings and moves to the plan', async () => {
    mockedApi.getSession.mockResolvedValue(configuring)
    mockedApi.setConfig.mockImplementation(async () => {
      // Like the server: once saved, the session has its configuration and plan.
      mockedApi.getSession.mockResolvedValue(makeSession({ state: 'CONFIGURING' }))
      return makeSession({ state: 'CONFIGURING' })
    })
    const user = userEvent.setup()
    const router = renderApp('/sessions/s-1/configure')

    await user.click(await screen.findByText('Case-based'))
    await user.click(screen.getByText('Advanced'))
    await user.click(screen.getByText('10'))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Review the plan' }))

    expect(await screen.findByRole('heading', { name: 'Review your interview plan' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sessions/s-1/plan')
    expect(mockedApi.setConfig).toHaveBeenCalledWith('s-1', {
      question_type: 'CASE_BASED', difficulty: 'advanced', question_count: 10, adaptive: false, feedback_timing: 'END',
    })
  })

  it('sends a session that is past setup to where it continues', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'READY' }))
    const router = renderApp('/sessions/s-1/configure')

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/plan'))
  })

  it('shows why settings could not be saved', async () => {
    mockedApi.getSession.mockResolvedValue(configuring)
    mockedApi.setConfig.mockRejectedValue(new ApiError(422, 'question_count: Input should be 5, 10 or 15'))
    const user = userEvent.setup()
    renderApp('/sessions/s-1/configure')

    await user.click(await screen.findByRole('button', { name: 'Review the plan' }))

    expect(await screen.findByText('question_count: Input should be 5, 10 or 15')).toBeInTheDocument()
  })
})
