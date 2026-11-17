import { describe, expect, it } from 'vitest'
import { GazeMeter, LOOK_AWAY_MS, headTurn, judgeFrame } from './gaze'

/** A column-major 4x4 matrix for a head turned `yaw` degrees around the vertical axis. */
function turned(yawDegrees: number, pitchDegrees = 0): number[] {
  const y = (yawDegrees * Math.PI) / 180
  const p = (pitchDegrees * Math.PI) / 180
  // R = Ry(yaw) * Rx(pitch)
  const r = [
    [Math.cos(y), Math.sin(y) * Math.sin(p), Math.sin(y) * Math.cos(p)],
    [0, Math.cos(p), -Math.sin(p)],
    [-Math.sin(y), Math.cos(y) * Math.sin(p), Math.cos(y) * Math.cos(p)],
  ]
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, 0, 0, 0, 1]
}

describe('judging a camera frame', () => {
  it('reads the head turn from the transformation matrix', () => {
    const { yaw, pitch } = headTurn(turned(40, 10))

    expect(Math.round(yaw)).toBe(40)
    expect(Math.round(pitch)).toBe(10)
  })

  it('says no face or more than one face', () => {
    expect(judgeFrame({ faceCount: 0 })).toBe('missing')
    expect(judgeFrame({ faceCount: 2 })).toBe('many')
  })

  it('counts a face turned well to the side, up or down as looking away', () => {
    expect(judgeFrame({ faceCount: 1, matrix: turned(10) })).toBe('toward')
    expect(judgeFrame({ faceCount: 1, matrix: turned(45) })).toBe('away')
    expect(judgeFrame({ faceCount: 1, matrix: turned(0, 35) })).toBe('away')
  })

  it('counts both eyes turned the same way as looking away, but not one eye alone', () => {
    expect(judgeFrame({ faceCount: 1, blendshapes: { eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 } })).toBe('away')
    expect(judgeFrame({ faceCount: 1, blendshapes: { eyeLookDownLeft: 0.7, eyeLookDownRight: 0.7 } })).toBe('away')
    expect(judgeFrame({ faceCount: 1, blendshapes: { eyeLookOutLeft: 0.8 } })).toBe('toward')
  })
})

describe('adding up frames for an answer', () => {
  it('gives no estimate from too few frames', () => {
    const meter = new GazeMeter()
    meter.add('toward', 200)

    expect(meter.read()).toBeNull()
  })

  it('measures looking away over the frames with one face, and the rest over all frames', () => {
    const meter = new GazeMeter()
    for (const judgement of ['toward', 'toward', 'away', 'missing', 'many', 'toward', 'away', 'toward'] as const) {
      meter.add(judgement, 200)
    }

    expect(meter.read()).toEqual({
      looking_away_ratio: 0.33, look_aways: 0, face_missing_ratio: 0.13, multiple_faces_ratio: 0.13,
    })
  })

  it('counts a look-away once it lasts long enough, and only once per glance', () => {
    const meter = new GazeMeter()
    const steps = Math.ceil(LOOK_AWAY_MS / 200) + 3
    for (let i = 0; i < steps; i++) meter.add('away', 200)
    meter.add('toward', 200)
    for (let i = 0; i < 3; i++) meter.add('away', 200)  // A short glance: not counted.

    expect(meter.read()?.look_aways).toBe(1)
  })
})
