import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import { CLOSING_LINE, acknowledgementLine, greetingLine, welcomeBackLine } from '../call/script'
import { loadDraft } from '../lib/drafts'
import { makeQuestion, makeSession } from '../test/fixtures'
import type { MockedApi } from '../test/mockApi'
import { renderApp } from '../test/renderApp'

vi.mock('../api/client', async (importOriginal) =>
  (await import('../test/mockApi')).mockApiModule(importOriginal))

// The interviewer speaks instantly in captions only, and every line is recorded.
const spoken = vi.hoisted(() => [] as string[])
vi.mock('../call/speaker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../call/speaker')>()
  const instant = {
    lipSync: false,
    prepare: () => {},
    stop: () => {},
    speak: async (text: string, onWord?: (word: string) => void) => {
      spoken.push(text)
      text.split(' ').forEach((word) => onWord?.(word))
    },
  }
  return { ...actual, canUseBrowserVoice: () => false, captionSpeaker: () => instant }
})
// No neural voice, no 3D (jsdom has no WebGL), and no speech recognition: answers are typed.
vi.mock('../call/useVoice', () => ({ useVoice: () => ({ status: 'failed' }) }))
vi.mock('@met4citizen/talkinghead', () => ({
  TalkingHead: class {
    constructor() {
      throw new Error('no WebGL')
    }
  },
}))
vi.mock('../call/recognition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../call/recognition')>()),
  canRecognizeSpeech: () => false,
}))

const mockedApi = api as unknown as MockedApi
const first = makeQuestion()
const second = makeQuestion({ id: 'q-2', sequence: 2, type: 'CONCEPTUAL', prompt: 'Why does paging help?' })
const last = makeQuestion({ id: 'q-5', sequence: 5, prompt: 'Design a scheduler for a phone.' })
const modelDown = new ApiError(503, 'The model could not evaluate the answer. Nothing was scored; try again.')

function atQuestion(question = first, session = makeSession({ questions_answered: question.sequence - 1 })) {
  spoken.length = 0
  mockedApi.getSession.mockResolvedValue(session)
  mockedApi.currentQuestion.mockResolvedValue(question)
}

async function joinCall() {
  const user = userEvent.setup()
  const router = renderApp('/sessions/s-1/interview')
  expect(await screen.findByRole('heading', { name: 'Ready to join?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Join interview' }))
  return { user, router }
}

async function answer(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = await screen.findByLabelText('Your answer')
  await vi.waitFor(() => expect(box).toBeEnabled())
  await user.type(box, text)
  await user.click(screen.getByRole('button', { name: 'Send answer' }))
}

describe('the interview call', () => {
  it('starts in the lobby, then greets the candidate and asks the first question aloud', async () => {
    atQuestion()
    await joinCall()

    expect(await screen.findByText('Question 1 of 5')).toBeInTheDocument()
    await vi.waitFor(() => expect(spoken).toContain(first.prompt))
    expect(spoken).toEqual([greetingLine('Maya', 5, 'Operating systems'), "Here's the first question.", first.prompt])
    expect(screen.getByRole('toolbar', { name: 'Call controls' })).toBeInTheDocument()
    expect(screen.getByText(/Interview with Maya · Question 1 of 5/)).toBeInTheDocument()
  })

  it('sends a typed answer, acknowledges it, and asks the next question', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockResolvedValue({ state: 'IN_PROGRESS', next_question: second, completed: false })
    const { user } = await joinCall()

    await answer(user, 'A process is a running program.')

    expect(await screen.findByText('Why does paging help?')).toBeInTheDocument()
    expect(mockedApi.submitAnswer).toHaveBeenCalledWith('s-1', 'q-1', 'A process is a running program.')
    await vi.waitFor(() => expect(spoken.slice(-3)).toEqual([acknowledgementLine(1), "Here's question 2.", second.prompt]))
    expect(screen.getByText('Question 2 of 5')).toBeInTheDocument()
    expect(loadDraft('q-1')).toBe('')
  })

  it('closes the call and opens the report after the last answer', async () => {
    atQuestion(last)
    mockedApi.submitAnswer.mockResolvedValue({ state: 'IN_PROGRESS', next_question: null, completed: false })
    mockedApi.finish.mockResolvedValue(makeSession({ state: 'COMPLETED' }))
    const { user, router } = await joinCall()

    await answer(user, 'A fair, priority-based scheduler.')

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/report'))
    expect(spoken).toContain(CLOSING_LINE)
    expect(mockedApi.finish).toHaveBeenCalledWith('s-1')
  })

  it('welcomes the candidate back when the interview was already under way', async () => {
    atQuestion(second)
    await joinCall()

    await vi.waitFor(() => expect(spoken).toContain(second.prompt))
    expect(spoken[0]).toBe(welcomeBackLine('Maya'))
  })

  it('keeps the answer and explains when the server cannot be reached', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockRejectedValue(new ApiError(0, 'Cannot reach the InterAct server.'))
    const { user } = await joinCall()

    await answer(user, 'My careful answer')

    expect(await screen.findByText(/Cannot reach the InterAct server. Your answer is still here/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your answer')).toHaveValue('My careful answer')
  })

  it('offers to retry scoring when the model fails, then carries on', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockRejectedValue(modelDown)
    mockedApi.retry.mockResolvedValue({ state: 'IN_PROGRESS', next_question: second, completed: false })
    const { user } = await joinCall()

    await answer(user, 'A running program.')
    expect(await screen.findByText('Your last answer is saved, but scoring did not finish')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try scoring again' }))

    expect(await screen.findByText('Why does paging help?')).toBeInTheDocument()
    expect(mockedApi.retry).toHaveBeenCalledWith('s-1')
  })

  it('opens the retry view straight away when scoring was interrupted before a reload', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'EVALUATING', questions_answered: 1 }))
    await joinCall()

    expect(await screen.findByRole('button', { name: 'Try scoring again' })).toBeInTheDocument()
    expect(mockedApi.currentQuestion).not.toHaveBeenCalled()
  })

  it('pauses and resumes the call', async () => {
    atQuestion(second)
    mockedApi.pause.mockResolvedValue(makeSession({ state: 'PAUSED' }))
    mockedApi.resume.mockResolvedValue(makeSession())
    const { user } = await joinCall()
    await vi.waitFor(() => expect(spoken).toContain(second.prompt))

    await user.click(screen.getByRole('button', { name: 'Pause interview' }))
    expect(await screen.findByRole('heading', { name: 'Interview paused' })).toBeInTheDocument()
    expect(screen.getByText(/1 of 5 questions answered/)).toBeInTheDocument()

    spoken.length = 0
    await user.click(screen.getByRole('button', { name: 'Resume interview' }))

    await vi.waitFor(() => expect(spoken).toEqual(["Let's continue.", "Here's question 2.", second.prompt]))
    expect(mockedApi.pause).toHaveBeenCalledWith('s-1')
    expect(mockedApi.resume).toHaveBeenCalledWith('s-1')
  })

  it('resumes a paused interview on joining', async () => {
    atQuestion(second, makeSession({ state: 'PAUSED', questions_answered: 1 }))
    mockedApi.resume.mockResolvedValue(makeSession())
    await joinCall()

    await vi.waitFor(() => expect(spoken).toContain(second.prompt))
    expect(mockedApi.resume).toHaveBeenCalledWith('s-1')
  })

  it('asks before ending early, then opens the report', async () => {
    atQuestion(second)
    mockedApi.finish.mockResolvedValue(makeSession({ state: 'COMPLETED' }))
    const { user, router } = await joinCall()

    await user.click(screen.getByRole('button', { name: 'End interview' }))
    const confirm = screen.getByRole('heading', { name: 'End the interview now?' }).closest('div')!
    expect(within(confirm).getByText(/covers the 1 answered so far/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yes, end now' }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/report'))
    expect(mockedApi.finish).toHaveBeenCalledWith('s-1')
  })

  it('can keep going instead of ending', async () => {
    atQuestion()
    const { user } = await joinCall()

    await user.click(screen.getByRole('button', { name: 'End interview' }))
    await user.click(screen.getByRole('button', { name: 'Keep going' }))

    expect(await screen.findByLabelText('Your answer')).toBeInTheDocument()
    expect(mockedApi.finish).not.toHaveBeenCalled()
  })

  it('sends a finished interview to its report', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'COMPLETED' }))
    const router = renderApp('/sessions/s-1/interview')

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/report'))
  })
})
