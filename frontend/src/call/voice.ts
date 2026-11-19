/** Audio plus word timings in milliseconds, as HeadTTS produces it. */
export interface SpeechAudio {
  audio: AudioBuffer
  words: string[]
  wtimes: number[]
  wdurations: number[]
}

/**
 * The interviewer's voice: HeadTTS with Kokoro neural voices, running in the
 * browser (WebGPU, or the slower WASM when WebGPU is missing). It returns
 * audio with word timings, played in the call with live captions.
 *
 * HeadTTS is served unchanged from /vendor/headtts/ (see vite.config.ts) and
 * loaded at runtime. Its model and voices (about 300 MB) download from Hugging
 * Face the first time and the browser caches them.
 */
const HEADTTS_URL = '/vendor/headtts/modules/headtts.mjs'

// Making the first line compiles the model and takes far longer than later
// ones, so it is done while loading rather than on the first question.
export const WARM_UP_TEXT = 'Hello.'

interface HeadTTSMessage {
  type: 'audio' | 'error' | 'custom'
  data: SpeechAudio & { error?: string }
}

interface HeadTTSClient {
  connect(settings: null, onprogress: (event: ProgressEvent) => void): Promise<void>
  setup(data: object): Promise<unknown>
  synthesize(data: { input: string }): Promise<HeadTTSMessage[]>
}

export interface HeadTTSModule {
  HeadTTS: new (settings: object) => HeadTTSClient
}

export interface Voice {
  /** Speech for `text`. Each line is made once and reused, so it can be prepared before it is needed. */
  say: (text: string) => Promise<SpeechAudio[]>
}

export interface VoiceOptions {
  voice: string
  audioContext?: AudioContext | null
  /** Download progress from 0 to 1, when the size is known. */
  onProgress?: (fraction: number) => void
  load?: () => Promise<HeadTTSModule>
}

function loadHeadTTS(): Promise<HeadTTSModule> {
  // Built at runtime so Vite leaves the import alone.
  return import(/* @vite-ignore */ new URL(HEADTTS_URL, window.location.href).href)
}

export async function loadVoice({ voice, audioContext = null, onProgress, load = loadHeadTTS }: VoiceOptions): Promise<Voice> {
  const { HeadTTS } = await load()
  const client = new HeadTTS({
    endpoints: ['webgpu', 'wasm'],
    languages: ['en-us'],
    voices: [voice],
    defaultVoice: voice,
    audioCtx: audioContext,
    // Full precision on both backends. HeadTTS defaults WASM to 4-bit (q4), which makes the
    // voice sound muffled; fp32 is the same model file WebGPU already downloads.
    dtypeWebgpu: 'fp32',
    dtypeWasm: 'fp32',
  })
  await client.connect(null, (event) => {
    if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(event.loaded / event.total, 1))
  })
  await client.setup({ voice, language: 'en-us', speed: 1, audioEncoding: 'wav' })

  const lines = new Map<string, Promise<SpeechAudio[]>>()
  const say = (text: string) => {
    const line = text.trim()
    let speech = lines.get(line)
    if (!speech) {
      speech = client.synthesize({ input: line }).then((messages) => {
        const failure = messages.find((message) => message.type === 'error')
        if (failure) throw new Error(failure.data.error ?? 'The voice could not say this line.')
        return messages.filter((message) => message.type === 'audio').map((message) => message.data)
      })
      lines.set(line, speech)
      // A failed line is not kept, so asking again tries again.
      speech.catch(() => lines.delete(line))
    }
    return speech
  }

  await say(WARM_UP_TEXT)
  return { say }
}
