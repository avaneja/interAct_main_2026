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

/** The browser's built-in voice, used when the neural voice or the 3D interviewer cannot run. */
export function browserSpeaker(synthesis: SpeechSynthesis = window.speechSynthesis): Speaker {
  return {
    lipSync: false,
    speak(text, onWord) {
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'en-US'
        utterance.onboundary = (event) => {
          if (event.name !== 'word' || !onWord) return
          const rest = text.slice(event.charIndex)
          const word = event.charLength ? rest.slice(0, event.charLength) : rest.split(/\s/)[0]
          if (word) onWord(word)
        }
        utterance.onend = () => resolve()
        utterance.onerror = () => resolve()
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
