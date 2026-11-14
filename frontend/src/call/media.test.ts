import { afterEach, describe, expect, it } from 'vitest'
import { domError, fakeStream, removeMediaDevices, stubGetUserMedia } from '../test/fakeMedia'
import { MediaAccessError, describeProblem, openDevice, stopStream } from './media'

afterEach(removeMediaDevices)

describe('opening the camera and microphone', () => {
  it('asks for a front-facing camera, or a microphone with echo and noise reduction', async () => {
    const { stream } = fakeStream()
    const getUserMedia = stubGetUserMedia(async () => stream)

    expect(await openDevice('camera')).toBe(stream)
    await openDevice('microphone')

    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: { facingMode: 'user' } })
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: { echoCancellation: true, noiseSuppression: true } })
  })

  it.each([
    ['NotAllowedError', 'blocked'],
    ['SecurityError', 'blocked'],
    ['NotFoundError', 'missing'],
    ['NotReadableError', 'busy'],
    ['TypeError', 'failed'],
  ])('explains a %s as %s', async (name, problem) => {
    stubGetUserMedia(async () => {
      throw domError(name)
    })

    const error = await openDevice('camera').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(MediaAccessError)
    expect((error as MediaAccessError).problem).toBe(problem)
  })

  it('says when the browser has no camera access at all', async () => {
    removeMediaDevices()

    await expect(openDevice('microphone')).rejects.toMatchObject({ problem: 'unsupported' })
  })

  it('stops every track of a stream', () => {
    const { stream, track } = fakeStream()

    stopStream(stream)
    stopStream(null)

    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('tells the user how to fix a blocked device', () => {
    expect(describeProblem('camera', 'blocked')).toMatch(/blocked the camera.*address bar/)
    expect(describeProblem('microphone', 'busy')).toMatch(/Another app is using the microphone/)
  })
})
