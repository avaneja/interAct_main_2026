/**
 * Estimated eye contact from the camera, with MediaPipe Face Landmarker
 * running in this browser. Frames are looked at and dropped: nothing is
 * recorded, uploaded or kept except the counts below. These are estimates
 * for practice feedback, never part of the score.
 */
import type { DeliverySignals } from '../api/types'

export type FrameJudgement = 'toward' | 'away' | 'missing' | 'many'
export type CameraFocus = NonNullable<DeliverySignals['camera']>

export interface FaceFrame {
  faceCount: number
  /** Blendshape scores (0 to 1) by name, such as eyeLookOutLeft, for the first face. */
  blendshapes?: Record<string, number>
  /** The first face's 4x4 transformation matrix, column-major, as MediaPipe gives it. */
  matrix?: number[]
}

const MAX_YAW_DEGREES = 30
const MAX_PITCH_DEGREES = 25
const EYES_AWAY = 0.6
// A glance shorter than this is not counted as looking away.
export const LOOK_AWAY_MS = 1500
const SAMPLE_MS = 200
// Too few frames give no estimate.
const MIN_FRAMES = 5

/** Head turn from the transformation matrix, in degrees: yaw (left/right) and pitch (up/down). */
export function headTurn(matrix: number[]): { yaw: number; pitch: number } {
  const r02 = matrix[8]
  const r12 = matrix[9]
  const r22 = matrix[10]
  const degrees = (radians: number) => (radians * 180) / Math.PI
  return { yaw: degrees(Math.atan2(r02, r22)), pitch: degrees(Math.asin(Math.max(-1, Math.min(1, -r12)))) }
}

export function judgeFrame(frame: FaceFrame): FrameJudgement {
  if (frame.faceCount === 0) return 'missing'
  if (frame.faceCount > 1) return 'many'
  if (frame.matrix) {
    const { yaw, pitch } = headTurn(frame.matrix)
    if (Math.abs(yaw) > MAX_YAW_DEGREES || Math.abs(pitch) > MAX_PITCH_DEGREES) return 'away'
  }
  const eyes = frame.blendshapes ?? {}
  const score = (name: string) => eyes[name] ?? 0
  // Both eyes turned the same way: to one side, up or down.
  const sideways = Math.max(
    Math.min(score('eyeLookOutLeft'), score('eyeLookInRight')),
    Math.min(score('eyeLookInLeft'), score('eyeLookOutRight')),
  )
  const vertical = Math.max(
    Math.min(score('eyeLookUpLeft'), score('eyeLookUpRight')),
    Math.min(score('eyeLookDownLeft'), score('eyeLookDownRight')),
  )
  return sideways > EYES_AWAY || vertical > EYES_AWAY ? 'away' : 'toward'
}

/** Adds up judged frames for one answer. */
export class GazeMeter {
  private frames = 0
  private away = 0
  private missing = 0
  private many = 0
  private lookAways = 0
  private awayRunMs = 0
  private countedRun = false

  add(judgement: FrameJudgement, elapsedMs: number) {
    this.frames++
    if (judgement === 'missing') this.missing++
    if (judgement === 'many') this.many++
    if (judgement === 'away') {
      this.away++
      this.awayRunMs += elapsedMs
      if (!this.countedRun && this.awayRunMs >= LOOK_AWAY_MS) {
        this.lookAways++
        this.countedRun = true
      }
    } else {
      this.awayRunMs = 0
      this.countedRun = false
    }
  }

  /** The estimate, or null with too few frames to say anything. */
  read(): CameraFocus | null {
    if (this.frames < MIN_FRAMES) return null
    const share = (count: number) => Math.round((count / this.frames) * 100) / 100
    // Looking away is measured over the frames where one face was seen.
    const seen = this.frames - this.missing - this.many
    return {
      looking_away_ratio: seen > 0 ? Math.round((this.away / seen) * 100) / 100 : 0,
      look_aways: this.lookAways,
      face_missing_ratio: share(this.missing),
      multiple_faces_ratio: share(this.many),
    }
  }
}

export interface Gaze {
  reset: () => void
  read: () => CameraFocus | null
  stop: () => void
}

/** Start estimating eye contact from a camera stream. Throws if the face model cannot load. */
export async function startGaze(stream: MediaStream): Promise<Gaze> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const files = await FilesetResolver.forVisionTasks(new URL('/vendor/mediapipe/wasm', window.location.href).href)
  const landmarker = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 2,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  })
  // A video element of its own, never shown and never recorded.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  await video.play().catch(() => undefined)
  // The first detection is slow while the model warms up (seconds on software graphics),
  // so it happens now, while loading, and never in the middle of an answer.
  if (video.readyState >= 2) landmarker.detectForVideo(video, performance.now())

  let meter = new GazeMeter()
  let last = performance.now()
  const timer = window.setInterval(() => {
    if (video.readyState < 2) return
    const now = performance.now()
    const result = landmarker.detectForVideo(video, now)
    const shapes = result.faceBlendshapes[0]?.categories ?? []
    meter.add(
      judgeFrame({
        faceCount: result.faceLandmarks.length,
        blendshapes: Object.fromEntries(shapes.map((shape) => [shape.categoryName, shape.score])),
        matrix: result.facialTransformationMatrixes[0]?.data,
      }),
      now - last,
    )
    last = now
  }, SAMPLE_MS)

  return {
    reset: () => {
      meter = new GazeMeter()
    },
    read: () => meter.read(),
    stop: () => {
      window.clearInterval(timer)
      video.srcObject = null
      landmarker.close()
    },
  }
}
