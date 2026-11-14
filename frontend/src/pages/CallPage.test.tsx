import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, api } from '../api/client'
import {
  WARM_UP_QUESTION,
  WRAP_UP_LINE,
  fillerLine,
  goodbyeLine,
  greetingLine,
  welcomeBackLine,
} from '../call/script'
import { loadDraft } from '../lib/drafts'
import { makeQuestion, makeSession, makeUser } from '../test/fixtures'
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
const second = makeQuestion({
  id: 'q-2', sequence: 2, type: 'CONCEPTUAL', prompt: 'Why does paging help?',
  lead_in: 'Good point about memory. Now, paging.',
})
const followUp = makeQuestion({
  id: 'q-1-1', sequence: 1, follow_up: 1, prompt: 'What does its own memory mean?',
  lead_in: 'You said each process has its own memory.',
})
const last = makeQuestion({ id: 'q-5', sequence: 5, prompt: 'Design a scheduler for a phone.' })
const modelDown = new ApiError(503, 'The model could not generate the question. Nothing was scored or created; try again.')

function atQuestion(question = first, session = makeSession({ questions_answered: question.sequence - 1 })) {
  spoken.length = 0
  mockedApi.getSession.mockResolvedValue(session)
  mockedApi.currentQuestion.mockResolvedValue(question)
  mockedApi.me.mockResolvedValue(makeUser({ display_name: 'Ada Lovelace' }))
}

async function joinCall() {
  const user = userEvent.setup()
  const router = renderApp('/sessions/s-1/interview')
  expect(await screen.findByRole('heading', { name: 'Ready to join?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Join interview' }))
  return { user, router }
}

async function send(user: ReturnType<typeof userEvent.setup>, text: string, label = 'Your answer') {
  const box = await screen.findByLabelText(label)
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Send answer' })).toBeDefined())
  await user.type(box, text)
  await user.click(screen.getByRole('button', { name: 'Send answer' }))
}

async function warmUp(user: ReturnType<typeof userEvent.setup>) {
  mockedApi.chat.mockResolvedValueOnce({ reply: "Nice to meet you. Let's get into the questions.", done: true })
  await send(user, 'I study computer science.')
  await vi.waitFor(() => expect(spoken).toContain(first.prompt))
}

describe('the interview call', () => {
  it('greets the candidate by name, asks about them, then asks the first question', async () => {
    atQuestion()
    const { user } = await joinCall()

    expect(await screen.findByText('Getting started')).toBeInTheDocument()
    await vi.waitFor(() => expect(spoken).toEqual([greetingLine('Maya', 'Ada', 5, 'Operating systems'), WARM_UP_QUESTION]))
    await warmUp(user)

    expect(mockedApi.chat).toHaveBeenCalledWith('s-1', 'warm_up', 'I study computer science.')
    expect(spoken.slice(-4)).toEqual([
      fillerLine(1), "Nice to meet you. Let's get into the questions.", "Here's the first question.", first.prompt,
    ])
    expect(screen.getByText('Question 1 of 5')).toBeInTheDocument()
  })

  it('reacts to an answer, leads into the next question and asks it', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockResolvedValue({
      state: 'IN_PROGRESS', next_question: second, completed: false, reaction: 'Good point about memory.',
    })
    const { user } = await joinCall()
    await warmUp(user)

    await send(user, 'A process is a running program.')

    expect(await screen.findByText('Why does paging help?')).toBeInTheDocument()
    expect(mockedApi.submitAnswer).toHaveBeenCalledWith('s-1', 'q-1', 'A process is a running program.')
    await vi.waitFor(() =>
      expect(spoken.slice(-3)).toEqual([fillerLine(2), 'Good point about memory. Now, paging.', second.prompt]))
    expect(screen.getByText('Question 2 of 5')).toBeInTheDocument()
    expect(loadDraft('q-1')).toBe('')
  })

  it('asks a follow-up about the same question', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockResolvedValue({
      state: 'IN_PROGRESS', next_question: followUp, completed: false, reaction: followUp.lead_in,
    })
    const { user } = await joinCall()
    await warmUp(user)

    await send(user, 'Each process has its own memory.')

    expect(await screen.findByText('Question 1 of 5 · Follow-up')).toBeInTheDocument()
    await vi.waitFor(() => expect(spoken.slice(-2)).toEqual([followUp.lead_in, followUp.prompt]))
  })

  it('announces the question itself when the model gave no lead-in', async () => {
    atQuestion()
    mockedApi.submitAnswer.mockResolvedValue({
      state: 'IN_PROGRESS', next_question: { ...second, lead_in: null }, completed: false, reaction: null,
    })
    const { user } = await joinCall()
    await warmUp(user)

    await send(user, 'A running program.')

    await vi.waitFor(() => expect(spoken.slice(-2)).toEqual(["Here's question 2.", second.prompt]))
  })

  it('after the last question, takes the candidate’s questions, says goodbye and writes the report', async () => {
    atQuestion(last)
    mockedApi.submitAnswer.mockResolvedValue({ state: 'IN_PROGRESS', next_question: null, completed: false, reaction: 'Nice design.' })
    mockedApi.chat.mockResolvedValueOnce({ reply: 'Start with paging. Do you have any other questions?', done: false })
    mockedApi.finish.mockResolvedValue(makeSession({ state: 'COMPLETED' }))
    const { user, router } = await joinCall()

    await send(user, 'A fair, priority-based scheduler.')
    expect(await screen.findByText('Your questions')).toBeInTheDocument()
    await vi.waitFor(() => expect(spoken.slice(-2)).toEqual(['Nice design.', WRAP_UP_LINE]))

    await send(user, 'What should I revise?')
    await vi.waitFor(() => expect(spoken).toContain('Start with paging. Do you have any other questions?'))
    expect(mockedApi.chat).toHaveBeenCalledWith('s-1', 'closing', 'What should I revise?')
    await user.click(await screen.findByRole('button', { name: 'No questions, end the interview' }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/report'))
    expect(spoken).toContain(goodbyeLine('Ada'))
    expect(mockedApi.finish).toHaveBeenCalledWith('s-1')
  })

  it('ends the call when the candidate has no more questions', async () => {
    atQuestion(last)
    mockedApi.submitAnswer.mockResolvedValue({ state: 'IN_PROGRESS', next_question: null, completed: false, reaction: null })
    mockedApi.chat.mockResolvedValueOnce({ reply: 'Thanks for your time, Ada. Goodbye.', done: true })
    mockedApi.finish.mockResolvedValue(makeSession({ state: 'COMPLETED' }))
    const { user, router } = await joinCall()
    await send(user, 'A fair scheduler.')

    await send(user, "No, that's all.")

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/report'))
    expect(spoken).toContain('Thanks for your time, Ada. Goodbye.')
  })

  it('offers to try again when the report cannot be written', async () => {
    atQuestion(last)
    mockedApi.submitAnswer.mockResolvedValue({ state: 'IN_PROGRESS', next_question: null, completed: false, reaction: null })
    mockedApi.finish
      .mockRejectedValueOnce(new ApiError(503, 'The model could not evaluate answer after 2 tries.'))
      .mockResolvedValueOnce(makeSession({ state: 'COMPLETED' }))
    const { user, router } = await joinCall()
    await send(user, 'A fair scheduler.')
    await user.click(await screen.findByRole('button', { name: 'No questions, end the interview' }))

    expect(await screen.findByText('The report could not be written')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sessions/s-1/report'))
  })

  it('welcomes the candidate back when the interview was already under way, without the warm-up', async () => {
    atQuestion(second)
    await joinCall()

    await vi.waitFor(() => expect(spoken).toContain(second.prompt))
    expect(spoken[0]).toBe(welcomeBackLine('Maya'))
    expect(mockedApi.chat).not.toHaveBeenCalled()
  })

  it('goes straight to the candidate’s questions when every question is answered', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ questions_answered: 5, questions_asked: 5 }))
    mockedApi.currentQuestion.mockRejectedValue(new ApiError(404, 'No question is waiting for an answer.'))
    spoken.length = 0
    await joinCall()

    expect(await screen.findByText('Your questions')).toBeInTheDocument()
    await vi.waitFor(() => expect(spoken).toEqual([welcomeBackLine('Maya'), WRAP_UP_LINE]))
  })

  it('keeps the answer and explains when the server cannot be reached', async () => {
    atQuestion(second)
    mockedApi.submitAnswer.mockRejectedValue(new ApiError(0, 'Cannot reach the InterAct server.'))
    const { user } = await joinCall()

    await send(user, 'My careful answer')

    expect(await screen.findByText(/Cannot reach the InterAct server. Your answer is still here/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your answer')).toHaveValue('My careful answer')
  })

  it('offers to try again when the model fails, then carries on', async () => {
    atQuestion(second)
    mockedApi.submitAnswer.mockRejectedValue(modelDown)
    mockedApi.retry.mockResolvedValue({ state: 'IN_PROGRESS', next_question: last, completed: false, reaction: null })
    const { user } = await joinCall()

    await send(user, 'A running program.')
    expect(await screen.findByText('Your last answer is saved, but the interviewer did not get to reply')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Design a scheduler for a phone.')).toBeInTheDocument()
    expect(mockedApi.retry).toHaveBeenCalledWith('s-1')
  })

  it('opens the retry view straight away when the last step was interrupted before a reload', async () => {
    mockedApi.getSession.mockResolvedValue(makeSession({ state: 'EVALUATING', questions_answered: 1 }))
    await joinCall()

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
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

    await vi.waitFor(() => expect(spoken).toContain(second.prompt))
    expect(spoken.slice(-3)).toEqual(["Let's continue.", "Here's question 2.", second.prompt])
    expect(mockedApi.resume).toHaveBeenCalledWith('s-1')
  })

  it('resumes a paused interview on joining', async () => {
    atQuestion(second, makeSession({ state: 'PAUSED', questions_answered: 1 }))
    mockedApi.resume.mockResolvedValue(makeSession())
    await joinCall()

    await vi.waitFor(() => expect(spoken).toContain(second.prompt))
    expect(mockedApi.resume).toHaveBeenCalledWith('s-1')
  })

  it('asks before ending early, then writes the report', async () => {
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
    atQuestion(second)
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
