import type { InterviewerHandle } from './Interviewer'
import type { Voice } from './voice'

/** How the interviewer's lines are spoken; the call screen does not care which kind it gets. */
export interface Speaker {
  /** Speak `text`, calling `onWord` as each word is said. Resolves when done or stopped. */
  speak: (text: string, onWord?: (word: string) => void) => Promise<void>
  /** Start making speech for a line that will be said soon, so it plays without a pause. */
  prepare: (text: string) => void
  stop: () => void
  /** Whether the 3D interviewer moves its lips with the speech. */
  lipSync: boolean
}

/** The neural voice, lip-synced by the 3D interviewer. */
export function avatarSpeaker(voice: Voice, interviewer: () => InterviewerHandle | null): Speaker {
  let turn = 0
  return {
    lipSync: true,
    async speak(text, onWord) {
      const mine = ++turn
      const speech = await voice.say(text)
      // Stopped, or another line started, while the speech was being made.
      if (mine !== turn) return
      await interviewer()?.speak(speech, onWord)
    },
    prepare(text) {
      voice.say(text).catch(() => undefined)
    },
    stop() {
      turn++
      interviewer()?.stopSpeaking()
    },
  }
}

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean)

/** The browser's built-in voice, used when the neural voice or the 3D interviewer cannot run. */
export function browserSpeaker(synthesis: SpeechSynthesis = window.speechSynthesis): Speaker {
  return {
    lipSync: false,
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
    lipSync: false,
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
