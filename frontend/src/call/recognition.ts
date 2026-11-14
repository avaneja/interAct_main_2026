/**
 * Speech-to-text with the browser's speech recognition. In Chrome the audio
 * is sent to Google to be transcribed; only the text reaches InterAct.
 */

interface RecognitionAlternative {
  transcript: string
}

interface RecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: RecognitionAlternative
}

interface RecognitionResultEvent {
  results: { readonly length: number; [index: number]: RecognitionResult }
}

export interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type RecognitionConstructor = new () => RecognitionLike

export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function canRecognizeSpeech(): boolean {
  return recognitionConstructor() !== null
}

/** Why recognition stopped for good; anything else is retried. */
export type RecognitionProblem = 'blocked' | 'no-microphone' | 'network' | 'unavailable'

const PROBLEMS: Record<string, RecognitionProblem> = {
  'not-allowed': 'blocked',
  'service-not-allowed': 'unavailable',
  'audio-capture': 'no-microphone',
  network: 'network',
  'language-not-supported': 'unavailable',
}

export function describeRecognitionProblem(problem: RecognitionProblem): string {
  switch (problem) {
    case 'blocked':
      return 'The browser blocked the microphone, so speech cannot be turned into text.'
    case 'no-microphone':
      return 'No working microphone was found.'
    case 'network':
      return 'Speech recognition needs an internet connection, and it was lost.'
    case 'unavailable':
      return 'Speech recognition is not available in this browser right now.'
  }
}

const join = (...parts: string[]) =>
  parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')

export interface TranscriberEvents {
  /** Called on every change: the confirmed text so far, and words still being recognised. */
  onText: (confirmed: string, pending: string) => void
  onProblem: (problem: RecognitionProblem) => void
}

export interface Transcriber {
  /** Start listening, continuing after `soFar` (text already said for this answer). */
  start: (soFar?: string) => void
  /** Stop listening. Words still being recognised may arrive shortly after. */
  stop: () => void
}

// Chrome ends a recognition session after a pause; it is restarted so a
// thoughtful pause does not cut the answer off. Restarting this many times
// within RESTART_WINDOW_MS means something is wrong, so it gives up.
const MAX_QUICK_RESTARTS = 5
const RESTART_WINDOW_MS = 10_000

export function createTranscriber(
  { onText, onProblem }: TranscriberEvents,
  Recognition: RecognitionConstructor | null = recognitionConstructor(),
): Transcriber {
  let confirmed = ''
  let listening = false
  let current: RecognitionLike | null = null
  let restarts: number[] = []

  const begin = () => {
    if (!Recognition) {
      listening = false
      onProblem('unavailable')
      return
    }
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    let sessionConfirmed = ''

    recognition.onresult = (event) => {
      let pending = ''
      sessionConfirmed = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) sessionConfirmed = join(sessionConfirmed, result[0].transcript)
        else pending = join(pending, result[0].transcript)
      }
      onText(join(confirmed, sessionConfirmed), pending)
    }
    recognition.onerror = (event) => {
      const problem = PROBLEMS[event.error]
      if (problem) {
        listening = false
        onProblem(problem)
      }
      // 'no-speech' and 'aborted' are normal: the session ends and is restarted if still listening.
    }
    recognition.onend = () => {
      confirmed = join(confirmed, sessionConfirmed)
      if (current === recognition) current = null
      if (!listening) return
      const now = Date.now()
      restarts = [...restarts.filter((time) => now - time < RESTART_WINDOW_MS), now]
      if (restarts.length > MAX_QUICK_RESTARTS) {
        listening = false
        onProblem('unavailable')
        return
      }
      begin()
    }

    current = recognition
    try {
      recognition.start()
    } catch {
      listening = false
      current = null
      onProblem('unavailable')
    }
  }

  return {
    start(soFar = '') {
      // A session still stopping must not add its late words to the new text.
      if (current) {
        current.onresult = null
        current.onend = null
        current.abort()
        current = null
      }
      confirmed = soFar.trim()
      listening = true
      restarts = []
      begin()
    },
    stop() {
      listening = false
      current?.stop()
    },
  }
}
