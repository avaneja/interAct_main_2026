import type { SpeechAudio } from '@met4citizen/talkinghead'
import { describe, expect, it, vi } from 'vitest'
import { loadVoice, WARM_UP_TEXT, type HeadTTSModule } from './voice'

function speech(text: string): SpeechAudio {
  return { audio: {} as AudioBuffer, words: text.split(' '), wtimes: [0], wdurations: [100] }
}

function fakeHeadTTS({ failOn = '' } = {}) {
  const created: { settings: object; setup: object[]; said: string[] }[] = []
  const module: HeadTTSModule = {
    HeadTTS: class {
      record: (typeof created)[number]
      constructor(settings: object) {
        this.record = { settings, setup: [], said: [] }
        created.push(this.record)
      }
      async connect(_settings: null, onprogress: (event: ProgressEvent) => void) {
        onprogress(new ProgressEvent('progress', { lengthComputable: true, loaded: 50, total: 200 }))
        onprogress(new ProgressEvent('progress', { lengthComputable: false, loaded: 10, total: 0 }))
      }
      async setup(data: object) {
        this.record.setup.push(data)
      }
      async synthesize({ input }: { input: string }) {
        this.record.said.push(input)
        if (input === failOn) return [{ type: 'error' as const, data: { ...speech(''), error: 'Out of memory' } }]
        return [
          { type: 'audio' as const, data: speech(input) },
          { type: 'custom' as const, data: speech('ignored') },
        ]
      }
    },
  }
  return { module, created }
}

describe('the interviewer voice', () => {
  it('connects to the in-browser model with the chosen voice and warms it up', async () => {
    const { module, created } = fakeHeadTTS()
    const audioContext = {} as AudioContext
    const progress: number[] = []

    await loadVoice({ voice: 'af_bella', audioContext, onProgress: (f) => progress.push(f), load: async () => module })

    expect(created[0].settings).toMatchObject({ endpoints: ['webgpu', 'wasm'], voices: ['af_bella'], audioCtx: audioContext })
    expect(created[0].setup).toEqual([{ voice: 'af_bella', language: 'en-us', speed: 1, audioEncoding: 'wav' }])
    expect(created[0].said).toEqual([WARM_UP_TEXT])
    expect(progress).toEqual([0.25])
  })

  it('returns only the audio parts of a line', async () => {
    const { module } = fakeHeadTTS()
    const voice = await loadVoice({ voice: 'af_bella', load: async () => module })

    expect(await voice.say('What is a process?')).toEqual([speech('What is a process?')])
  })

  it('makes each line once, so a prepared line plays without waiting', async () => {
    const { module, created } = fakeHeadTTS()
    const voice = await loadVoice({ voice: 'af_bella', load: async () => module })

    const first = voice.say('What is a process?')
    const second = voice.say('  What is a process? ')

    expect(await first).toBe(await second)
    expect(created[0].said).toEqual([WARM_UP_TEXT, 'What is a process?'])
  })

  it('reports a failed line and tries again next time', async () => {
    const { module, created } = fakeHeadTTS({ failOn: 'Broken line' })
    const voice = await loadVoice({ voice: 'af_bella', load: async () => module })

    await expect(voice.say('Broken line')).rejects.toThrow('Out of memory')
    await expect(voice.say('Broken line')).rejects.toThrow('Out of memory')

    expect(created[0].said.filter((line) => line === 'Broken line')).toHaveLength(2)
  })

  it('fails to load when the model cannot start', async () => {
    const load = vi.fn().mockRejectedValue(new Error('No WebGPU or WASM'))

    await expect(loadVoice({ voice: 'af_bella', load })).rejects.toThrow('No WebGPU or WASM')
  })
})
