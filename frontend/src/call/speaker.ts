import type { SpeechAudio, Voice } from './voice'

/** How the interviewer's lines are spoken; the call screen does not care which kind it gets. */
export interface Speaker {
  /** Speak `text`, calling `onWord` as each word is said. Resolves when done or stopped. */
  speak: (text: string, onWord?: (word: string) => void) => Promise<void>
  /** Start making speech for a line that will be said soon, so it plays without a pause. */
  prepare: (text: string) => void
  stop: () => void
}

let sharedContext: AudioContext | null = null

/** The page's audio output. Browsers only let audio start after a click, so call this from one (joining the call). */
export function unlockAudio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  // "playback" asks for larger audio buffers: speech is not interactive, and small buffers run dry
  // (crackles and breaks) while the page is also making the next lines and tracking the camera.
  sharedContext ??= new AudioContext({ latencyHint: 'playback' })
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => undefined)
  return sharedContext
}

// HeadTTS returns a line as one clip per sentence. Played back to back, the hard edges click
// and the sentences run into each other, which sounds broken. They are joined into one clip
// with short fades at every edge and a brief, natural pause between sentences.
const FADE_SECONDS = 0.01
const SENTENCE_GAP_SECONDS = 0.12

export interface JoinedSpeech {
  audio: AudioBuffer
  /** Each word and when it starts, in milliseconds from the start of `audio`. */
  words: { word: string; at: number }[]
}

/** Join a line's sentence clips into one smooth clip. */
export function joinSpeech(output: Pick<AudioContext, 'createBuffer'>, speech: SpeechAudio[]): JoinedSpeech | null {
  const parts = speech.filter((part) => part.audio && part.audio.length > 0)
  if (parts.length === 0) return null
  const rate = parts[0].audio.sampleRate
  const channels = Math.max(...parts.map((part) => part.audio.numberOfChannels))
  const gap = Math.round(SENTENCE_GAP_SECONDS * rate)
  const length = parts.reduce((sum, part) => sum + part.audio.length, 0) + gap * (parts.length - 1)
  const audio = output.createBuffer(channels, length, rate)
  const fade = Math.max(1, Math.round(FADE_SECONDS * rate))
  const words: JoinedSpeech['words'] = []

  let offset = 0
  for (const part of parts) {
    for (let channel = 0; channel < channels; channel++) {
      const source = part.audio.getChannelData(Math.min(channel, part.audio.numberOfChannels - 1))
      const target = audio.getChannelData(channel)
      const n = source.length
      for (let i = 0; i < n; i++) {
        const edge = Math.min(i, n - 1 - i)
        target[offset + i] = edge < fade ? source[i] * (edge / fade) : source[i]
      }
    }
    const startMs = (offset / rate) * 1000
    part.words.forEach((word, index) => words.push({ word: word.trim(), at: startMs + (part.wtimes[index] ?? 0) }))
    offset += part.audio.length + gap
  }
  return { audio, words }
}

/** The neural voice, played straight to the speakers, with each word passed on as it is said. */
export function voiceSpeaker(voice: Voice, context: () => AudioContext | null = unlockAudio): Speaker {
  let turn = 0
  let playing: AudioBufferSourceNode[] = []
  let timers: number[] = []
  let finish: (() => void) | null = null

  const silence = () => {
    playing.forEach((source) => {
      try {
        source.stop()
      } catch {
        // Already finished.
      }
    })
    timers.forEach((timer) => window.clearTimeout(timer))
    playing = []
    timers = []
    finish?.()
    finish = null
  }

  return {
    async speak(text, onWord) {
      const mine = ++turn
      const speech = await voice.say(text)
      const output = context()
      // Stopped, or another line started, while the speech was being made; or no audio output.
      if (mine !== turn || !output) return
      const line = joinSpeech(output, speech)
      if (!line) return
      if (output.state === 'suspended') await output.resume().catch(() => undefined)
      await new Promise<void>((resolve) => {
        finish = resolve
        const lead = 0.05
        const source = output.createBufferSource()
        source.buffer = line.audio
        source.connect(output.destination)
        source.start(output.currentTime + lead)
        playing.push(source)
        line.words.forEach(({ word, at }) => {
          timers.push(window.setTimeout(() => mine === turn && onWord?.(word), lead * 1000 + at))
        })
        timers.push(window.setTimeout(() => {
          if (mine === turn) silence()
        }, (lead + line.audio.duration) * 1000 + 100))
      })
    },
    prepare(text) {
      voice.say(text).catch(() => undefined)
    },
    stop() {
      turn++
      silence()
    },
  }
}

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean)

/** The browser's built-in voice, used when the neural voice cannot run. */
export function browserSpeaker(synthesis: SpeechSynthesis = window.speechSynthesis): Speaker {
  return {
    speak(text, onWord) {
      return new Promise((resolve) => {
        // Some browsers never report the end of speech (for example with no voices installed),
        // so the call moves on after about twice the time the line should take.
        const safety = window.setTimeout(resolve, Math.max(4000, wordsIn(text).length * 1000))
        const finish = () => {
          window.clearTimeout(safety)
          resolve()
        }
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'en-US'
        utterance.onboundary = (event) => {
          if (event.name !== 'word' || !onWord) return
          const rest = text.slice(event.charIndex)
          const word = event.charLength ? rest.slice(0, event.charLength) : rest.split(/\s/)[0]
          if (word) onWord(word)
        }
        utterance.onend = finish
        utterance.onerror = finish
        synthesis.speak(utterance)
      })
    },
    prepare() {},
    stop() {
      synthesis.cancel()
    },
  }
}

export function canUseBrowserVoice(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
}

/**
 * No sound: the words appear in the captions at speaking pace. Used when no
 * voice can run, and in browser tests, which should not download the voice.
 */
export function captionSpeaker(wordsPerMinute = 180): Speaker {
  let timers: number[] = []
  const waiting = new Set<() => void>()
  return {
    speak(text, onWord) {
      return new Promise((resolve) => {
        const words = wordsIn(text)
        const step = 60_000 / wordsPerMinute
        words.forEach((word, index) => timers.push(window.setTimeout(() => onWord?.(word), index * step)))
        const finish = () => {
          waiting.delete(finish)
          resolve()
        }
        waiting.add(finish)
        timers.push(window.setTimeout(finish, words.length * step))
      })
    },
    prepare() {},
    stop() {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers = []
      waiting.forEach((finish) => finish())
    },
  }
}
