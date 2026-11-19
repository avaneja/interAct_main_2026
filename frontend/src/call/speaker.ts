import type { Voice } from './voice'

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
  sharedContext ??= new AudioContext()
  if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => undefined)
  return sharedContext
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
      await new Promise<void>((resolve) => {
        finish = resolve
        let offset = 0.05
        for (const part of speech) {
          const source = output.createBufferSource()
          source.buffer = part.audio
          source.connect(output.destination)
          source.start(output.currentTime + offset)
          playing.push(source)
          part.words.forEach((word, index) => {
            const at = offset * 1000 + (part.wtimes[index] ?? 0)
            timers.push(window.setTimeout(() => mine === turn && onWord?.(word.trim()), at))
          })
          offset += part.audio.duration
        }
        timers.push(window.setTimeout(() => {
          if (mine === turn) silence()
        }, offset * 1000 + 100))
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
