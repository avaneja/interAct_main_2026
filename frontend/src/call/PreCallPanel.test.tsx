import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { domError, fakeStream, removeMediaDevices, stubGetUserMedia } from '../test/fakeMedia'
import PreCallPanel, { type PreCallPanelProps } from './PreCallPanel'
import SelfView from './SelfView'

afterEach(removeMediaDevices)

const READY_VOICE = { status: 'ready', voice: { say: async () => [] } } as const

function renderPanel(overrides: Partial<PreCallPanelProps> = {}) {
  const props: PreCallPanelProps = {
    interviewerName: 'Maya',
    questionCount: 5,
    voice: READY_VOICE,
    usingBrowserVoice: false,
    onUseBrowserVoice: vi.fn(),
    camera: { status: 'off' },
    onCameraOn: vi.fn(),
    onCameraOff: vi.fn(),
    canSpeak: true,
    onJoin: vi.fn(),
    ...overrides,
  }
  render(<PreCallPanel {...props} />)
  return props
}

describe('the pre-call check', () => {
  it('tests the microphone with a level meter, then joins speaking', async () => {
    stubGetUserMedia(async () => fakeStream().stream)
    const props = renderPanel()

    expect(await screen.findByRole('meter', { name: 'Microphone level' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Join interview' }))

    expect(props.onJoin).toHaveBeenCalledWith('speak')
  })

  it('explains a blocked microphone and only allows joining by typing', async () => {
    stubGetUserMedia(async () => {
      throw domError('NotAllowedError')
    })
    const props = renderPanel()
    const user = userEvent.setup()

    expect(await screen.findByText(/The browser blocked the microphone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join interview' })).toBeDisabled()
    expect(screen.getByText(/The microphone must work to speak your answers/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Type my answers' }))
    await user.click(screen.getByRole('button', { name: 'Join interview' }))

    expect(props.onJoin).toHaveBeenCalledWith('type')
  })

  it('releases the microphone when typing is chosen', async () => {
    const { stream, track } = fakeStream()
    stubGetUserMedia(async () => stream)
    renderPanel()
    await screen.findByRole('meter', { name: 'Microphone level' })

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Type my answers' }))

    expect(track.stop).toHaveBeenCalled()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('offers only typing when the browser cannot recognise speech', () => {
    renderPanel({ canSpeak: false })

    expect(screen.getByRole('radio', { name: /Speak my answers/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Type my answers' })).toBeChecked()
    expect(screen.getByText(/Use Chrome to speak/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join interview' })).toBeEnabled()
  })

  it('waits for the voice, showing the first-time download, unless told not to', async () => {
    const props = renderPanel({ canSpeak: false, voice: { status: 'loading', progress: 0.42 } })

    expect(screen.getByText(/Downloading Maya's voice: 42%. This happens only the first time/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Waiting for Maya's voice/ })).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('button', { name: /use the browser's voice instead/ }))

    expect(props.onUseBrowserVoice).toHaveBeenCalled()
  })

  it('uses the browser voice when the natural voice cannot start', () => {
    renderPanel({ canSpeak: false, voice: { status: 'failed' } })

    expect(screen.getByText(/natural voice could not start in this browser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join interview' })).toBeEnabled()
  })

  it('lets the camera be turned on', async () => {
    const props = renderPanel({ canSpeak: false })

    expect(screen.getByText('Off. You can interview without it.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn camera on' }))

    expect(props.onCameraOn).toHaveBeenCalled()
  })

  it('says the preview is private and lets the camera be turned off', async () => {
    const props = renderPanel({ canSpeak: false, camera: { status: 'on', stream: fakeStream().stream } })

    expect(screen.getByText('On. Only you see this preview.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Turn camera off' }))

    expect(props.onCameraOff).toHaveBeenCalled()
  })

  it('explains a camera problem and still allows joining', async () => {
    const props = renderPanel({ canSpeak: false, camera: { status: 'problem', problem: 'busy' } })

    expect(screen.getByText(/Another app is using the camera.*continue with the camera off/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))

    expect(props.onCameraOn).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Join interview' })).toBeEnabled()
  })

  it('says where camera, voice and answers go', () => {
    renderPanel({ canSpeak: false })

    expect(screen.getByText(/never records or uploads video/)).toBeInTheDocument()
    expect(screen.getByText(/Chrome sends your voice to Google/)).toBeInTheDocument()
  })
})

describe('the self-view', () => {
  it('shows the camera, mirrored, when it is on', () => {
    const { stream } = fakeStream()
    render(<SelfView stream={stream} name="Ada" />)

    const video = screen.getByLabelText('Your camera') as HTMLVideoElement
    expect(video.srcObject).toBe(stream)
    expect(video.muted).toBe(true)
  })

  it('shows an initial when the camera is off', () => {
    render(<SelfView stream={null} name="ada" />)

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('Camera off')).toBeInTheDocument()
  })
})
