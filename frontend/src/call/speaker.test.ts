import type { SpeechAudio } from '@met4citizen/talkinghead'
import { describe, expect, it, vi } from 'vitest'
import type { InterviewerHandle } from './Interviewer'
import { avatarSpeaker, browserSpeaker } from './speaker'
import type { Voice } from './voice'

const SPEECH = [{ audio: {} as AudioBuffer, words: ['Hi'], wtimes: [0], wdurations: [100] }]

function fakeInterviewer() {
  return {
    speak: vi.fn(async (_speech: SpeechAudio[], onWord?: (word: string) => void) => onWord?.('Hi')),
    stopSpeaking: vi.fn(),
    audioContext: () => null,
  } satisfies InterviewerHandle
}

describe('speaking through the 3D interviewer', () => {
  it('makes the speech, then lip-syncs it and passes on each word', async () => {
    const voice: Voice = { say: vi.fn().mockResolvedValue(SPEECH) }
    const interviewer = fakeInterviewer()
    const words: string[] = []

    await avatarSpeaker(voice, () => interviewer).speak('Hi', (word) => words.push(word))

    expect(voice.say).toHaveBeenCalledWith('Hi')
    expect(interviewer.speak).toHaveBeenCalledWith(SPEECH, expect.any(Function))
    expect(words).toEqual(['Hi'])
  })

  it('prepares a line ahead without speaking it, and ignores a failure', async () => {
    const voice: Voice = { say: vi.fn().mockRejectedValue(new Error('busy')) }
    const interviewer = fakeInterviewer()

    avatarSpeaker(voice, () => interviewer).prepare('Next question')
    await Promise.resolve()

    expect(voice.say).toHaveBeenCalledWith('Next question')
    expect(interviewer.speak).not.toHaveBeenCalled()
  })

  it('does not speak a line that was stopped while it was being made', async () => {
    let finishMaking: (speech: SpeechAudio[]) => void = () => {}
    const voice: Voice = { say: () => new Promise((resolve) => (finishMaking = resolve)) }
    const interviewer = fakeInterviewer()
    const speaker = avatarSpeaker(voice, () => interviewer)

    const speaking = speaker.speak('Hi')
    speaker.stop()
    finishMaking(SPEECH)
    await speaking

    expect(interviewer.stopSpeaking).toHaveBeenCalled()
    expect(interviewer.speak).not.toHaveBeenCalled()
  })
})

class FakeUtterance {
  text: string
  lang = ''
  onboundary: ((event: { name: string; charIndex: number; charLength?: number }) => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

describe('speaking with the browser voice', () => {
  it('speaks the text in English, passes on each word, and resolves at the end', async () => {
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    const spoken: FakeUtterance[] = []
    const synthesis = { speak: (u: FakeUtterance) => spoken.push(u), cancel: vi.fn() } as unknown as SpeechSynthesis
    const words: string[] = []

    const speaking = browserSpeaker(synthesis).speak('What is a process?', (word) => words.push(word))
    const utterance = spoken[0]
    utterance.onboundary?.({ name: 'word', charIndex: 0, charLength: 4 })
    utterance.onboundary?.({ name: 'word', charIndex: 5 })
    utterance.onboundary?.({ name: 'sentence', charIndex: 0 })
    utterance.onend?.()
    await speaking

    expect(utterance.lang).toBe('en-US')
    expect(words).toEqual(['What', 'is'])
    vi.unstubAllGlobals()
  })

  it('stops by cancelling the browser voice, without lip-sync', () => {
    const synthesis = { speak: vi.fn(), cancel: vi.fn() } as unknown as SpeechSynthesis
    const speaker = browserSpeaker(synthesis)

    speaker.stop()

    expect(synthesis.cancel).toHaveBeenCalled()
    expect(speaker.lipSync).toBe(false)
  })
})
