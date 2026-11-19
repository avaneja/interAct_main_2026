import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import type { PreparationMessage, PreparationView } from '../api/types'
import { makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

const mockedApi = api as unknown as MockedApi

const REQUEST = 'Interview me on machine learning for an ML internship.'
const preparing = makeSession({ state: 'PREPARING', context: null, config: null, plan: null, questions_asked: 0 })
const scope = { input_model: 'TOPIC' as const, topic: 'Machine learning', goal: 'an ML internship', level: null, subtopics: [] }

const say = (role: PreparationMessage['role'], kind: PreparationMessage['kind'], content: string) => ({ role, kind, content })

function chat(messages: PreparationMessage[], overrides: Partial<PreparationView> = {}): PreparationView {
  const last = messages[messages.length - 1]
  return {
    messages,
    context: scope,
    question: last?.kind === 'question' ? last.content : null,
    done: last?.kind === 'summary',
    questions_asked: messages.filter((m) => m.kind === 'question').length,
    max_questions: 4,
    ...overrides,
  }
}

const asking = chat([say('user', 'request', REQUEST), say('assistant', 'question', 'What level are you at?')])
const summary = 'Here is the plan: an interview on Machine learning. Change anything you like, then confirm.'
const summarised = chat([...asking.messages, say('user', 'reply', 'Beginner.'), say('assistant', 'summary', summary)], {
  context: { ...scope, level: 'beginner', subtopics: ['overfitting', 'metrics'] },
})

beforeEach(() => {
  mockedApi.getSession.mockResolvedValue(preparing)
})

describe('describing the interview', () => {
  it('asks for a description before calling the server', async () => {
    renderApp('/new')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Describe the interview you want to practise.')).toBeInTheDocument()
    expect(mockedApi.createSession).not.toHaveBeenCalled()
  })

  it('creates the session, sends the request and opens the chat', async () => {
    mockedApi.createSession.mockResolvedValue(preparing)
    mockedApi.prepareMessage.mockResolvedValue(asking)
    mockedApi.getPreparation.mockResolvedValue(asking)
    const user = userEvent.setup()
    const router = renderApp('/new')

    await user.type(await screen.findByLabelText('Your interview'), REQUEST)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockedApi.createSession).toHaveBeenCalledWith('TOPIC')
    expect(mockedApi.prepareMessage).toHaveBeenCalledWith('s-1', { text: REQUEST })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/prepare'), { timeout: 3000 })
    const conversation = await screen.findByRole('list', { name: 'Conversation' })
    expect(within(conversation).getByText(REQUEST)).toBeInTheDocument()
    expect(within(conversation).getByText('What level are you at?')).toBeInTheDocument()
  })

  it('retries without creating a second session', async () => {
    mockedApi.createSession.mockResolvedValue(preparing)
    mockedApi.prepareMessage.mockRejectedValueOnce(new ApiError(503, 'The model could not prepare turn.'))
    mockedApi.prepareMessage.mockResolvedValueOnce(asking)
    mockedApi.getPreparation.mockResolvedValue(asking)
    const user = userEvent.setup()
    renderApp('/new')

    await user.type(await screen.findByLabelText('Your interview'), REQUEST)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('The model could not prepare turn.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('What level are you at?')).toBeInTheDocument()
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1)
  })

  it('offers the form instead', async () => {
    renderApp('/new')
    expect(await screen.findByRole('link', { name: 'Fill in a form instead' })).toHaveAttribute('href', '/new/form')
  })

  it('starts with the description when a prepared session has no messages yet', async () => {
    mockedApi.getPreparation.mockResolvedValue(chat([]))
    renderApp('/sessions/s-1/prepare')
    expect(await screen.findByLabelText('Your interview')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fill in a form instead' })).toHaveAttribute('href', '/sessions/s-1/topic')
  })
})

describe('the clarification chat', () => {
  it('sends a reply', async () => {
    mockedApi.getPreparation.mockResolvedValue(asking)
    mockedApi.prepareMessage.mockResolvedValue(summarised)
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    await user.type(await screen.findByLabelText('Your reply'), 'Beginner.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockedApi.prepareMessage).toHaveBeenCalledWith('s-1', { text: 'Beginner.' })
    expect(await screen.findByText(summary)).toBeInTheDocument()
  })

  it('can skip a question', async () => {
    mockedApi.getPreparation.mockResolvedValue(asking)
    const next = chat([...asking.messages, say('user', 'skip', '(skipped)'), say('assistant', 'question', 'Which areas?')])
    mockedApi.prepareMessage.mockResolvedValue(next)
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    await user.click(await screen.findByRole('button', { name: 'Skip this question' }))

    expect(mockedApi.prepareMessage).toHaveBeenCalledWith('s-1', { skip: true })
    expect(await screen.findByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('Which areas?')).toBeInTheDocument()
  })

  it('can stop the questions and go to the plan', async () => {
    mockedApi.getPreparation.mockResolvedValue(asking)
    mockedApi.prepareMessage.mockResolvedValue(summarised)
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    await user.click(await screen.findByRole('button', { name: "That's enough, show the plan" }))

    expect(mockedApi.prepareMessage).toHaveBeenCalledWith('s-1', { text: '', enough: true })
    expect(await screen.findByRole('form', { name: 'Your interview plan' })).toBeInTheDocument()
  })

  it('keeps the reply when sending fails', async () => {
    mockedApi.getPreparation.mockResolvedValue(asking)
    mockedApi.prepareMessage.mockRejectedValue(new ApiError(0, 'Cannot reach the InterAct server.'))
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    await user.type(await screen.findByLabelText('Your reply'), 'Beginner.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText(/Cannot reach the InterAct server/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toHaveValue('Beginner.')
  })

  it('moves on when the scope is already confirmed', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'CONFIGURING', config: null, plan: null }))
    mockedApi.getPreparation.mockResolvedValue(summarised)
    const router = renderApp('/sessions/s-1/prepare')

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/configure'), { timeout: 3000 })
  })
})

describe('confirming the plan', () => {
  it('shows the proposed scope, lets the candidate edit it and saves it only on confirm', async () => {
    mockedApi.getPreparation.mockResolvedValue(summarised)
    mockedApi.setContext.mockResolvedValue(makeSession({ state: 'CONFIGURING', config: null, plan: null }))
    const user = userEvent.setup()
    const router = renderApp('/sessions/s-1/prepare')

    const plan = await screen.findByRole('form', { name: 'Your interview plan' })
    expect(within(plan).getByLabelText('Topic')).toHaveValue('Machine learning')
    expect(within(plan).getByLabelText('Your level (optional)')).toHaveValue('beginner')
    expect(within(plan).getByLabelText('Subtopics to focus on (optional)')).toHaveValue('overfitting, metrics')
    expect(mockedApi.setContext).not.toHaveBeenCalled()

    await user.clear(within(plan).getByLabelText('Subtopics to focus on (optional)'))
    await user.type(within(plan).getByLabelText('Subtopics to focus on (optional)'), 'overfitting, cross-validation')
    await user.click(within(plan).getByRole('button', { name: 'Confirm and choose settings' }))

    expect(mockedApi.setContext).toHaveBeenCalledWith('s-1', {
      input_model: 'TOPIC', topic: 'Machine learning', goal: 'an ML internship', level: 'beginner',
      subtopics: ['overfitting', 'cross-validation'],
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/configure'), { timeout: 3000 })
  })

  it('checks the edited plan before saving', async () => {
    mockedApi.getPreparation.mockResolvedValue(summarised)
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    const plan = await screen.findByRole('form', { name: 'Your interview plan' })
    await user.clear(within(plan).getByLabelText('Topic'))
    await user.click(within(plan).getByRole('button', { name: 'Confirm and choose settings' }))

    expect(within(plan).getByText('Enter a topic to practise.')).toBeInTheDocument()
    expect(mockedApi.setContext).not.toHaveBeenCalled()
  })
})

describe('reading the questions aloud', () => {
  const spoken: string[] = []

  beforeEach(() => {
    spoken.length = 0
    localStorage.clear()
    class FakeUtterance {
      text: string
      onend: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', {
      speak: (utterance: FakeUtterance) => {
        spoken.push(utterance.text)
        utterance.onend?.()
      },
      cancel: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads each new line aloud, but not the ones already there', async () => {
    mockedApi.getPreparation.mockResolvedValue(asking)
    mockedApi.prepareMessage.mockResolvedValue(summarised)
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    await user.type(await screen.findByLabelText('Your reply'), 'Beginner.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(spoken).toEqual([summary]))
  })

  it('can be turned off, and remembers that', async () => {
    mockedApi.getPreparation.mockResolvedValue(asking)
    mockedApi.prepareMessage.mockResolvedValue(summarised)
    const user = userEvent.setup()
    renderApp('/sessions/s-1/prepare')

    await user.click(await screen.findByLabelText("Read Maya's questions aloud"))
    await user.type(screen.getByLabelText('Your reply'), 'Beginner.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText(summary)).toBeInTheDocument()
    expect(spoken).toEqual([])
    expect(localStorage.getItem('interact.prepare.voice')).toBe('off')
  })
})
