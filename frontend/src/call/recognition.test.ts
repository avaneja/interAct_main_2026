import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTranscriber, type RecognitionLike } from './recognition'

const sessions: FakeRecognition[] = []

class FakeRecognition implements RecognitionLike {
  continuous = false
  interimResults = false
  lang = ''
  onresult: RecognitionLike['onresult'] = null
  onerror: RecognitionLike['onerror'] = null
  onend: RecognitionLike['onend'] = null
  started = false
  stopped = false
  aborted = false
  constructor() {
    sessions.push(this)
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
  }
  abort() {
    this.aborted = true
  }
  /** Simulate results: [text, isFinal] pairs for the whole session so far. */
  hear(...results: [string, boolean][]) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }))
    this.onresult?.({ results: list })
  }
}

afterEach(() => {
  sessions.length = 0
  vi.useRealTimers()
})

function setup() {
  const onText = vi.fn()
  const onProblem = vi.fn()
  const transcriber = createTranscriber({ onText, onProblem }, FakeRecognition)
  return { transcriber, onText, onProblem }
}

describe('turning speech into text', () => {
  it('listens continuously in English and reports confirmed and pending words', () => {
    const { transcriber, onText } = setup()

    transcriber.start()
    sessions[0].hear([' A process is', true], [' a running', false])

    expect(sessions[0]).toMatchObject({ continuous: true, interimResults: true, lang: 'en-US', started: true })
    expect(onText).toHaveBeenLastCalledWith('A process is', 'a running')
  })

  it('keeps listening through a pause, keeping what was already said', () => {
    const { transcriber, onText } = setup()
    transcriber.start()
    sessions[0].hear(['A process is a program', true])

    sessions[0].onend?.()
    sessions[1].hear(['in execution', true])

    expect(sessions[1].started).toBe(true)
    expect(onText).toHaveBeenLastCalledWith('A process is a program in execution', '')
  })

  it('continues after text that was already said or corrected', () => {
    const { transcriber, onText } = setup()

    transcriber.start('My corrected start')
    sessions[0].hear(['and more', true])

    expect(onText).toHaveBeenLastCalledWith('My corrected start and more', '')
  })

  it('stops when asked and does not restart', () => {
    const { transcriber } = setup()
    transcriber.start()

    transcriber.stop()
    sessions[0].onend?.()

    expect(sessions[0].stopped).toBe(true)
    expect(sessions).toHaveLength(1)
  })

  it('ignores late words from a session that was replaced', () => {
    const { transcriber, onText } = setup()
    transcriber.start()
    transcriber.stop()
    const old = sessions[0]

    transcriber.start('Edited answer')
    old.hear(['late words', true])
    old.onend?.()

    expect(old.aborted).toBe(true)
    expect(onText).not.toHaveBeenCalledWith(expect.stringContaining('late words'), expect.anything())
    expect(sessions).toHaveLength(2)
  })

  it.each([
    ['not-allowed', 'blocked'],
    ['audio-capture', 'no-microphone'],
    ['network', 'network'],
    ['service-not-allowed', 'unavailable'],
  ])('gives up on a %s error', (error, problem) => {
    const { transcriber, onProblem } = setup()
    transcriber.start()

    sessions[0].onerror?.({ error })
    sessions[0].onend?.()

    expect(onProblem).toHaveBeenCalledWith(problem)
    expect(sessions).toHaveLength(1)
  })

  it('treats silence as normal and keeps listening', () => {
    const { transcriber, onProblem } = setup()
    transcriber.start()

    sessions[0].onerror?.({ error: 'no-speech' })
    sessions[0].onend?.()

    expect(onProblem).not.toHaveBeenCalled()
    expect(sessions).toHaveLength(2)
  })

  it('gives up instead of restarting endlessly', () => {
    vi.useFakeTimers()
    const { transcriber, onProblem } = setup()
    transcriber.start()

    for (let i = 0; i < 6; i++) sessions[sessions.length - 1].onend?.()

    expect(onProblem).toHaveBeenCalledWith('unavailable')
    expect(sessions).toHaveLength(6)
  })

  it('reports when the browser has no speech recognition', () => {
    const onProblem = vi.fn()

    createTranscriber({ onText: vi.fn(), onProblem }, null).start()

    expect(onProblem).toHaveBeenCalledWith('unavailable')
  })
})
