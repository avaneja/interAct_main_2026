/** Camera and microphone access, with problems explained in plain words. */

export type Device = 'camera' | 'microphone'
export type MediaProblem = 'blocked' | 'missing' | 'busy' | 'unsupported' | 'failed'

export class MediaAccessError extends Error {
  readonly problem: MediaProblem

  constructor(problem: MediaProblem) {
    super(problem)
    this.name = 'MediaAccessError'
    this.problem = problem
  }
}

const CONSTRAINTS: Record<Device, MediaStreamConstraints> = {
  camera: { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } },
  microphone: { audio: { echoCancellation: true, noiseSuppression: true } },
}

function problemOf(error: unknown): MediaProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'blocked'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'failed'
}

/** Ask the browser for the camera or microphone. Throws MediaAccessError. */
export async function openDevice(device: Device): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MediaAccessError('unsupported')
  try {
    return await navigator.mediaDevices.getUserMedia(CONSTRAINTS[device])
  } catch (error) {
    throw new MediaAccessError(problemOf(error))
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function describeProblem(device: Device, problem: MediaProblem): string {
  const name = device === 'camera' ? 'camera' : 'microphone'
  switch (problem) {
    case 'blocked':
      return `The browser blocked the ${name}. Allow it with the icon at the left of the address bar, then try again.`
    case 'missing':
      return `No ${name} was found. Connect one, then try again.`
    case 'busy':
      return `Another app is using the ${name}. Close it, then try again.`
    case 'unsupported':
      return `This browser cannot use a ${name} here. Use Chrome on http://localhost or an https address.`
    case 'failed':
      return `The ${name} could not start. Try again.`
  }
}

/**
 * Call `onLevel` with the microphone's loudness (0 to 1) about 20 times a
 * second, for a level meter. Returns a function that stops listening.
 */
export function watchLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  if (typeof AudioContext === 'undefined') return () => {}
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)
    onLevel(Math.min(1, rms * 4))
  }, 50)
  return () => {
    window.clearInterval(timer)
    void context.close()
  }
}
