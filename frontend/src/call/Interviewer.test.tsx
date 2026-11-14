import type { SpeechAudio } from '@met4citizen/talkinghead'
import { act, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Interviewer, { type InterviewerHandle } from './Interviewer'
import { DEFAULT_INTERVIEWER } from './interviewers'

// jsdom has no WebGL, so TalkingHead is replaced by a fake that records calls.
const heads: FakeHead[] = []
let failToLoad = false

class FakeHead {
  audioCtx = { state: 'running' } as unknown as AudioContext
  options: unknown
  avatar: unknown
  spoken: SpeechAudio[] = []
  markers: (() => void)[] = []
  subtitles: ((word: string) => void) | null = null
  disposed = false
  stopped = false

  constructor(_node: HTMLElement, options: unknown) {
    this.options = options
    heads.push(this)
  }
  async showAvatar(avatar: unknown) {
    this.avatar = avatar
    if (failToLoad) throw new Error('WebGL is not available')
  }
  speakAudio(speech: SpeechAudio, _options: unknown, onsubtitles: ((word: string) => void) | null) {
    this.spoken.push(speech)
    this.subtitles = onsubtitles
  }
  speakMarker(onmarker: () => void) {
    this.markers.push(onmarker)
  }
  stopSpeaking() {
    this.stopped = true
    this.markers = []
  }
  dispose() {
    this.disposed = true
  }
}

vi.mock('@met4citizen/talkinghead', () => ({ TalkingHead: FakeHead }))

const SPEECH = {
  audio: {} as AudioBuffer,
  words: ['Hello'],
  wtimes: [0],
  wdurations: [300],
  visemes: ['aa'],
  vtimes: [0],
  vdurations: [100],
}

beforeEach(() => {
  heads.length = 0
  failToLoad = false
})

async function renderReady() {
  const ref = createRef<InterviewerHandle>()
  const onStatusChange = vi.fn()
  const view = render(<Interviewer interviewer={DEFAULT_INTERVIEWER} ref={ref} onStatusChange={onStatusChange} />)
  await vi.waitFor(() => expect(onStatusChange).toHaveBeenLastCalledWith('ready'))
  return { ref, onStatusChange, view, head: heads[0] }
}

describe('the 3D interviewer', () => {
  it('loads the preset model in a head-and-shoulders view that keeps eye contact', async () => {
    const { head } = await renderReady()

    expect(head.avatar).toEqual({ url: '/interviewers/maya.glb', body: 'F', avatarMood: 'neutral', lipsyncLang: 'en' })
    expect(head.options).toMatchObject({ cameraView: 'upper', cameraRotateEnable: false, lipsyncModules: [] })
    expect(screen.getByText('Maya · AI interviewer')).toBeInTheDocument()
    expect(screen.queryByText(/Getting Maya ready/)).not.toBeInTheDocument()
  })

  it('says it is getting ready while the model loads', () => {
    render(<Interviewer interviewer={DEFAULT_INTERVIEWER} />)

    expect(screen.getByText('Getting Maya ready…')).toBeInTheDocument()
  })

  it('falls back to a name tile when the browser cannot show 3D', async () => {
    failToLoad = true
    const onStatusChange = vi.fn()
    render(<Interviewer interviewer={DEFAULT_INTERVIEWER} onStatusChange={onStatusChange} />)

    expect(await screen.findByText('The 3D interviewer could not load in this browser.')).toBeInTheDocument()
    expect(onStatusChange).toHaveBeenLastCalledWith('error')
  })

  it('speaks with lip-sync, passes on each word, and resolves when the speech ends', async () => {
    const { ref, head } = await renderReady()
    const words: string[] = []
    let finished = false

    const speaking = ref.current!.speak([SPEECH], (word) => words.push(word)).then(() => (finished = true))
    head.subtitles?.(' Hello')
    await Promise.resolve()
    expect(finished).toBe(false)
    act(() => head.markers[0]())
    await speaking

    expect(head.spoken).toEqual([SPEECH])
    expect(words).toEqual(['Hello'])
    expect(finished).toBe(true)
  })

  it('stopping ends the speech straight away', async () => {
    const { ref, head } = await renderReady()

    const speaking = ref.current!.speak([SPEECH])
    ref.current!.stopSpeaking()

    await expect(speaking).resolves.toBeUndefined()
    expect(head.stopped).toBe(true)
  })

  it('shares its audio context once ready', async () => {
    const { ref, head } = await renderReady()

    expect(ref.current!.audioContext()).toBe(head.audioCtx)
  })

  it('releases the 3D scene and any waiting speech when it leaves the page', async () => {
    const { ref, head, view } = await renderReady()
    const speaking = ref.current!.speak([SPEECH])

    view.unmount()

    await expect(speaking).resolves.toBeUndefined()
    expect(head.disposed).toBe(true)
  })
})
