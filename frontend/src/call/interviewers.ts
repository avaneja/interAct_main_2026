/**
 * The preset interviewers. Each is a 3D model in public/interviewers (see
 * CREDITS.md there for sources and licenses) and a voice for HeadTTS.
 */
export interface InterviewerPreset {
  key: string
  name: string
  modelUrl: string
  body: 'M' | 'F'
  voice: string
}

export const INTERVIEWERS: InterviewerPreset[] = [
  { key: 'preset-01', name: 'Maya', modelUrl: '/interviewers/maya.glb', body: 'F', voice: 'af_bella' },
]

export const DEFAULT_INTERVIEWER = INTERVIEWERS[0]
