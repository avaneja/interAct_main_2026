import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CallStage, { CallTimer, type CallControls, type CallStageProps } from './CallStage'
import { useFullScreen } from './useFullScreen'

const mounts = { interviewer: 0, self: 0 }

function Tile({ name }: { name: 'interviewer' | 'self' }) {
  useEffect(() => {
    mounts[name]++
  }, [name])
  return <div>{name} tile</div>
}

function controls(overrides: Partial<CallControls> = {}): CallControls {
  return {
    microphoneOn: true,
    onToggleMicrophone: vi.fn(),
    cameraOn: true,
    onToggleCamera: vi.fn(),
    captionsOn: true,
    onToggleCaptions: vi.fn(),
    onPause: vi.fn(),
    onEnd: vi.fn(),
    ...overrides,
  }
}

function stage(overrides: Partial<CallStageProps> = {}) {
  return (
    <CallStage
      mode="call"
      interviewer={<Tile name="interviewer" />}
      self={<Tile name="self" />}
      panel={<p>panel</p>}
      header={<p>Question 2 of 5</p>}
      {...overrides}
    />
  )
}

afterEach(() => {
  mounts.interviewer = 0
  mounts.self = 0
  vi.useRealTimers()
})

describe('the call stage', () => {
  it('keeps the interviewer and camera tiles running when the candidate joins', () => {
    const view = render(stage({ mode: 'lobby' }))
    expect(screen.queryByText('Question 2 of 5')).not.toBeInTheDocument()

    view.rerender(stage({ mode: 'call', controls: controls() }))

    expect(screen.getByText('Question 2 of 5')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Call controls' })).toBeInTheDocument()
    expect(mounts).toEqual({ interviewer: 1, self: 1 })
  })

  it('shows what the interviewer is doing and the live caption', () => {
    render(stage({ activity: 'speaking', caption: { who: 'interviewer', text: 'What is a process?' } }))

    expect(screen.getByRole('status')).toHaveTextContent('Speaking')
    expect(screen.getByText('What is a process?')).toBeInTheDocument()
    expect(screen.getByText('Interviewer:')).toBeInTheDocument()
  })

  it('labels the candidate’s own words, and hides captions when they are off', () => {
    const view = render(stage({ caption: { who: 'you', text: 'A process is' } }))
    expect(screen.getByText('You:')).toBeInTheDocument()

    view.rerender(stage({ caption: { who: 'you', text: 'A process is' }, captionsOn: false }))

    expect(screen.queryByText('A process is')).not.toBeInTheDocument()
  })

  it('runs each control', async () => {
    const actions = controls()
    const onToggleFullScreen = vi.fn()
    render(stage({ controls: actions, onToggleFullScreen }))
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Mute microphone' }))
    await user.click(screen.getByRole('button', { name: 'Turn camera off' }))
    await user.click(screen.getByRole('button', { name: 'Hide captions' }))
    await user.click(screen.getByRole('button', { name: 'Full screen' }))
    await user.click(screen.getByRole('button', { name: 'Pause interview' }))
    await user.click(screen.getByRole('button', { name: 'End interview' }))

    expect(actions.onToggleMicrophone).toHaveBeenCalled()
    expect(actions.onToggleCamera).toHaveBeenCalled()
    expect(actions.onToggleCaptions).toHaveBeenCalled()
    expect(onToggleFullScreen).toHaveBeenCalled()
    expect(actions.onPause).toHaveBeenCalled()
    expect(actions.onEnd).toHaveBeenCalled()
  })

  it('shows muted and camera-off states, and no microphone button when typing', () => {
    const view = render(stage({ controls: controls({ microphoneOn: false, cameraOn: false }) }))
    expect(screen.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Turn camera on' })).toHaveAttribute('aria-pressed', 'false')

    view.rerender(stage({ controls: controls({ onToggleMicrophone: undefined }) }))

    expect(screen.queryByRole('button', { name: /microphone/ })).not.toBeInTheDocument()
  })
})

describe('the call timer', () => {
  it('counts minutes and seconds since the call started', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    render(<CallTimer startedAt={1_000_000 - 65_000} />)
    expect(screen.getByLabelText('Call time 1:05')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(2000))

    expect(screen.getByLabelText('Call time 1:07')).toBeInTheDocument()
  })
})

describe('full screen', () => {
  it('asks the browser for full screen and follows its changes', async () => {
    const element = document.createElement('div')
    element.requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: element, configurable: true })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement>(element)
      return useFullScreen(ref)
    })

    await act(() => result.current.enter())

    expect(element.requestFullscreen).toHaveBeenCalled()
    expect(result.current.fullScreen).toBe(true)
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  })

  it('carries on when the browser refuses full screen', async () => {
    const element = document.createElement('div')
    element.requestFullscreen = vi.fn().mockRejectedValue(new Error('not allowed'))
    const { result } = renderHook(() => useFullScreen(useRef<HTMLElement>(element)))

    await act(() => result.current.enter())

    expect(result.current.fullScreen).toBe(false)
  })
})
