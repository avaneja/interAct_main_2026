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

interface BrandedNavigator {
  userAgentData?: { brands?: { brand: string }[] }
}

/**
 * Whether this browser's speech recognition can actually work. Chromium-based apps that are
 * not Google Chrome or Microsoft Edge (VS Code's built-in browser, Electron apps, Brave) offer
 * the API but cannot reach a speech service, so every attempt ends in a "network" error.
 * Browsers that do not report brands (Safari) are trusted.
 */
export function hasSpeechService(
  nav: BrandedNavigator | undefined = typeof navigator === 'undefined' ? undefined : (navigator as BrandedNavigator),
): boolean {
  const brands = nav?.userAgentData?.brands
  if (!brands?.length) return true
  return brands.some(({ brand }) => brand === 'Google Chrome' || brand === 'Microsoft Edge')
}

export function canRecognizeSpeech(): boolean {
  return recognitionConstructor() !== null && hasSpeechService()
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
      return (
        'Speech recognition could not reach its speech service. This happens without an internet connection, ' +
        'or in browsers other than Google Chrome or Microsoft Edge (such as an editor\'s built-in browser).'
      )
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
// A "network" error can be a brief drop in the connection to the speech service, so listening
// is retried this many times, after a short wait, before it stops.
const NETWORK_RETRIES = 3
const NETWORK_RETRY_MS = 1000

export function createTranscriber(
  { onText, onProblem }: TranscriberEvents,
  Recognition: RecognitionConstructor | null = recognitionConstructor(),
): Transcriber {
  let confirmed = ''
  let listening = false
  let current: RecognitionLike | null = null
  let restarts: number[] = []
  let networkFailures = 0
  let retryAfter = 0

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
      networkFailures = 0
      onText(join(confirmed, sessionConfirmed), pending)
    }
    recognition.onerror = (event) => {
      if (event.error === 'network' && networkFailures < NETWORK_RETRIES) {
        networkFailures++
        retryAfter = NETWORK_RETRY_MS
        return
      }
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
      if (retryAfter) {
        const wait = retryAfter
        retryAfter = 0
        window.setTimeout(() => {
          if (listening && !current) begin()
        }, wait)
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
      networkFailures = 0
      retryAfter = 0
      begin()
    },
    stop() {
      listening = false
      current?.stop()
    },
  }
}
