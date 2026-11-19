import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDraft, saveDraft } from '../lib/drafts'
import AnswerPanel, { type AnswerPanelProps } from './AnswerPanel'
import type { TranscriberEvents } from './recognition'

function fakeTranscriber() {
  const fake = {
    events: null as TranscriberEvents | null,
    start: vi.fn(),
    stop: vi.fn(),
    make: (events: TranscriberEvents) => {
      fake.events = events
      return { start: fake.start, stop: fake.stop }
    },
    say(confirmed: string, pending = '') {
      act(() => fake.events?.onText(confirmed, pending))
    },
  }
  return fake
}

function renderPanel(overrides: Partial<AnswerPanelProps> = {}) {
  const transcriber = fakeTranscriber()
  const props: AnswerPanelProps = {
    draftKey: 'q-2',
    mode: 'speak',
    interviewerName: 'Maya',
    label: 'Question 2 of 5',
    prompt: 'What is a process?',
    canListen: true,
    microphoneOn: true,
    sending: false,
    onSubmit: vi.fn(),
    onCaption: vi.fn(),
    silenceMs: 5000,
    makeTranscriber: transcriber.make,
    ...overrides,
  }
  const view = render(<AnswerPanel {...props} />)
  return {
    props,
    transcriber,
    unmount: view.unmount,
    rerender: (more: Partial<AnswerPanelProps>) => view.rerender(<AnswerPanel {...props} {...more} />),
  }
}

afterEach(() => vi.useRealTimers())

describe('answering by voice', () => {
  it('waits for the interviewer to finish before listening', () => {
    const { transcriber, rerender } = renderPanel({ canListen: false })

    expect(screen.getByText('Question 2 of 5')).toBeInTheDocument()
    expect(screen.getByText('What is a process?')).toBeInTheDocument()
    expect(screen.getByText('Listen to Maya. Your microphone turns on when Maya finishes.')).toBeInTheDocument()
    expect(transcriber.start).not.toHaveBeenCalled()

    rerender({ canListen: true })

    expect(transcriber.start).toHaveBeenCalledWith('')
    expect(screen.getByText(/^Listening… answer out loud\./)).toBeInTheDocument()
  })

  it('shows the live transcript and passes it to the caption', () => {
    const { props, transcriber } = renderPanel()

    transcriber.say('A process is', 'a running')

    expect(screen.getByText('A process is')).toBeInTheDocument()
    expect(screen.getByText('a running')).toBeInTheDocument()
    expect(props.onCaption).toHaveBeenLastCalledWith('A process is a running')
  })

  it('reviews the answer on Done, lets the candidate fix it, and sends it', async () => {
    const { props, transcriber } = renderPanel()
    const user = userEvent.setup()
    transcriber.say('A process is a program in execution with its own memory', 'space')

    await user.click(screen.getByRole('button', { name: 'Done answering' }))
    const box = screen.getByLabelText('Check your answer')
    expect(box).toHaveValue('A process is a program in execution with its own memory space')
    expect(transcriber.stop).toHaveBeenCalled()
    expect(props.onCaption).toHaveBeenLastCalledWith('')

    await user.clear(box)
    await user.type(box, 'A process is a program in execution')
    await user.click(screen.getByRole('button', { name: 'Send answer' }))

    expect(props.onSubmit).toHaveBeenCalledWith('A process is a program in execution', { spoken: true })
  })

  it('moves to review after a pause, and new words restart the wait', () => {
    vi.useFakeTimers()
    const { transcriber } = renderPanel()
    transcriber.say('A process')
    act(() => vi.advanceTimersByTime(4000))
    transcriber.say('A process is a program')
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByLabelText('Check your answer')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1000))

    expect(screen.getByLabelText('Check your answer')).toHaveValue('A process is a program')
  })

  it('can keep talking after review, continuing from the corrected text', async () => {
    const { transcriber } = renderPanel()
    const user = userEvent.setup()
    transcriber.say('A proces')
    await user.click(screen.getByRole('button', { name: 'Done answering' }))
    await user.type(screen.getByLabelText('Check your answer'), 's')

    await user.click(screen.getByRole('button', { name: 'Keep talking' }))

    expect(transcriber.start).toHaveBeenLastCalledWith('A process')
  })

  it('pauses listening while muted and resumes after', () => {
    const { transcriber, rerender } = renderPanel()
    transcriber.say('A process is')

    rerender({ microphoneOn: false })
    expect(transcriber.stop).toHaveBeenCalled()
    expect(screen.getByText(/Unmute to keep answering, or press Done/)).toBeInTheDocument()

    rerender({ microphoneOn: true })
    expect(transcriber.start).toHaveBeenLastCalledWith('A process is')
  })

  it('lets the answer be typed when listening stops for good', () => {
    const { transcriber } = renderPanel()
    transcriber.say('A process is')

    act(() => transcriber.events?.onProblem('network'))

    expect(screen.getByText(/could not reach its speech service/)).toBeInTheDocument()
    expect(screen.getByLabelText('Check your answer')).toHaveValue('A process is')
    expect(screen.queryByRole('button', { name: 'Keep talking' })).not.toBeInTheDocument()
  })

  it('keeps the answer and shows the error when sending fails', async () => {
    const { transcriber, rerender } = renderPanel()
    transcriber.say('A process is a program')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Done answering' }))

    rerender({ error: 'Cannot reach the InterAct server.' })

    expect(screen.getByText(/Cannot reach the InterAct server. Your answer is still here/)).toBeInTheDocument()
    expect(screen.getByLabelText('Check your answer')).toHaveValue('A process is a program')
  })

  it('does not send an empty answer and disables everything while sending', async () => {
    const { transcriber, rerender } = renderPanel()
    expect(screen.getByRole('button', { name: 'Done answering' })).toBeDisabled()
    transcriber.say('Answer')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Done answering' }))

    rerender({ sending: true })

    expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled()
    expect(screen.getByLabelText('Check your answer')).toBeDisabled()
  })

  it('stops listening when the panel closes', () => {
    const { transcriber, unmount } = renderPanel()
    transcriber.stop.mockClear()

    unmount()

    expect(transcriber.stop).toHaveBeenCalled()
  })
})

describe('answering by typing', () => {
  it('shows the answer box from the start, without listening', async () => {
    const { props, transcriber, rerender } = renderPanel({ mode: 'type', canListen: false })
    const user = userEvent.setup()

    const box = screen.getByLabelText('Your answer')
    await user.type(box, 'A process is a running program')
    // Typing can start while the interviewer speaks; sending waits until the question is asked.
    expect(screen.getByRole('button', { name: 'Send answer' })).toBeDisabled()
    expect(screen.getByText('You can send once Maya has finished speaking.')).toBeInTheDocument()
    rerender({ mode: 'type', canListen: true })
    await user.click(screen.getByRole('button', { name: 'Send answer' }))

    expect(props.onSubmit).toHaveBeenCalledWith('A process is a running program', { spoken: false })
    expect(transcriber.start).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Keep talking' })).not.toBeInTheDocument()
  })

  it('saves the typed answer in the browser and restores it after a reload', async () => {
    const first = renderPanel({ mode: 'type' })
    await userEvent.setup().type(screen.getByLabelText('Your answer'), 'Half an answer')
    expect(loadDraft('q-2')).toBe('Half an answer')
    first.unmount()

    renderPanel({ mode: 'type' })

    expect(screen.getByLabelText('Your answer')).toHaveValue('Half an answer')
  })

  it('switches a spoken answer to typing, keeping what was heard', async () => {
    const { transcriber } = renderPanel()
    transcriber.say('A process is')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Type instead' }))

    expect(screen.getByLabelText('Your answer')).toHaveValue('A process is')
    expect(transcriber.stop).toHaveBeenCalled()
  })

  it('reopens a reviewed spoken answer after a reload', () => {
    saveDraft('q-2', 'My reviewed answer')

    const { transcriber } = renderPanel()

    expect(screen.getByLabelText('Check your answer')).toHaveValue('My reviewed answer')
    expect(transcriber.start).not.toHaveBeenCalled()
  })
})

describe('another way to move on', () => {
  it('shows an extra action below the answer', () => {
    renderPanel({ extraAction: <button type="button">No questions, end the interview</button> })

    expect(screen.getByRole('button', { name: 'No questions, end the interview' })).toBeInTheDocument()
  })
})
