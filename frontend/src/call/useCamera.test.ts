import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { domError, fakeStream, removeMediaDevices, stubGetUserMedia } from '../test/fakeMedia'
import { useCamera } from './useCamera'

afterEach(removeMediaDevices)

describe('the camera', () => {
  it('starts off, turns on, and turns off again, releasing the camera', async () => {
    const { stream, track } = fakeStream()
    stubGetUserMedia(async () => stream)
    const { result } = renderHook(() => useCamera())
    expect(result.current.camera).toEqual({ status: 'off' })

    await act(() => result.current.turnOn())
    expect(result.current.camera).toEqual({ status: 'on', stream })

    act(() => result.current.turnOff())
    expect(result.current.camera).toEqual({ status: 'off' })
    expect(track.stop).toHaveBeenCalled()
  })

  it('reports a blocked camera', async () => {
    stubGetUserMedia(async () => {
      throw domError('NotAllowedError')
    })
    const { result } = renderHook(() => useCamera())

    await act(() => result.current.turnOn())

    expect(result.current.camera).toEqual({ status: 'problem', problem: 'blocked' })
  })

  it('releases a camera that arrives after it was turned off', async () => {
    const { stream, track } = fakeStream()
    let grant: (s: MediaStream) => void = () => {}
    stubGetUserMedia(() => new Promise((resolve) => (grant = resolve)))
    const { result } = renderHook(() => useCamera())

    let starting: Promise<void> = Promise.resolve()
    act(() => {
      starting = result.current.turnOn()
    })
    act(() => result.current.turnOff())
    await act(async () => {
      grant(stream)
      await starting
    })

    expect(result.current.camera).toEqual({ status: 'off' })
    expect(track.stop).toHaveBeenCalled()
  })

  it('releases the camera when the page closes', async () => {
    const { stream, track } = fakeStream()
    stubGetUserMedia(async () => stream)
    const { result, unmount } = renderHook(() => useCamera())
    await act(() => result.current.turnOn())

    unmount()

    await waitFor(() => expect(track.stop).toHaveBeenCalled())
  })
})
