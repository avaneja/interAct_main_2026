import { useCallback, useEffect, useRef, useState } from 'react'
import { MediaAccessError, openDevice, stopStream, type MediaProblem } from './media'

export type CameraState =
  | { status: 'off' }
  | { status: 'starting' }
  | { status: 'on'; stream: MediaStream }
  | { status: 'problem'; problem: MediaProblem }

/** The candidate's camera for the self-view. It is never recorded or sent anywhere. */
export function useCamera() {
  const [state, setState] = useState<CameraState>({ status: 'off' })
  const stream = useRef<MediaStream | null>(null)
  const attempt = useRef(0)

  const turnOff = useCallback(() => {
    attempt.current++
    stopStream(stream.current)
    stream.current = null
    setState({ status: 'off' })
  }, [])

  const turnOn = useCallback(async () => {
    const mine = ++attempt.current
    setState({ status: 'starting' })
    try {
      const opened = await openDevice('camera')
      if (mine !== attempt.current) return stopStream(opened)
      stream.current = opened
      setState({ status: 'on', stream: opened })
    } catch (error) {
      if (mine !== attempt.current) return
      setState({ status: 'problem', problem: error instanceof MediaAccessError ? error.problem : 'failed' })
    }
  }, [])

  // Release the camera when the page closes.
  useEffect(
    () => () => {
      attempt.current++
      stopStream(stream.current)
    },
    [],
  )

  return { camera: state, turnOn, turnOff }
}
