import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserSpeaker, captionSpeaker, joinSpeech, voiceSpeaker } from './speaker'
import type { SpeechAudio, Voice } from './voice'

/** A mono buffer at `rate` Hz, filled with `value`, shaped like a Web Audio AudioBuffer. */
function fakeBuffer(samples: number, rate = 1000, value = 1): AudioBuffer {
  const data = new Float32Array(samples).fill(value)
  return {
    length: samples,
    sampleRate: rate,
    numberOfChannels: 1,
    duration: samples / rate,
    getChannelData: () => data,
  } as unknown as AudioBuffer
}

const makeBuffer = (_channels: number, length: number, rate: number) => fakeBuffer(length, rate, 0)

const SPEECH: SpeechAudio[] = [{ audio: fakeBuffer(500), words: ['Hello ', 'there'], wtimes: [0, 250], wdurations: [200, 200] }]

function fakeOutput() {
  const sources: { buffer: AudioBuffer | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  const output = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createBuffer: makeBuffer,
    createBufferSource: () => {
      const source = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      sources.push(source)
      return source
    },
  } as unknown as AudioContext
  return { output, sources }
}

describe('joining sentence clips into one smooth line', () => {
  it('fades every edge, adds a short pause between sentences and shifts word times', () => {
    const first = fakeBuffer(100)
    const second = fakeBuffer(100)
    const joined = joinSpeech({ createBuffer: makeBuffer } as unknown as AudioContext, [
      { audio: first, words: ['One.'], wtimes: [0], wdurations: [50] },
      { audio: second, words: ['Two.'], wtimes: [10], wdurations: [50] },
    ])!
    const gap = 120 // 0.12 s at 1000 Hz
    expect(joined.audio.length).toBe(200 + gap)
    const data = joined.audio.getChannelData(0)
    expect(data[0]).toBe(0) // faded in, no click
    expect(data[50]).toBe(1) // full level in the middle
    expect(data[99]).toBe(0) // faded out
    expect(data[100 + gap / 2]).toBe(0) // the pause is silent
    expect(joined.words).toEqual([
      { word: 'One.', at: 0 },
      { word: 'Two.', at: 100 + gap + 10 },
    ])
  })

  it('returns nothing for empty speech', () => {
    expect(joinSpeech({ createBuffer: makeBuffer } as unknown as AudioContext, [])).toBeNull()
  })
})

describe('speaking with the neural voice, camera off', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays the speech, passes on each word at its time, and resolves when it has been said', async () => {
    const voice: Voice = { say: vi.fn().mockResolvedValue(SPEECH) }
    const { output, sources } = fakeOutput()
    const words: string[] = []
    let finished = false

    const speaking = voiceSpeaker(voice, () => output).speak('Hello there', (word) => words.push(word)).then(() => (finished = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(voice.say).toHaveBeenCalledWith('Hello there')
    expect(sources).toHaveLength(1)
    expect(sources[0].buffer?.length).toBe(500)
    expect(sources[0].start).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(words).toEqual(['Hello'])
    await vi.advanceTimersByTimeAsync(250)
    expect(words).toEqual(['Hello', 'there'])
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(400)
    await speaking
    expect(finished).toBe(true)
  })

  it('prepares a line ahead without playing it, and ignores a failure', async () => {
    const voice: Voice = { say: vi.fn().mockRejectedValue(new Error('busy')) }
    const { output, sources } = fakeOutput()

    voiceSpeaker(voice, () => output).prepare('Next question')
    await vi.advanceTimersByTimeAsync(0)

    expect(voice.say).toHaveBeenCalledWith('Next question')
    expect(sources).toHaveLength(0)
  })

  it('stops playing at once, with no more words', async () => {
    const voice: Voice = { say: vi.fn().mockResolvedValue(SPEECH) }
    const { output, sources } = fakeOutput()
    const words: string[] = []
    const speaker = voiceSpeaker(voice, () => output)

    const speaking = speaker.speak('Hello there', (word) => words.push(word))
    await vi.advanceTimersByTimeAsync(0)
    speaker.stop()
    await speaking
    await vi.advanceTimersByTimeAsync(1000)

    expect(sources[0].stop).toHaveBeenCalled()
    expect(words).toEqual([])
  })

  it('does not play a line that was stopped while it was being made', async () => {
    let finishMaking: (speech: SpeechAudio[]) => void = () => {}
    const voice: Voice = { say: () => new Promise((resolve) => (finishMaking = resolve)) }
    const { output, sources } = fakeOutput()
    const speaker = voiceSpeaker(voice, () => output)

    const speaking = speaker.speak('Hi')
    speaker.stop()
    finishMaking(SPEECH)
    await speaking

    expect(sources).toHaveLength(0)
  })

  it('says nothing, without failing, when the browser has no audio output', async () => {
    const voice: Voice = { say: vi.fn().mockResolvedValue(SPEECH) }
    await expect(voiceSpeaker(voice, () => null).speak('Hi')).resolves.toBeUndefined()
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

  it('stops by cancelling the browser voice', () => {
    const synthesis = { speak: vi.fn(), cancel: vi.fn() } as unknown as SpeechSynthesis
    const speaker = browserSpeaker(synthesis)

    speaker.stop()

    expect(synthesis.cancel).toHaveBeenCalled()
  })
})

describe('speaking in captions only', () => {
  it('shows each word at speaking pace and finishes after the last', async () => {
    vi.useFakeTimers()
    const words: string[] = []
    let finished = false

    const speaking = captionSpeaker(120).speak('What is a process?', (word) => words.push(word)).then(() => (finished = true))
    // 120 words a minute: one word every 500 ms.
    await vi.advanceTimersByTimeAsync(900)
    expect(words).toEqual(['What', 'is'])
    expect(finished).toBe(false)

    await vi.advanceTimersByTimeAsync(1100)
    await speaking
    expect(words).toEqual(['What', 'is', 'a', 'process?'])
    expect(finished).toBe(true)
    vi.useRealTimers()
  })

  it('stops at once', async () => {
    const speaker = captionSpeaker()
    const words: string[] = []

    const speaking = speaker.speak('A long line of words', (word) => words.push(word))
    speaker.stop()
    await speaking

    expect(words).toEqual([])
  })
})

describe('a browser voice that never finishes', () => {
  it('moves on after a safety timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    const synthesis = { speak: vi.fn(), cancel: vi.fn() } as unknown as SpeechSynthesis
    let finished = false

    const speaking = browserSpeaker(synthesis).speak('Hi there').then(() => (finished = true))
    await vi.advanceTimersByTimeAsync(3999)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await speaking

    expect(finished).toBe(true)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})

describe('the audio output', () => {
  it('asks for playback-sized buffers, so speech does not break while the page is busy', async () => {
    vi.resetModules()
    const options: unknown[] = []
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        constructor(option: unknown) {
          options.push(option)
        }
      },
    )
    const { unlockAudio } = await import('./speaker')

    const first = unlockAudio()
    const second = unlockAudio()

    expect(options).toEqual([{ latencyHint: 'playback' }])
    expect(second).toBe(first)
    vi.unstubAllGlobals()
  })
})
