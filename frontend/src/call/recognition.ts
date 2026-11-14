/** Speech-to-text with the browser's speech recognition (Chrome sends the audio to Google). */

type RecognitionConstructor = new () => unknown

export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function canRecognizeSpeech(): boolean {
  return recognitionConstructor() !== null
}
