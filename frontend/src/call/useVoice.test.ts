import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetVoices, useVoice } from './useVoice'
import type { Voice, VoiceOptions } from './voice'

const VOICE: Voice = { say: async () => [] }

beforeEach(forgetVoices)

describe('loading the interviewer voice', () => {
  it('shows download progress, then is ready', async () => {
    let options: VoiceOptions | undefined
    let finish: (voice: Voice) => void = () => {}
    const load = vi.fn((given: VoiceOptions) => {
      options = given
      return new Promise<Voice>((resolve) => (finish = resolve))
    })
    const { result } = renderHook(() => useVoice('af_bella', load))
    expect(result.current).toEqual({ status: 'loading', progress: null })

    act(() => options?.onProgress?.(0.4))
    expect(result.current).toEqual({ status: 'loading', progress: 0.4 })

    await act(async () => finish(VOICE))
    expect(result.current).toEqual({ status: 'ready', voice: VOICE })
    expect(options?.voice).toBe('af_bella')
  })

  it('loads each voice once for the whole visit', async () => {
    const load = vi.fn(async () => VOICE)
    const first = renderHook(() => useVoice('af_bella', load))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    first.unmount()

    const second = renderHook(() => useVoice('af_bella', load))
    await waitFor(() => expect(second.result.current.status).toBe('ready'))

    expect(load).toHaveBeenCalledOnce()
  })

  it('reports a failure, and tries again on the next visit', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('no WebGPU')).mockResolvedValue(VOICE)
    const first = renderHook(() => useVoice('af_bella', load))
    await waitFor(() => expect(first.result.current).toEqual({ status: 'failed' }))
    first.unmount()

    const second = renderHook(() => useVoice('af_bella', load))

    await waitFor(() => expect(second.result.current.status).toBe('ready'))
  })
})
