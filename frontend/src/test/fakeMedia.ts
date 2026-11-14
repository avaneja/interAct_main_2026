import { vi } from 'vitest'

/** A MediaStream stand-in whose tracks record being stopped. */
export function fakeStream() {
  const track = { stop: vi.fn(), kind: 'video' }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

/** Replace navigator.mediaDevices.getUserMedia for one test; returns the mock. */
export function stubGetUserMedia(implementation: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const getUserMedia = vi.fn(implementation)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  return getUserMedia
}

export function removeMediaDevices() {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
}

export const domError = (name: string) => new DOMException('denied', name)
