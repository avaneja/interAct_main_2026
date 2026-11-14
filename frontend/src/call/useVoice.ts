import { useEffect, useState } from 'react'
import { loadVoice, type Voice } from './voice'

export type VoiceState =
  | { status: 'loading'; progress: number | null }
  | { status: 'ready'; voice: Voice }
  | { status: 'failed' }

// One voice per name for the whole visit: going back and forth between pages
// does not download or warm up the model again.
const voices = new Map<string, Promise<Voice>>()
const progressListeners = new Map<string, Set<(fraction: number) => void>>()

function getVoice(name: string, load: typeof loadVoice): Promise<Voice> {
  let voice = voices.get(name)
  if (!voice) {
    const listeners = new Set<(fraction: number) => void>()
    progressListeners.set(name, listeners)
    voice = load({ voice: name, onProgress: (fraction) => listeners.forEach((listener) => listener(fraction)) })
    voices.set(name, voice)
    voice.catch(() => voices.delete(name))
  }
  return voice
}

/** Only for tests. */
export function forgetVoices() {
  voices.clear()
  progressListeners.clear()
}

/** Start loading the interviewer's voice and follow its progress. */
export function useVoice(name: string, load: typeof loadVoice = loadVoice): VoiceState {
  const [state, setState] = useState<VoiceState>({ status: 'loading', progress: null })

  useEffect(() => {
    let current = true
    const voice = getVoice(name, load)
    const onProgress = (fraction: number) => {
      if (current) setState({ status: 'loading', progress: fraction })
    }
    const listeners = progressListeners.get(name)
    listeners?.add(onProgress)
    voice.then(
      (ready) => current && setState({ status: 'ready', voice: ready }),
      () => current && setState({ status: 'failed' }),
    )
    return () => {
      current = false
      listeners?.delete(onProgress)
    }
  }, [name, load])

  return state
}
